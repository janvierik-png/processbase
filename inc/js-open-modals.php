<script>

/* MODÁLNE OKNÁ - ZOBRAZENIE
*********************************************************************************************
*/	

	//# Zobraz prihlasovací formulár
	$(document).on("click", "[data-target='#login']", function(){
		$.ajax({    
			type: 'POST',
			url: 'modals/login.php',             
			dataType: 'html',
			beforeSend: function(){
				$(".modal-backdrop").remove();		
			},
			success: function(response){
				$('#modals').html(response);
				$("#login").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});

	//# Zobraz prihlasovací formulár ENG
	$(document).on("click", "[data-target='#englogin']", function(){
		$.ajax({
			type: 'POST',
			url: 'modals/eng/login.php',
			dataType: 'html',
			beforeSend: function(){
				$(".modal-backdrop").remove();
			},
			success: function(response){
				$('#modals').html(response);
				$("#login").modal("show");
				draggable(".modal-dialog");
			}
		});
	});
		
<?php	
if(isset($_SESSION["procesy-user-alias"])){
?>
	//# Zobraz formulár na zmenu hesla, ale iba ak je používateľ prihlásený
	$(".nav #user-settings").click(function(){
		$.ajax({    
			type: 'POST',
			url: 'modals/password-change.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:"user=<?php echo $_SESSION["procesy-user-alias"] ?>",
			success: function(response){
				$('#modals').html(response);
				$("#pwd-change").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});
<?php	
}
?>

	//# Nový proces
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "[data-target='#new-process']", function(){
		$.ajax({    
			type: 'POST',
			url: 'modals/trip-insert.php',             
			dataType: 'html',
			beforeSend: function(){
				$(".modal-backdrop").remove();		
			},
			success: function(response){
				$('#modals').html(response);
				$("#new-process").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});

	//# NEW PROCESS
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "[data-target='#eng-new-process']", function(){
		$.ajax({
			type: 'POST',
			url: 'modals/eng-trip-insert.php',
			dataType: 'html',
			beforeSend: function(){
				$(".modal-backdrop").remove();
			},
			success: function(response){
				$('#modals').html(response);
				$("#eng-new-process").modal("show");
				draggable(".modal-dialog");
			}
		});
	});

	//# Úprava procesu
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='edit-proc']", function(){
		
		var $id = $(this).attr("data-id");
		
		$.ajax({    
			type: 'POST',
			url: 'modals/trip-edit.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id},
			success: function(response){
				$('#modals').html(response);
				$("#business-trip-edit").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});


//# Úprava popisu procesu
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='edit-desc']", function(){

		var $id = $(this).attr("data-id");

		$.ajax({
			type: 'POST',
			url: 'modals/trip-edit.php',
			dataType: 'html',
			beforeSend: function(){
			},
			data:{id:$id},
			success: function(response){
				$('#modals').html(response);
				$("#desc-edit").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});
	});



	//# Odstránenie procesu
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='delete-proc']", function(){
		
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name"),
				$url = $(this).attr("data-att-url"),
				$url2 = $(this).attr("data-att-url2")
		;
		
		$.ajax({    
			type: 'POST',
			url: 'modals/trip-delete.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id, name:$name, att_url:$url, att_url2:$url2},
			success: function(response){
				$('#modals').html(response);
				$("#trip-delete").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});


	//# Vloženie prílohy
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='insert-attachment']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name")
		;
		
		$.ajax({    
			type: 'POST',
			url: 'modals/attachment-insert.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#attachment-insert").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});
		//# ATTACHMENT ENG
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='insert-attachment-eng']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name")
		;

		$.ajax({
			type: 'POST',
			url: 'modals/attachment-insert-eng.php',
			dataType: 'html',
			beforeSend: function(){
			},
			data:{id:$id, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#attachment-insert-eng").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});
	});

	//# Vloženie diagramu
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='insert-attdiagram']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name")
		;

		$.ajax({
			type: 'POST',
			url: 'modals/attdiagram-insert.php',
			dataType: 'html',
			beforeSend: function(){
			},
			data:{id:$id, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#attdiagram-insert").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});
	});

	//# Odstránenie prílohy
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "a[data-action='delete-att']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name"),
				$att = $(this).attr("data-att")
		;
		
		$.ajax({    
			type: 'POST',
			url: 'modals/attachment-delete.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id, att:$att, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#attachment-delete").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});

	//# Odstránenie diagramu
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "a[data-action='delete-attdiagram']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name"),
				$att = $(this).attr("data-att")
		;

		$.ajax({
			type: 'POST',
			url: 'modals/attdiagram-delete.php',
			dataType: 'html',
			beforeSend: function(){
			},
			data:{id:$id, att:$att, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#attdiagram-delete").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});
	});
	
	//# Nová organizačná zložka
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "[data-target='#new-section']", function(){
		$.ajax({    
			type: 'POST',
			url: 'modals/section-insert.php',             
			dataType: 'html',
			beforeSend: function(){
				$(".modal-backdrop").remove();		
			},
			success: function(response){
				$('#modals').html(response);
				$("#section-insert").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});
	
	//# Úprava organizačnej zložky
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='edit-section']", function(){
		
		var $id = $(this).attr("data-id");
		
		$.ajax({    
			type: 'POST',
			url: 'modals/section-edit.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id},
			success: function(response){
				$('#modals').html(response);
				$("#section-edit").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});
	
	//# Odstránenie organizačnej zložky
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='delete-section']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name")
		;
		
		$.ajax({    
			type: 'POST',
			url: 'modals/section-delete.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#section-delete").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});
	
	//# Nová zodpovedná pozícia---------------------------------------------------------------------------------
	$(document).on("click", "[data-target='#new-type']", function(){
		$.ajax({    
			type: 'POST',
			url: 'modals/type-insert.php',             
			dataType: 'html',
			beforeSend: function(){
				$(".modal-backdrop").remove();		
			},
			success: function(response){
				$('#modals').html(response);
				$("#type-insert").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});
	
	//# Úprava typu podujatia
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='edit-type']", function(){
		
		var $id = $(this).attr("data-id");
		
		$.ajax({    
			type: 'POST',
			url: 'modals/type-edit.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id},
			success: function(response){
				$('#modals').html(response);
				$("#type-edit").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});
	
	//# Odstránenie typu podujatia
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='delete-type']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name")
		;
		
		$.ajax({    
			type: 'POST',
			url: 'modals/type-delete.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#type-delete").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});

	//# Nové zameranie
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "[data-target='#new-focus']", function(){
		$.ajax({    
			type: 'POST',
			url: 'modals/focus-insert.php',             
			dataType: 'html',
			beforeSend: function(){
				$(".modal-backdrop").remove();		
			},
			success: function(response){
				$('#modals').html(response);
				$("#focus-insert").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});
	
	//# Úprava zamerania
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='edit-focus']", function(){
		
		var $id = $(this).attr("data-id");
		
		$.ajax({    
			type: 'POST',
			url: 'modals/focus-edit.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id},
			success: function(response){
				$('#modals').html(response);
				$("#focus-edit").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});
	
	//# Odstránenie zamerania
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='delete-focus']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name")
		;
		
		$.ajax({    
			type: 'POST',
			url: 'modals/focus-delete.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#focus-delete").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});
	
	//# Nový používateľ
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "[data-target='#new-user']", function(){
		$.ajax({    
			type: 'POST',
			url: 'modals/user-insert.php',             
			dataType: 'html',
			beforeSend: function(){
				$(".modal-backdrop").remove();		
			},
			success: function(response){
				$('#modals').html(response);
				$("#user-insert").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});
	
	//# Úprava používateľa
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='edit-user']", function(){
		
		var $id = $(this).attr("data-id");
		
		$.ajax({    
			type: 'POST',
			url: 'modals/user-edit.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id},
			success: function(response){
				$('#modals').html(response);
				$("#user-edit").modal("show");
				draggable(".modal-dialog");
				console.log(response);
			}
		});			
	});
	
	//# Odstránenie používateľa
 //-----------------------------------------------------------------------------------------
	$(document).on("click", "span[data-action='delete-user']", function(){
		var $id = $(this).attr("data-id"),
				$name = $(this).attr("data-name")
		;
		
		$.ajax({    
			type: 'POST',
			url: 'modals/user-delete.php',
			dataType: 'html',
			beforeSend: function(){	
			},
			data:{id:$id, name:$name},
			success: function(response){
				$('#modals').html(response);
				$("#user-delete").modal("show");
				draggable(".modal-dialog");
			}
		});			
	});
</script>