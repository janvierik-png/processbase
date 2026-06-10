function draggable(element){
	$(element).draggable({
		handle: ".modal-header",
		drag: function(){ 
			$(this).css("height","auto");
		}
	})
}

//# Replace diacritics
function replaceDiacritics(text) {
	var diacritics = {
		a: 'ÀÁÂÃÄÅàáâãäåĀāąĄ',
		c: 'ÇçćĆčČ',
		d: 'đĐďĎ',
		e: 'ÈÉÊËèéêëěĚĒēęĘ',
		i: 'ÌÍÎÏìíîïĪī',
		l: 'łŁĽľ',
		n: 'ÑñňŇńŃ',
		o: 'ÒÓÔÕÕÖØòóôõöøŌō',
		r: 'řŘ',
		s: 'ŠšśŚ',
		t: 'ťŤ',
		u: 'ÙÚÛÜùúûüůŮŪū',
		y: 'ŸÿýÝ',
		z: 'ŽžżŻźŹ'
	}
	for(var toLetter in diacritics) if(diacritics.hasOwnProperty(toLetter)) {
		for(var i = 0, ii = diacritics[toLetter].length, fromLetter, toCaseLetter; i < ii; i++) {
			fromLetter = diacritics[toLetter][i];
			if(text.indexOf(fromLetter) < 0) continue;
			toCaseLetter = fromLetter == fromLetter.toUpperCase() ? toLetter.toUpperCase() : toLetter;
			text = text.replace(new RegExp(fromLetter, 'g'), toCaseLetter);
		}
	}
	return text;
}

/* OVERLAY
*****************************************************************************
*/

//# Show overlay
function showOverlay(txt){
	$('#overlay').css({'display':'block','background':'#fff'});
	$('#spinner').css({'display':'block'});
	$('#spinner-text').text(txt).css({'color':'#000','font-size':'14px'});
}

//# Show transparent overlay
function showOverlayTransparent(txt){
	$('#overlay').css({'display':'block','background':'transparent'});
	$('#spinner').css({'display':'block'});
	$('#spinner-text').text(txt).css({'color':'#000','font-size':'14px'});
}

//# Hide overlay
function hideOverlay(){
	$('#overlay').fadeOut('slow');
}
