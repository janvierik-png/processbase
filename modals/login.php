<?php


?>

<!-- Modal -->
<div class="modal fade" id="login" role="dialog" data-backdrop="static">
	<div class="modal-dialog modal-sm">
	
		<!-- Modal content-->
		<div class="modal-content">
			<div class="modal-header">
				<button type="button" class="close" data-dismiss="modal">&times;</button>
				<h4 class="modal-title"><span class="glyphicon glyphicon-log-in"></span> Login</h4>
			</div>
			<div class="modal-body">
				<div class="form-group">
					<label for="user"><span class="glyphicon glyphicon-user"></span> Name</label>
					<input type="text" class="form-control required" id="user" name="user" placeholder="Write login name...">
				</div>
				<div class="form-group">
					<label for="pwd"><span class="glyphicon glyphicon-lock"></span> Password</label>
					<input type="password" class="form-control required" id="pwd" name="pwd" placeholder="Write login password...">
				</div>
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-primary">Login</button>
			</div>
		</div>
		
	</div>
</div>

<script>

	//# Kurzor v prvom vstupnom poli modálneho okna
	$('#login').on('shown.bs.modal', function () {
		$('#user').focus();
	});
	
</script>