<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pouzivatelov", $permissions)) exit;
?>

<!-- Modal -->
<div class="modal fade" id="user-insert" role="dialog" data-backdrop="static">
	<div class="modal-dialog">
	
		<!-- Modal content-->
		<div class="modal-content">
			<form enctype="multipart/form-data">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title"><span class="glyphicon glyphicon-user"></span> Add new user</h4>
				</div>
				<div class="modal-body">

					<div class="form-group">
						<label for="section">Department</label>
						<select class="form-control required" id="section" name="section">
							<option selected disabled>Choose department...</option>
							<?php
							$sql = "SELECT * FROM tbl_odbory ORDER BY odbor";
							$result = mysqli_query($connect, $sql);
							while($row = mysqli_fetch_assoc($result)){
								$section_id = $row["tbl_odbory_id"];
								$section_short = $row["odbor"];
								$section_name = $row["cely_nazov"];
							?>	
							<option value="<?php echo $section_id ?>" title="<?php echo $section_name ?>"><?php echo $section_short ?></option>  
							<?php
							}
							?>
						</select>
					</div>
				
					<div class="form-group">
						<label for="alias">User alias/login name</label>
						<input type="text" class="form-control required" id="alias" name="alias" placeholder="Write alias of new user...">
					</div>
								
					<div class="form-group">
						<label for="name">Name of user</label>
						<input type="text" class="form-control required" id="name" name="name" placeholder="Write name of user...">
					</div>
					
					<div class="form-group">
						<label for="pwd">User password</label>
						<input type="text" class="form-control required" id="pwd" name="pwd" placeholder="Write password...">
					</div>
										
					<div class="form-group">
						<label for="pwd-login">Require the user to change their password at first login</label>
						<select class="form-control required" id="pwd-login" name="pwd-login">
							<option value="0">YES</option>
							<option value="1">NO</option>
						</select>
					</div>
				
					<div class="form-group">
						<label for="perm">Rights</label>
						<select class="chosen-select required" id="perm" name="perm" data-placeholder="Choose rights for user..." multiple>
							<option></option>
							<?php
								$sql = "SELECT * FROM tbl_druhy_pristupov";
								$result = mysqli_query($connect, $sql);
								while($row = mysqli_fetch_assoc($result)){
									$id= $row["id_pristupu"];
									$perm = $row["nazov_pristupu_2"];
									
							?>
								<option value="<?php echo $id ?>"> 
									<?php echo $perm ?>
								</option>
							<?php
								}
							?>
						</select>
					</div>
										
				</div>
				<div class="modal-footer">
					<button type="submit" class="btn btn-primary">Add</button>
					<button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
				</div>
			</form>	
		</div>
	</div>
</div>
<script>

//# Kurzor v prvom vstupnom poli modálneho okna
$('#user-insert').on('shown.bs.modal', function () {
	$('#section').focus();
});

//# Vytvorí multi výberové pole
$('.chosen-select').chosen();
$('.chosen-container').css("width","100%");
$('.chosen-select-deselect').chosen({ allow_single_deselect: true });

</script>
