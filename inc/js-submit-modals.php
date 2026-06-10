<script>

/* MODÁLNE OKNÁ - ODOSIELANIE DÁT VYKONÁVACÍM SKRIPTOM
*********************************************************************************************
*/	

	//# Prihlásenie
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#login .btn-primary", function(){
		
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		var $errors = [];
		var $user = $("#user").val();
		$("#login .required").each(function(index, value){
			
			var $value = $(this).val(); 
			if ($.trim($value) == ""){
				$errors.push(index);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
		});
						
		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Not fill all fields!");
			$(".error-field").next().first().focus();
			return false;
		}
		
		// Odošli dáta vykonávaciemu skriptu
		$.ajax({
			url: "scripts/login.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Login...");
			},
			data: $("#login :input").serialize(),
			cache: false,
			dataType: "text",
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);

				switch($result) {
					case "Logged in":
						location.reload();
						break;
					case "User not exist":
						alert("User not exist!");
						$("#pwd").val("");
						$("#user").val("").prev().css({"color":"#B93A32"}).addClass("error-field").next().focus();
						break;
					case "Bad password":
						alert("Wrong password!");
						$("#pwd").val("").prev().css({"color":"#B93A32"}).addClass("error-field").next().focus();
						break;
					case "Unchanged password":
					
						$.ajax({    
							type: 'POST',
							url: 'modals/password-change.php',
							dataType: 'html',
							data:"user="+$user,
							beforeSend: function(){							
							},
							success: function(response){
								$('#modals').html(response);
								$("#pwd-change").modal({backdrop: false});
								draggable(".modal-dialog");
								console.log(response);
							}
						});			
						break;
					default:
						alert("Login malfunction: "+$result);
						$("#user, #pwd").prev().css({"color":"#000"}).removeClass("error-field");
				}
			},
		});
	});

	//# LOGIN ENG
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#englogin .btn-primary", function(){

		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		var $errors = [];
		var $user = $("#user").val();
		$("#englogin .required").each(function(index, value){

			var $value = $(this).val();
			if ($.trim($value) == ""){
				$errors.push(index);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Not fill all fields!");
			$(".error-field").next().first().focus();
			return false;
		}

		// Odošli dáta vykonávaciemu skriptu
		$.ajax({
			url: "scripts/login.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Loggin in...");
			},
			data: $("#englogin :input").serialize(),
			cache: false,
			dataType: "text",
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);

				switch($result) {
					case "Logged in":
						location.reload();
						break;
					case "User not exist":
						alert("User not exist!");
						$("#pwd").val("");
						$("#user").val("").prev().css({"color":"#B93A32"}).addClass("error-field").next().focus();
						break;
					case "Bad password":
						alert("Invalid password!");
						$("#pwd").val("").prev().css({"color":"#B93A32"}).addClass("error-field").next().focus();
						break;
					case "Unchanged password":

						$.ajax({
							type: 'POST',
							url: 'modals/password-change.php',
							dataType: 'html',
							data:"user="+$user,
							beforeSend: function(){
							},
							success: function(response){
								$('#modals').html(response);
								$("#pwd-change").modal({backdrop: false});
								draggable(".modal-dialog");
								console.log(response);
							}
						});
						break;
					default:
						alert("Počas prihlasovania sa vyskytla chyba: "+$result);
						$("#user, #pwd").prev().css({"color":"#000"}).removeClass("error-field");
				}
			},
		});
	});

	//# Zmena hesla
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#pwd-change .btn-primary", function(e){
		var $errors = [],
				$pwd = $("#pwd-new").val(),
				$pwd_rpt = $("#pwd-new-repeat").val();
				
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#pwd-change .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).attr("data-error");			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Not fill: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
		
		// Over pravidlá pre zmenu hesla 
		if($pwd != $pwd_rpt){
			alert("Passwords not the same!");
			$("#pwd-new-repeat").val("").focus().prev().css({"color":"#B93A32"}).addClass("error-field");
			return false; 
		}else{
			$("#pwd-new, #pwd-new-repeat").prev().css({"color":"#000"}).removeClass("error-field");
		}
		
		if($("#pwd-new").val().length < 8){
			alert("Password must have minimal 8 symbols!");
			$("#pwd-new-repeat").val("");
			$("#pwd-new").prev().css({"color":"#B93A32"}).addClass("error-field").next().focus();
			return false;
		}else{
			$("#pwd-new").prev().css({"color":"#000"}).removeClass("error-field");
		}
		
		if(checkStrength($pwd) < 3){
			alert("Write stronger password!");
			$("#pwd-new").prev().css({"color":"#B93A32"}).addClass("error-field").next().focus();
			return false;
		}else{
			$("#pwd-new").prev().css({"color":"#000"}).removeClass("error-field");
		}
		
		// Odošli dáta vykonávaciemu skriptu
		$.ajax({
			url: "scripts/change-password.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Change password...");
			},
			data: $("#pwd-change :input").serialize(),
			cache: false,
			dataType: "text",
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "Changed":
						location.reload();
						break;
					case "User not exist":
						alert("Write correct login name!");
						break;
					default:
						alert("Edit password malfunction: "+$result);
						break;
				}
			}
		});
	});
		
	
	//# Nový proces
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#new-process form", function(e){
		e.preventDefault();
		var $data = new FormData(this);
		var $focus = $('#focus').map(function() {
			return $(this).val();
		}).toArray();
		
		for (var $i = 0; $i < $focus.length; $i++){
				$data.append('focus[]', $focus[$i]);
		};
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#new-process .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("You not fill: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}			
		
		// Vlož dáta do databázy
		$.ajax({
			url: "scripts/insert-process.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Adding new process...");
			},
			data:$data,
			cache: false,
			processData: false,
			contentType: false,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("You are not fill add fields!");
						break;					
					default:
						alert("Malfunction: "+$result);
						break;
				};
			}
		});
	});
	
	//# Úprava procesu
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#business-trip-edit form", function(e){
		e.preventDefault();
		var $data = new FormData(this);
		var $focus = $('#focus').map(function() {
			return $(this).val();
		}).toArray();
		
		for (var $i = 0; $i < $focus.length; $i++){
				$data.append('focus[]', $focus[$i]);
		};

		var $merge = $('#merge').map(function() {
			return $(this).val();
		}).toArray();

		for (var $i = 0; $i < $merge.length; $i++){
				$data.append('merge[]', $merge[$i]);
		};

		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#business-trip-edit .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("You are not fill: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
		
		// Vlož dáta do databázy
		$.ajax({
			url: "scripts/edit-process.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Updating process...");
			},
			data:$data,
			cache: false,
			processData: false,
			contentType: false,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("You not feel all fields!");
						break;					
					default:
						alert("Malfunction: "+$result);
						break;
				};
			}
		});
	});
	
	//# Odstránenie procesu
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#trip-delete .btn-danger", function(){
		var $id = $(this).attr("data-id"),
				$att_url = $(this).attr("data-att-url"),
				$att_url2 = $(this).attr("data-att-url2")
		;

		$.ajax({    
			type: 'POST',
			url: 'scripts/delete-proc.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Deleting process...");
			},
			data:{id:$id, att_url:$att_url, att_url2:$att_url2},
			success: function(data){
				var $result = $.trim(data);
				console.log($result);
				
				switch ($result) {
					case "OK":
						location.href="?page=all-proc";
						break;
					default:
						alert("Delete malfunction: "+$result);
						break;
				};
				
			}
		});
	});
	
		
	//# Vloženie prílohy
 //-----------------------------------------------------------------------------------------
	$(document).on("submit", "#attachment-insert form", function(e){
		e.preventDefault();
		
		if($("#attachment-insert #attachment").val() == ''){
			$("#attachment-insert .modal-body").find("p").css({"color":"#B93A32"}).addClass("error-field");
			alert("Vyberte nejakú prílohu!");
      return false;
		}		
		var $data = new FormData(this);
		$.ajax({    
			url: "scripts/upload-attachment.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Uploading attachment...");
			},
			data:$data,
			cache: false,
			processData: false,
			contentType: false,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					default:
						alert("Attachment uploading malfunction: "+$result);
						break;
				};
				
			}
		});
	});

//# Vloženie prílohy ENG
 //-----------------------------------------------------------------------------------------
	$(document).on("submit", "#attachment-insert-eng form", function(e){
		e.preventDefault();

		if($("#attachment-insert-eng #attachment").val() == ''){
			$("#attachment-insert-eng .modal-body").find("p").css({"color":"#B93A32"}).addClass("error-field");
			alert("Choose attachment!");
      return false;
		}
		var $data = new FormData(this);
		$.ajax({
			url: "scripts/upload-attachment.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Uplading attachment...");
			},
			data:$data,
			cache: false,
			processData: false,
			contentType: false,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					default:
						alert("Upload bug: "+$result);
						break;
				};

			}
		});
	});

	//# Vloženie diagramu
 //-----------------------------------------------------------------------------------------
	$(document).on("submit", "#attdiagram-insert form", function(e){
		e.preventDefault();

		if($("#attdiagram-insert #attdiagram").val() == ''){
			$("#attdiagram-insert .modal-body").find("p").css({"color":"#B93A32"}).addClass("error-field");
			alert("Vyberte nejakú prílohu!");
      return false;
		}
		var $data = new FormData(this);
		$.ajax({
			url: "scripts/upload-attdiagram.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Uploading attachment...");
			},
			data:$data,
			cache: false,
			processData: false,
			contentType: false,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					default:
						alert("Malfunction: "+$result);
						break;
				};

			}
		});
	});

	//# Odstránenie prílohy
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#attachment-delete .btn-danger", function(){
		var $id = $(this).attr("data-id"),
				$att = $(this).attr("data-att")
		;

		$.ajax({    
			type: 'POST',
			url: 'scripts/delete-attachment.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Deleting attachment...");
			},
			data:{id:$id, att:$att},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					default:
						alert("Malfunction: "+$result);
						break;
				};
				
			}
		});
	});

	//# Odstránenie diagramu
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#attdiagram-delete .btn-danger", function(){
		var $id = $(this).attr("data-id"),
				$att = $(this).attr("data-att")
		;

		$.ajax({
			type: 'POST',
			url: 'scripts/delete-attdiagram.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Deleting attachment...");
			},
			data:{id:$id, att:$att},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					default:
						alert("Malfunction: "+$result);
						break;
				};

			}
		});
	});
	//# Nová organizačná zložka
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#section-insert form", function(e){
		e.preventDefault();
		var $name = $("#section-name").val(),
		    $short_name = $("#section-short").val(),
		    $array = $("#section-array").val()
		;
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#section-insert .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Not fill: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
							
		$.ajax({    
			type: 'POST',
			url: 'scripts/insert-section.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Adding new department...");
			},
			data:{"section-name":$name, "section-short":$short_name, "section-array":$array},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				console.log($result);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("Not fill all fields!");
						break;
					case "Record exist":
            alert("Department or acronym is existing!");
						break;
					default:
						alert("Malfunction: "+$result);
						break;
				};
				
			}
		});
	});
	
	//# Úprava organizačnej zložky
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#section-edit form", function(e){
		e.preventDefault();
		var $data = new FormData(this);
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#section-edit .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Not fill: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
		
		// Vlož dáta do databázy
		$.ajax({
			type: 'POST',
			url: 'scripts/edit-section.php',
			cache: false,
			processData: false, // dôležité pri var $data = new FormData(this);
			contentType: false, // dôležité pri var $data = new FormData(this);
			beforeSend: function(){
				showOverlay("Editing department...");
			},
			data:$data,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("Not fill all fieldsa!");
						break;
					case "Record exist":
            alert("Department or acronym is existing!");
						break;
					default:
						alert("Malfunction: "+$result);
						break;
				};
			}
		});
	});
	
	//# Odstránenie organizačnej zložky
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#section-delete .btn-danger", function(){
		var $id = $(this).attr("data-id");

		$.ajax({    
			type: 'POST',
			url: 'scripts/delete-section.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Deleting department...");
			},
			data:{id:$id},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Record required":
						alert("Department is part of some process!");
						break;
					default:
						alert("Malfunction: "+$result);
						break;
				};
				
			}
		});
	});
	
	//# Nová zodpovedná pozícia
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#type-insert form", function(e){
		e.preventDefault();
		var $name = $("#type-name").val();
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#type-insert .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Not fill: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
							
		$.ajax({    
			type: 'POST',
			url: 'scripts/insert-type.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Pridávam novú zodpovednú pozíciu...");
			},
			data:{"type-name":$name},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				console.log($result);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("Nevyplnili ste všetky povinné polia!");
						break;
					case "Record exist":
            alert("Zadané podujatie už existuje!");
						break;
					default:
						alert("Počas pridávania nového podujatia sa vyskytla nasledovná chyba: "+$result);
						break;
				};
				
			}
		});
	});
	
	//# Úprava typu podujatia
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#type-edit form", function(e){
		e.preventDefault();
		var $data = new FormData(this);
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#type-edit .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Nevyplnili ste: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
		
		// Vlož dáta do databázy
		$.ajax({
			type: 'POST',
			url: 'scripts/edit-type.php',
			cache: false,
			processData: false, // dôležité pri var $data = new FormData(this);
			contentType: false, // dôležité pri var $data = new FormData(this);
			beforeSend: function(){
				showOverlay("Upravujem zodpovednú pozíciu...");
			},
			data:$data,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("Nevyplnili ste všetky povinné polia!");
						break;
					case "Record exist":
            alert("Zadaná pozícia už existuje!");
						break;
					default:
						alert("Počas úpravy pozzície sa vyskytla nasledovná chyba: "+$result);
						break;
				};
			}
		});
	});
	
	//# Odstránenie pozície
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#type-delete .btn-danger", function(){
		var $id = $(this).attr("data-id");

		$.ajax({    
			type: 'POST',
			url: 'scripts/delete-type.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Odstraňujem pozíciu...");
			},
			data:{id:$id},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Record required":
						alert("Pozícia, ktorú chcete odstrániť je priradená minimálne k jednému procesu a preto ju nie je možné odstrániť!");
						break;
					default:
						alert("Počas odstraňovania pozície sa vyskytla nasledovná chyba: "+$result);
						break;
				};
				
			}
		});
	});
	
	//# Nové zameranie
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#focus-insert form", function(e){
		e.preventDefault();
		var $name = $("#focus-name").val();
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#focus-insert .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Nevyplnili ste: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
							
		$.ajax({    
			type: 'POST',
			url: 'scripts/insert-focus.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Pridávam nové zameranie...");
			},
			data:{"focus-name":$name},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				console.log($result);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("Nevyplnili ste všetky povinné polia!");
						break;
					case "Record exist":
            alert("Zadané zameranie už existuje!");
						break;
					default:
						alert("Počas pridávania nového zamerania sa vyskytla nasledovná chyba: "+$result);
						break;
				};
				
			}
		});
	});
	
	//# Úprava zamerania
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#focus-edit form", function(e){
		e.preventDefault();
		var $data = new FormData(this);
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#focus-edit .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Nevyplnili ste: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
		
		// Vlož dáta do databázy
		$.ajax({
			type: 'POST',
			url: 'scripts/edit-focus.php',
			cache: false,
			processData: false, // dôležité pri var $data = new FormData(this);
			contentType: false, // dôležité pri var $data = new FormData(this);
			beforeSend: function(){
				showOverlay("Upravujem zameranie...");
			},
			data:$data,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("Nevyplnili ste všetky povinné polia!");
						break;
					case "Record exist":
            alert("Zadané zameranie už existuje!");
						break;
					default:
						alert("Počas úpravy zamerania sa vyskytla nasledovná chyba: "+$result);
						break;
				};
			}
		});
	});
	
	//# Odstránenie zamerania
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#focus-delete .btn-danger", function(){
		var $id = $(this).attr("data-id");

		$.ajax({    
			type: 'POST',
			url: 'scripts/delete-focus.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Deleting work position...");
			},
			data:{id:$id},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Record required":
						alert("Work position is part of process as member or responsible of some process!");
						break;
					default:
						alert("malfunction: "+$result);
						break;
				};
				
			}
		});
	});
	
	//# Nový používateľ
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#user-insert form", function(e){
		e.preventDefault();
		var $data = new FormData(this);
		var $perm = $('#perm').map(function() {
			return $(this).val();
		}).toArray();
		
		for (var $i = 0; $i < $perm.length; $i++){
				$data.append('perm[]', $perm[$i]);
		};
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#user-insert .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("You are not fill: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}			
		
		// Vlož dáta do databázy
		$.ajax({
			url: "scripts/insert-user.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Adding new user...");
			},
			data:$data,
			cache: false,
			processData: false,
			contentType: false,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("You are not fill all fields!");
						break;
					case "Record exist":
            alert("Alias is existing!");
						break;					
					default:
						alert("Malfunction: "+$result);
						break;
				};
			}
		});
	});
	
	//# Úprava používateľa
 //-----------------------------------------------------------------------------------------
	
	$(document).on("submit","#user-edit form", function(e){
		e.preventDefault();
		var $data = new FormData(this);
		var $perm = $('#perm').map(function() {
			return $(this).val();
		}).toArray();
		
		for (var $i = 0; $i < $perm.length; $i++){
				$data.append('perm[]', $perm[$i]);
		};
		
		var $errors = [];
		// Skontroluj, či sú vyplnené všetky povinné polia, ktoré majú CSS triedu "required"
		$("#user-edit .required").each(function(index, value){
			
			var $value = $(this).val(),
          $text = $(this).prev().text();			
			if ($.trim($value) == ""){
				$errors.push(" "+$text);
				$(this).prev().css({"color":"#B93A32"}).addClass("error-field");
			}else{
				$(this).prev().css({"color":"#000"}).removeClass("error-field");
			}
			
		});

		// Ak nie sú vyplnené všetky povinné polia, tak zobraz chybu
		if(!$.isEmptyObject($errors)){
			alert("Nevyplnili ste: "+$errors);
			$(".error-field").next().first().focus();
			return false; 
		}
		
		// Vlož dáta do databázy
		$.ajax({
			url: "scripts/edit-user.php",
			method: "POST",
			beforeSend: function(){
				showOverlay("Editing user...");
			},
			data:$data,
			cache: false,
			processData: false,
			contentType: false,
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Required is missing":
            alert("You are not fill all fields!");
						break;
					case "Record exist":
            alert("Alias is existing!");
						break;					
					default:
						alert("Malfunction: "+$result);
						break;
				};
			}
		});
	});
	
	//# Odstránenie používateľa
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "#user-delete .btn-danger", function(){
		var $id = $(this).attr("data-id");

		$.ajax({    
			type: 'POST',
			url: 'scripts/delete-user.php',
			dataType: 'html',
			beforeSend: function(){
				showOverlay("Deleting user...");
			},
			data:{id:$id},
			success: function(data){
				hideOverlay();
				var $result = $.trim(data);
				switch ($result) {
					case "OK":
						location.reload();
						break;
					case "Logged user":
						alert("User is logged in is not possible to delete user!");
						break;
					default:
						alert("Malfunction: "+$result);
						break;
				};
				
			}
		});
	});
</script>