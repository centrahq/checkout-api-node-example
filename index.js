const express = require('express')
const app = express();
var bodyParser = require('body-parser');
var request = require('request-promise-native');
const dots = require('dot').process({path: "./views"});
const cookieSession = require('cookie-session');

// load data from .env
require('dotenv').config();

const use_languages = process.env.USE_LANGUAGES == '1' || process.env.USE_LANGUAGES == 'true';

// use session cookie for signed info in the cookie
app.use(cookieSession({
  name: 'session',
  keys: [process.env.COOKIE_SESSION_KEY_1, process.env.COOKIE_SESSION_KEY_2]
}));

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('./www/'))

/**
	method to talk with centra-api
**/
function centra_api(method, uri, body = {}, token = false) {
	var headers = {
		'Authorization': 'Bearer ' + process.env.CENTRA_API_KEY,
		'Content-type': 'application/json',
	};
	if(token) {
		headers['API-Token'] = token;
	}
	return new Promise(function(resolve, reject) {
		request({
			method: method,
			headers: headers, //this is to maintain the current user's session
	    	url: process.env.CENTRA_API_ENDPOINT + uri,
	    	json: true,
			resolveWithFullResponse: true,
	    	body: body
		}).then(function(response) {
	        resolve(response)
	    }).catch(function(err) {
			reject(err);
		});
	})
}

var utils = {
	isSecure: function(req) { return req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] == 'https' || req.secure },
	hostUrl: function(req) { return (utils.isSecure(req)?'https':'http') + '://' + req.get('host') + req.base }
}

/**
 centra-helpers, to make sure the current visitor has the proper values for its session
 and also to make sure the proper content gets fetched on each visit.
**/
var centra = {
	token: '', // empty from start, will be filled by the init-calls
	init_user_data: {
		pricelist: 0,
		market: 0,
		language: '',
		selection: false,
		token: '',
		base_path: '', //if language is used, this will have the prefix, ie: /sv
		country: '', // default as the IP from start.
		country_state: '', // will be empty unless country needs state in checkout
	},
	bootup: function() {
		console.log('bootup and load local variables in memory...');
		//general things you need all the time.
		return Promise.all([
			centra_api('GET', 'languages'),
			centra_api('GET', 'countries'),
			centra_api('GET', 'markets'),
			centra_api('GET', 'pricelists'),
		]).then(function([
			languages,
			countries,
			markets,
			pricelists,
		]) {
			centra.languages = languages.body.languages;
			centra.language_keys = {};
			centra.languages.forEach((language, key)=>centra.language_keys[language.language]=key)
			//hack: set "en" as default=true
			centra.languages[centra.language_keys['en']].default = true;
			centra.countries = countries.body.countries;
			centra.markets = markets.body.markets;
			centra.pricelists = pricelists.body.pricelists;
			console.log('bootup loaded successfully.')
		}).catch(function(e) {
			console.log('bootup unable to load.', e.message)
		});
	},
	init: function(req, res, user_data) {
		if(!centra.fillUserData(req, res, user_data)) {
			return Promise.reject("redirect");
		}
		//specific things for the current user
		var user_specific = {
			market: user_data.market,
			pricelist: user_data.pricelist,
			/*language: user_data.language*/
		}
		return Promise.all([
			centra_api('POST', 'categories', user_specific),
			centra_api('POST', 'cms/articles', user_specific),
			user_data.token ? centra_api('GET', 'selection', {}, user_data.token) : Promise.resolve(),
		]).then(function([
			categories,
			articles,
			selection,
		]) {
			user_data.categories = categories.body.categories;
			user_data.articles = articles.body.articles;

			if(selection && selection.body.selection) {
				user_data.selection = selection.body
        		// modify selection if stuff differs.
				var selection_data = user_data.selection.authorized;
				change = {};
				if(selection_data.country != user_data.country) change.country = user_data.country;
				if(selection_data.market != user_data.market) change.market = user_data.market;
				if(selection_data.pricelist != user_data.pricelist) change.pricelist = user_data.pricelist;
				if(Object.keys(change).length)
					return centra_api('PUT', 'selection', change, user_data.token).then(function(response) {
						var selection_data = response.body.authorized;
						user_data.selection = response.body;
						user_data.country = selection_data.country;
						user_data.market = selection_data.market;
						user_data.pricelist = selection_data.pricelist;
					})
			}
		});
	},
	fillUserData: function(req, res, user_data) {
		if(req.session.market) user_data.market = req.session.market
		if(req.session.pricelist) user_data.pricelist = req.session.pricelist
		if(req.session.token) user_data.token = req.session.token;

		if(req.session.country)
			user_data.country = req.session.country
		else {
			var geoip_country = 'SE' //this should be passed from nginx/openresty
			user_data.country = geoip_country;
		}

		country = centra.countries.find(function(country) {
		  return country.country === user_data.country;
		});
		country_state = req.session.country_state;
		if(country_state && country.states && country.states.find(state=>state.state===country_state)) {
			user_data.country_state = country_state;
		}

		if(use_languages) {
			req.use_languages = true;
			/**
				Primary language does not have any language prefix, but second languages does
				format:
				www.example.com (default, language "en")
				www.example.com/sv/ (second language, language "sv")
			**/
			var potential_language = req.url.split('/')[1];
			var url_language = centra.language_keys[potential_language];
			if(
				url_language !== undefined &&
				centra.languages[url_language] &&
				centra.languages[url_language].language === potential_language
			) {
				// found second language, strip from url
				req_url = req.url.split('/');
				req_url.splice(1, 1)
				req.url = req_url.join('/')
				user_data.language = potential_language;
				req.base = '/' + potential_language;
			} else {
				// redirect to start page of proper language
				if(req.session.language) {
					// from session
					language = req.session.language;
				} else if(country.language) {
					// language of current country
					language = country.language;
				} else {
					// default language
					language = centra.languages.find(function(language) {
					  return language.default === true;
					});
				}
				req.base = '/' + language;
				res.redirect(req.base + req.url);
				res.end();
				return false;
			}
		} else {
			req.base = '';
			req.use_languages = false;
		}

		if(!user_data.market || !user_data.pricelist) {
			if(country) {
				// country exists
				if(!user_data.market) user_data.market = country.market
				if(!user_data.pricelist) user_data.pricelist = country.pricelist
				if(!user_data.language && country.language) user_data.language = country.language;
			} else {
				// no country for us, use default
				centra.market = centra.markets.find(function(market) {
				  return market.default === true;
				});
				centra.pricelist = centra.pricelists.find(function(pricelist) {
				  return pricelist.default === true;
				});
			}
			if(user_data.market) req.session.market = user_data.market
			if(user_data.pricelist) req.session.pricelist = user_data.pricelist
			if(user_data.country) req.session.country = user_data.country;
			if(user_data.language) req.session.language = user_data.language;
		}
		return true;
	},
	getData: function(method, uri, body = {}) {
		return Promise.all([
			centra_api(method, uri, body),
		])
	},
	buildProducts: function(products) {
		product_list = [];
		for(key in products) {
			var product = products[key];
			product_list.push({
				uri: product.uri,
				url: product.categoryUri + '/' + product.uri,
				name: product.name,
				variantName: product.variantName,
				price: product.price,
				image: product.media ? (product.media.standard? product.media.standard[0] : false) : false,
			});
		}
		return product_list;
	},
	buildSelectionProducts: function(products) {
		product_list = [];
		for(key in products) {
			var item = products[key];
			var product = products[key].product;
			product_list.push({
				uri: product.uri,
				url: product.categoryUri + '/' + product.uri,
				name: product.name,
				variantName: product.variantName,
				price: product.price,
				image: product.media ? (product.media.standard? product.media.standard[0] : false) : false,
				// selection-stuff

				quantity: item.quantity || 0,
				size: item.size || '',
				totalPrice: item.totalPrice || '',
				line: item.line || false,
			});
		}
		return product_list;
	},
	changeLanguage: function(req, res, next) {
		if(!req.body.language) {
			res.send('NOK');
			return;
		}
		var language = centra.languages.find(function(language) {
		  return language.language === req.body.language;
		});
		if(language) {
			req.session.language = language.language;
			if(language.default)
				res.send('OKD'); //default lang, redirect to root
			else
				res.send('OK');
		} else {
			res.send('NOK');
		}
	},
	changeCountry: function(req, res, next) {
		if(!req.body.country && !req.body.country_state) {
			res.send('NOK');
			return;
		}
		var country = centra.countries.find(function(country) {
		  return country.country === req.body.country;
		});
    if(country && req.body.country_state !== undefined) {
      var selected_state = req.body.country_state;
      if(country.states.find(state=>state.state===selected_state)) {
        req.session.country_state = selected_state;
        res.send('OK');
      } else {
        delete req.session.country_state;
        res.send('OK');
      }
    } else if(country) {
			if(country.states) delete req.session.country_state;
			if(req.session.token) {
				// user has cart, modify!
				var user_data = { ... centra.init_user_data }; //make this current user's data.
				centra.init(req, res, user_data).then(function() {
    				centra_api('PUT', 'selection', {
						country: country.country,
						pricelist: country.pricelist,
						market: country.market,
						/*language: user_data.language*/
					}, user_data.token).then(function(data) {
				            var selection = data.body.authorized;
				            req.session.market = selection.market;
				            req.session.pricelist = selection.pricelist
				            req.session.country = selection.country;
						res.send('OK');
					}).catch(function(e) {
						console.log(e);
						res.send('NOK');
					});
				});
			} else {
	            req.session.market = country.market;
	            req.session.pricelist = country.pricelist
	            req.session.country = country.country;
				res.send('OK');
			}
		} else {
			res.send('NOK');
		}
	},
	newsletterSubscribe: function(req, res, next) {
		if(!req.body.email) {
			res.send('NOK');
			return;
		}
		var country = req.session.country
		centra_api(
			'POST',
			'newsletter-subscription',
			{country: country, email: req.body.email}
		).then(function(response) {
			if(response.body.subscribed) {
				res.send('OK');
			} else {
				res.send('NOK');
			}
		});
	},
	selectionModify: function(method, path, data, user_data) {
		if(method) {
			return centra_api(method, path, data, user_data.token);
		}
		return Promise.reject('error');
	},
	handlePaymentResponse(req, res, data) {
		if(data.action) {
			switch(data.action) {
				case 'form':
					res.send(data.formHtml);
					return;
				break;
				case 'redirect':
					res.redirect(data.url);
					return;
				break;
				case 'success':
					res.redirect(utils.hostUrl(req) + '/selection/receipt');
					return;
				break;
			}
		}
		console.log(data);
		res.send('500');
	},
	paymentResult: function(req, res, next) {
		var user_data = { ... centra.init_user_data }; //make this current user's data.
		centra.init(req, res, user_data).then(function() {
			var params = Object.assign(req.query, req.body);
			centra_api('POST', 'selection/payment-result', {paymentMethodFields: params}, user_data.token).then(function(response) {
				if(response.body.order) {
					res.redirect(utils.hostUrl(req) + '/selection/receipt');
					res.end()
				} else {
					render.finalize(req, res, 'selection', user_data, response);
				}
			}).catch(function(data) {
				render.finalize(req, res, 'selection', user_data, data);
			});
		})
	},
	paymentFailed: function(req, res, next) {

	},
	paymentReceipt: function(req, res, next) {
		var user_data = { ... centra.init_user_data }; //make this current user's data.
		centra.init(req, res, user_data).then(function() {
			centra_api('GET', 'selection', {}, user_data.token).then(function(response) {
				if(response.body.order) {
					render.finalize(req, res, 'receipt', user_data, response);
				} else {
					res.redirect(utils.hostUrl(req) + '/selection');
				}
			}).catch(function(data) {
				console.log(data);
				res.send('500');
			});
		})
	},
  productSearch: function(req, res, next) {
  	var user_data = { ... centra.init_user_data }; //make this current user's data.
  	centra.init(req, res, user_data).then(function() {
  		var q = req.query.q;
  		centra_api('POST', 'products', {search: q/*, language: user_data.language*/}).then(function(response) {
  			render.finalize(req, res, 'search', user_data, response);
  		});
  	}).catch(function(e) {
  		// error or redirect
  	});
  },
  productAdd: function(req, res, user_data, data) {
			var product = data.body.product;
		if(req.body.item) {
			item = product.items.find(item=>item.item === req.body.item);
		}
		// item found, add to cart.
		if(item) {
			if(!user_data.selection) {
				// no current selection, create it first
				current_selection = centra_api('PUT', 'selection', {
					market: user_data.market,
					pricelist: user_data.pricelist,
					country: user_data.country,
					/*language: user_data.language*/
				}, user_data.token).then(function(response) {
					req.session.token = response.body.token;
					user_data.token = response.body.token;
				});
			} else {
				// already have a selection, empty promise
				current_selection = Promise.resolve();
			}
			current_selection.then(function(x) {
				centra_api('POST', 'selection/items/' + item.item, {}, user_data.token).then(function(response) {
					res.redirect(req.base + req.url)
				}).catch(function(e) {
					console.log(e)
					res.send('product not found');
				});
			}).catch(function(e) {
				console.log(e);
				res.send('could not create selection');
			});
		} else {
			res.send('404');
		}
  },
  selectionPost: function(req, res, next) {
  	var user_data = { ... centra.init_user_data }; //make this current user's data.
  	centra.init(req, res, user_data).then(function() {
  		if(!user_data.selection) {
  			//no selection
  			render.finalize(req, res, 'selection', user_data, {});
  			return;
  		}
  		var method = false, data = {}, redirect = true;
  		var findLine = (input_line)=>user_data.selection.selection.items.find(item=>input_line===item.line)
  		if(req.body.increase) {
  			//+1
  			if(line = findLine(req.body.increase[0])) {
  				item = line.line;
  				method = 'POST';
  				path = 'selection/lines/' + line.line + '/quantity/1';
  			}
  		} else if(req.body.decrease) {
  			//-1
  			if(line = findLine(req.body.decrease[0])) {
  				item = line.line;
  				method = 'DELETE';
  				path = 'selection/lines/' + line.line + '/quantity/1';
  			}
  		} else if(req.body.remove) {
  			//-1
  			if(line = findLine(req.body.remove[0])) {
  				item = line.line;
  				method = 'DELETE';
  				path = 'selection/lines/' + line.line;
  			}
  		} else if(req.body.voucher) {
  			method = 'POST';
  			path = 'selection/vouchers';
  			data.voucher = req.body.voucher;
  		} else if(req.body.voucher_remove) {
  			method = 'DELETE';
  			path = 'selection/vouchers';
  			data.voucher = req.body.voucher_remove;
  		} else if(req.body.payment_method) {
  			method = 'PUT';
  			path = 'selection/payment-methods/' + encodeURIComponent(req.body.payment_method);
  		} else if(req.body.checkout) {
  			data = {
  				termsAndConditions: req.body.termsAndConditions || 0,
  				paymentMethod: user_data.selection.selection.paymentMethod,
  				paymentReturnPage: utils.hostUrl(req) + '/selection/payment',
  				paymentFailedPage: utils.hostUrl(req) + '/selection/failed',
  				address: {
  					email: req.body.email,
  					firstName: req.body.firstName,
  					lastName: req.body.lastName,
  					address1: req.body.address1,
  					address2: req.body.address2,
  					zipCode: req.body.zipCode,
  					city: req.body.city,
  					phoneNumber: req.body.phoneNumber,
            country: user_data.country,
            state: user_data.country_state,
  				}
  			};
  			method = 'POST';
  			path = 'selection/payment'
  			redirect = false;
  		}
  		if(method) {
  			centra.selectionModify(method, path, data, user_data).then(function(data) {
  				if(redirect) {
  					res.redirect(req.base + req.url)
  					res.end();
  				} else {
  					centra.handlePaymentResponse(req, res, data.body);
  				}
  			}).catch(function(data) {
  				if(redirect) {
  					res.redirect(req.base + req.url)
  					res.end();
  				} else {
  					render.finalize(req, res, 'selection', user_data, data);
  				}
  			});
  		} else {
  			res.redirect(req.base + req.url)
  			res.end();
  		}
  	});
  }
}

// fetch rarely used data, will need to reload some times however
centra.bootup();
setInterval(centra.bootup, 2 * 60 * 1000);

// will switch the country/market/pricelist for the current user, keep the current language however.
app.post(use_languages ? '/:language/change-country' : '/change-country', centra.changeCountry)
//switch language for the current user
app.post('/change-language', centra.changeLanguage)
// register the user to newsletter
app.post('/email-subscribe', centra.newsletterSubscribe);

// view selection
app.get(use_languages ? '/:language/selection' : '/selection', function(req, res, next) {
	var user_data = { ... centra.init_user_data }; //make this current user's data.
	centra.init(req, res, user_data).then(function() {
		render.finalize(req, res, 'selection', user_data);
	})
});

// add item to selection
app.post(use_languages ? '/:language/selection' : '/selection', centra.selectionPost);

// fetch payment result
var payment_slug = use_languages ? '/:language/selection/payment' : '/selection/payment';
app.get(payment_slug, centra.paymentResult);
app.post(payment_slug, centra.paymentResult);
// fetch receipt result
app.get(use_languages ? '/:language/selection/receipt' : '/selection/receipt', centra.paymentReceipt);
// fetch payment failed
app.get(use_languages ? '/:language/selection/failed' : '/selection/failed', centra.paymentFailed);

// search!
app.get(use_languages ? '/:language/search' : '/search', centra.productSearch);

// add product to cart
app.post('*', function(req, res, next) {
	var user_data = { ... centra.init_user_data }; //make this current user's data.
	centra.init(req, res, user_data).then(function() {
		centra.getData('POST', 'uri', {
			uri: req.url,
			for: ['product'],
			market: user_data.market,
			pricelist: user_data.pricelist,
			/*language: user_data.language,*/
		}).then(function([data]) {
			// add product to cart
			centra.productAdd(req, res, user_data, data);
		}).catch(function(err) {
			console.log(err.message);
			res.send('404');
		});
	})
})


app.get('*', function(req, res, next) {
	var user_data = { ... centra.init_user_data }; //make this current user's data.
	centra.init(req, res, user_data).then(function() {
		centra.getData('POST', 'uri', {
			uri: req.url,
			for: ['cmsArticle', 'category', 'product'],
			market: user_data.market,
			pricelist: user_data.pricelist,
			/*language: user_data.language,*/
		}).then(function([data]) {
			var page = data.body.found;
			render.finalize(req, res, page, user_data, data)
		}).catch(function(err) {
			console.log(err.message);
			res.send('404');
		});
	}).catch(function(e) {
		if(e == 'redirect') return; // redirect catch of promise. ignore.
		// error
		console.error('Error:', e)
	});;
});

app.listen(process.env.PORT || 3000, () => console.log('Example app listening on port 3000!'))

render = {
	head: function(req, res, user_data, header_data) {
		categories = [];
		for(key in user_data.categories) {
			var category = user_data.categories[key];
			if(category.inCategory) continue; //only show root categories
			categories.push({uri: category.uri, name: category.name})
		}
		render_content = {
			header_data: header_data,
			categories: categories,
			countries: centra.countries,
			languages: centra.languages,
			user_data: user_data,
			req: req,
		};
		return {header: dots.header(render_content), footer: dots.footer(render_content)}
	},
	/**
		This is the way to render the different pages returned by the /uri call to Centra.
		The idea is that the /uri gives a type back, and based on the type, it gets rendered by different
		templates. We can also inject our own types in here, like search, to make similar renderings of different
		pages.
	**/
	finalize: function(req, res, page, user_data, data) {
		var body = '';
		var wrapper = {header: '', footer: ''};
		switch(page) {
			case 'cmsArticle':
				var article = data.body.cmsArticle;
				wrapper = render.head(req, res, user_data, {title: article.title})
				body = dots.article({title: article.title, parts: article.parts, user_data: user_data, req: req})
			break;
			case 'search':
				var products = data.body.products;
				product_list = centra.buildProducts(products);
				wrapper = render.head(req, res, user_data, {title: req.query.q})
				body = dots.category({title: req.query.q, products: product_list, req: req})
			break;
			case 'category':
				var products = data.body.products;
				var category = data.body.category
				wrapper = render.head(req, res, user_data, {title: category.name})
				product_list = centra.buildProducts(products);
				for(key in product_list) {
					var product = product_list[key]
					// a category should overwrite the link to make sure the user is kept in the current category
					product_list[key].url = category.uri + '/' + product.uri;
				}
				body = dots.category({title: category.name, products: product_list, req: req})
			break;
			case 'product':
				var product = data.body.product;
				var category = data.body.category;
				// this is the canonical URL for the product, aka the one to be used for google etc:
				var canonicalUrl = product.categoryUri + '/' + product.uri;
				wrapper = render.head(req, res, user_data, {
					title: product.name,
					canonicalUrl: utils.hostUrl(req) + '/' + canonicalUrl
				});
				var images = product.media ? (product.media.standard? product.media.standard : []) : [];
				items = [];
				var sizes = 0, available = 0, firstAvailable = false;
				product.items.forEach(function(item, i) {
					if(item.stock) {
						available++;
						firstAvailable = i;
					}
					sizes++;
					items.push(item);
				});
				if(available == 1) {
					items[firstAvailable].selected = true;
					// select only size as selected.
				}
				var variants = product.relatedProducts ?centra.buildProducts(product.relatedProducts.filter(related=>related.relation === 'variant')) : [];
				var related = product.relatedProducts ? centra.buildProducts(product.relatedProducts.filter(related=>related.relation === 'standard')) : [];
				body = dots.product({
					title: product.name,
					images: images,
					category: category,
					variantName: product.variantName,
					variants: variants,
					related: related,
					price: product.price,
					items: items,
					url: canonicalUrl,
					req: req,
					user_data: user_data,
				})
			break;
			case 'selection':
				var selection = user_data.selection && user_data.selection.selection;
				var products = selection.items || [];
				var vouchers = selection.discounts && selection.discounts.vouchers || [];
				var paymentMethods = user_data.selection.paymentMethods;
				var fields = user_data.selection.paymentFields;
				var errors = data && data.error && data.error.errors || false;
				var errorMessages = "";
				if(errors) {
					if(data.error.messages) {
						errorMessages = data.error.messages.join("\n");
					}
				}
				checkError = function(field) {
					if(errors[field]) return ' style="color:red" ';
					return '';
				}
				selected_country = centra.countries.find(country=>country.country==user_data.country);
				states = selected_country.states || [];
				product_list = centra.buildSelectionProducts(products);
				wrapper = render.head(req, res, user_data, {title: 'Selection'});
				body = dots.selection({
					title: 'Selection',
					checkError: checkError,
					paymentMethods: paymentMethods,
					products: product_list,
					vouchers: vouchers,
					fields: fields,
					selection: selection,
					errors: errors,
					errorMessages: errorMessages,
					countries: centra.countries,
					states: states,
					user_data: user_data,
					req: req
				})
			break;
			case 'receipt':
				title = 'Receipt';
				var order = data.body.order || [];
				var products = order.items || [];
				product_list = centra.buildSelectionProducts(products);
				wrapper = render.head(req, res, user_data, {title: title});
				body = dots.receipt({
					title: title,
					products: product_list,
					order: order,
					user_data: user_data,
					req: req
				})
			break;
		}
		res.send(wrapper.header + body + wrapper.footer);
	}
}
