<?php
session_start();

	require_once("../inc/clear-input.php");


if(isset($_POST["user"])){
	$user = clear_input($_POST["user"]);
}


?>
<!-- Modal -->
<div id="pwd-change" class="modal fade" role="dialog" data-backdrop="static">
  <div class="modal-dialog">

    <!-- Modal content-->
    <div class="modal-content">
			<div class="modal-header">
        <button type="button" class="close" data-dismiss="modal">&times;</button>
        <h4 class="modal-title">Password changing</h4>
      </div>
			<div class="modal-body">
				<div class="form-group" style="padding-left:15px;padding-right:15px">
					<label for="user"><span class="glyphicon glyphicon-user"></span> Login name</label>
					<input name="user" class="form-control required" id="user" type="text" placeholder="Write name..." data-error="User name" value="<?php echo $user ?>" readonly>
				</div>
				<div class="form-group" style="padding-left:15px;padding-right:15px">
					<label for="pwd-new"><span class="glyphicon glyphicon-lock"></span> New password</label>
					<input name="pwd-new" class="form-control required" id="pwd-new" type="password" placeholder="Write password..." data-error="New Password">
				</div>
				<div class="form-group" style="padding-left:15px;padding-right:15px">
					<label for="pwd-new-repeat"><span class="glyphicon glyphicon-lock"></span> Repeat new password</label>
					<input name="pwd-new-repeat" class="form-control required" id="pwd-new-repeat" type="password" placeholder="Write password..." data-error="Repeat New Password">
				</div>
      </div>
			<span id="password-strength" class="pull-left color1 hidden" style="padding-left:30px;padding-top:24px;">
				<span class="glyphicon glyphicon-remove"></span>
				<span class="glyphicon glyphicon-ok hidden"></span>
				<span id="password-strength-text">Weak password</span>
			</span>
			<div class="modal-footer">
        <button type="submit" class="btn btn-primary" data-toggle="tooltip" title="Change">Change</button>
				<button type="button" class="btn btn-default" data-dismiss="modal" data-toggle="tooltip" title="Cancel">Cancel</button>
			</div>
			
    </div>
  </div>
</div>
<script>

//# Kurzor v vstupnom poli hesla
$('#pwd-change').on('shown.bs.modal', function () {
	$('#pwd-new').focus();
});

//# Odstráň prekrytie po zatvorení modálneho okna
$('#pwd-change').on('hidden.bs.modal', function () {
	$(".modal-backdrop").remove();
});

//# Zmena hesla, overovanie sily zadaného nového hesla
function sum(numbers) {
	return numbers.reduce(function(a,b) {
		return a + b
	});
}
function checkStrength($password){
		var $strength = [];   
 if (/[A-Z]/.test($password)){  
		$strength.push(1);    
 }
 if (/[a-z]/.test($password)){  
		$strength.push(1);  
 } 
 if (/[0-9]/.test($password)){  
		$strength.push(1);  
 } 
 if (/[^0-9a-zA-Z *]/.test($password)){  
		$strength.push(1);  
 }
 if ($strength.length > 0){ 
	return sum($strength);
 } 
} 

$(document).on("keyup", "#pwd-new", function(){
	var $this = $(this).val(),
			$strength = checkStrength($this);
				
	if($this != ""){
		if($this.length < 8){
			$("#password-strength").removeClass("hidden").addClass("color1");
			$("#password-strength-text").html("Short password");
			$("#password-strength .glyphicon-ok").addClass("hidden");
			$("#password-strength .glyphicon-remove").removeClass("hidden");
		}else{
			$("#password-strength").removeClass (function (index, className) {
					return (className.match (/(^|\s)color\S+/g) || []).join(' ');
			});
			switch($strength){
				case 1:
					$("#password-strength").removeClass("hidden").addClass("color"+$strength);
					$("#password-strength-text").text("Weak password");
					$("#password-strength .glyphicon-ok").addClass("hidden");
					$("#password-strength .glyphicon-remove").removeClass("hidden");
					break;
				case 2:
					$("#password-strength").removeClass("hidden").addClass("color"+$strength);
					$("#password-strength-text").text("Weak password");
					$("#password-strength .glyphicon-ok").addClass("hidden");
					$("#password-strength .glyphicon-remove").removeClass("hidden");
					break;
				case 3:
					$("#password-strength").removeClass("hidden").addClass("color"+$strength);
					$("#password-strength-text").text("Almost strong password");
					$("#password-strength .glyphicon-remove").addClass("hidden");
					$("#password-strength .glyphicon-ok").removeClass("hidden");
					break;
				case 4:
					$("#password-strength").removeClass("hidden").addClass("color"+$strength);
					$("#password-strength-text").text("Strong password");
					$("#password-strength .glyphicon-remove").addClass("hidden");
					$("#password-strength .glyphicon-ok").removeClass("hidden");
					break;
			} 
		}
	}else{
		$("#password-strength").addClass("hidden");
	}
});



	
</script>