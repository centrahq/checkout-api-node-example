# checkout-api-node-example
Simple example shop using Checkout API in node / express.js

### Centra setup

Centra branch is "checkout-api-changes". You need elasticsearch for Centra.

Add a Checkout API plugin. Set settings:
- Version: 4
- Authorization Secret: make your own secret!
- Elasticsearch: enabled

Make sure you run the crontab script, so the ES indices needed for the API are created and kept up to date.

### Configuration

```
cp .env.example .env
```

* Modify `xCOOKIE_SESSION_KEY_1` into `COOKIE_SESSION_KEY_1` and set it to something really random.
* Modify `xCOOKIE_SESSION_KEY_2` into `COOKIE_SESSION_KEY_2` and set it to something really random.
* Set the `CENTRA_API_ENDPOINT` and `CENTRA_API_KEY` and point them against the plugin set up in Centra.
* Decide if `USE_LANGUAGES` should be `true` or `false`

### How to run it

If you are a node noob like me, do this:

```
npm install
node index.js
```

You can also use supervisor, install it globally by `npm install -g supervisor`.

Then you can run:

```
supervisor -e js,dot index.js
```

And it will reload automagically each time any `.js` or `.dot` changes.

### Centra settings

This example is currently based on two CMS-sections, PAGES and LOOKBOOKS.

The following settings were used for the CMS to make the sections work:

```
$cms_standard_settings = array(
	'templates' => array(
		'info_item',
		'article_list',
	),
	'linkbox' => false, 'hide_forms' => array('art_tags' => true,
		'art_mediasrc' => true, 'art_category' => true,'art_brand' => true,'art_author' => true,'art_author_location' => true,
		'art_preheading' => true, 'art_meta_keywords' => true, 'art_subheading' => true, 'art_relations' => true, 'art_to_prd' => true,
	));

$usr_conf["CMS_CONF"] = array(
	"IMG_SIZES" =>  array(
		'lookbook_front' => array(array(0, 0, 95)),
		'slideshow_list' => array(array(0, 0, 95)),
		'hero_image' => array(array(0, 0, 95)),
	),
	"STORE" => RTAIL,
	"TEMPLATES" => array(
		"article_list" => array(
			"template" => "article_list",
			"name" => "Article List Section",
			"slots" => array(
				[
					"name" => "section",
					"type" => "textfield",
					"desc" => "Section to list",
				],
			)
		),
		"info_item" => array(
			"template" => "info_item",
			"name" => "Standard Section",
			"slots" => array(
				[
					"name" => "header",
					"type" => "textfield",
					"desc" => "Header",
				],
				[
					"name" => "content",
					"type" => "text",
					"desc" => "Content",
				],
			),
		),
		"hero_item" => array(
			"template" => "hero_item",
			"name" => "Hero Section",
			"slots" => array(
				[
					"name" => "subheader",
					"type" => "textfield",
					"desc" => "Subheader",
				],
				[
					"name" => "header",
					"type" => "textfield",
					"desc" => "Title",
				],
				[
					"name" => "header_link",
					"type" => "textfield",
					"desc" => "Link",
				],
				[
					"name" => "hero_image",
					"type" => "image",
					"desc" => "Hero image",
				],
			),
		),
		"products_item" => array(
			"template" => "products_item",
			"name" => "Product List Section",
			"slots" => array(
				[
					"name" => "product_list",
					"type" => "handpicked",
					"desc" => "Products",
					"variants" => true,
				],
			),
		),
		"slideshow_item" => array(
			"template" => "slideshow_item",
			"name" => "Slideshow Section",
			"slots" => array(
				[
					"name" => "slideshow_list",
					"type" => "slideshow",
					"desc" => "Select images for the lookbook",
				],
			)
		),
	),
	"SECTIONS" => array(

		"pages" => array(
			"ARTICLE",
			'PAGES',
			'settings' => array('template' => 'info_item', 'templates' => ['info_item','slideshow_item','hero_item','products_item'], 'hide_forms' => $cms_standard_settings['hide_forms'])
		),
		"lookbooks" => array(
			"ARTICLE",
			'LOOKBOOKS',
			'settings' => array('template' => 'slideshow_item', 'templates' => ['slideshow_item'], 'hide_forms' => $cms_standard_settings['hide_forms'])
		),
	)
);

unset($usr_conf["CMS_CONF"]['SECTIONS']['lookbooks']['settings']['hide_forms']['art_mediasrc']);
$usr_conf["CMS_CONF"]['SECTIONS']['lookbooks']['settings']['list_size'] = 'lookbook_front';
``` 
