function local_api_call(url, opts) {
	return fetch(url, opts).then(function(r){
		return r.text()
	});
}
function set_payment_method(payment_method) {
	document.getElementById('payment-method-form').submit();
}
function change_country(country) {
	change_location({ country: country });
}
function change_state(country, country_state) {
	change_location({ country: country, country_state: country_state });
}
function change_location(data) {
	local_api_call(base + '/change-country', {
		method:'POST',
		headers:{'Content-type': 'application/json'},
		body: JSON.stringify(data),
		credentials: 'same-origin',
	}).then(function(r){
		if(r==='OK'){
			window.location.href = window.location.href
		}
	}).catch(function(err){
		alert(err)
	})
}
function change_language(language) {
	local_api_call('/change-language', {
		method:'POST',
		headers:{'Content-type': 'application/json'},
		body: JSON.stringify({ language: language }),
		credentials: 'same-origin',
	}).then(function(r){
		if(r==='OK')
			location.href = '/' + language + '/';
		else if(r === 'OKD')
			location.href = '/';
	}).catch(function(err){
		alert(err)
	})
}
function subscribe(email_field) {
	if(!email_field.value.length || !email_field.validity.valid) return false;
	local_api_call('/email-subscribe', {
		method:'POST',
		headers:{'Content-type': 'application/json'},
		body: JSON.stringify({ email: email_field.value }),
		credentials: 'same-origin',
	}).then(function(r){
		if(r==='OK'){
			email_field.value = '';
			old_placeholder = email_field.placeholder;
			email_field.placeholder = 'Thanks!';
			setTimeout(function() { email_field.placeholder = old_placeholder }, 1000);
		}
	}).catch(function(err){
		alert(err)
	});
	return false;
}
