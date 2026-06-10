<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pouzivatelov", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	
	$sql = "SELECT * FROM tbl_pouzivatelia
					LEFT JOIN tbl_odbory
					ON tbl_pouzivatelia.odbor_id = tbl_odbory.tbl_odbory_id
					WHERE id_pouzivatela = $id
	";
	$result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_assoc($result);
	
	
	$section_id = $row["odbor_id"];
	$section = $row["cely_nazov"];
 	$name = $row["meno_pouzivatela"];
  $alias = $row["alias_pouzivatela"];
	$pwd = $row["heslo_pouzivatela"];
	$pwd_login = $row["zmenene_heslo"]; 
		
?>

<!-- Modal -->
<div class="modal fade" id="user-edit" role="dialog" data-backdrop="static">
	<div class="modal-dialog">
	
		<!-- Modal content-->
		<div class="modal-content">
			<form enctype="multipart/form-data">
				<input type="hidden" id="id" name="id" value="<?php echo $id ?>">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title"><span class="glyphicon glyphicon-user"></span> User edit</h4>
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
								$sect_id = $row["tbl_odbory_id"];
								$sect_short = $row["odbor"];
								$sect_name = $row["cely_nazov"];
							?>	
							<option value="<?php echo $sect_id ?>" title="<?php echo $sect_name ?>" <?php if($section_id == $sect_id) echo "selected" ?>><?php echo $sect_short ?></option>  
							<?php
							}
							?>
						</select>
					</div>
				
					<div class="form-group">
						<label for="alias">User alias/login name</label>
						<input type="text" class="form-control required" id="alias" name="alias" value="<?php echo $alias ?>" placeholder="Write alias of new user...">
					</div>
								
					<div class="form-group">
						<label for="name">Name of user</label>
						<input type="text" class="form-control required" id="name" name="name" value="<?php echo $name ?>" placeholder="Write name of user...">
					</div>
					
					<div class="form-group">
						<label for="pwd">User password</label>
						<input type="text" class="form-control required" id="pwd" name="pwd" value="<?php echo $pwd ?>" placeholder="Write password...">
					</div>
										
					<div class="form-group">
						<label for="pwd-login">Password changed by user?</label>
						<select class="form-control required" id="pwd-login" name="pwd-login">
							<option value="1" <?php echo $pwd_login == 1 ? "selected" : "" ?>>YES</option>
							<option value="0" <?php echo $pwd_login == 0 ? "selected" : "" ?>>NO</option>
						</select>
					</div>
				
					<div class="form-group">
						<label for="perm">Rights</label>
						<select class="chosen-select required" id="perm" name="perm" data-placeholder="Choose right for user..." multiple>
							<option></option>
							<?php
								
								$perm_arr = array();
								$sql = "SELECT * FROM tbl_pristupy WHERE id_pouzivatela = $id";
								$result = mysqli_query($connect, $sql);
								while($row = mysqli_fetch_assoc($result)){
									$pid = $row["id_druhu_pristupu"];
									array_push($perm_arr, $pid);
								
								}
								
								$sql1 = "SELECT * FROM tbl_druhy_pristupov";
								$result1 = mysqli_query($connect, $sql1);
								while($row1 = mysqli_fetch_assoc($result1)){
									$perm_id= $row1["id_pristupu"];
									$perm_name = $row1["nazov_pristupu_2"];
									
									
							?>
								<option value="<?php echo $perm_id ?>" <?php if(in_array($perm_id, $perm_arr)) echo "selected" ?>> 
									<?php echo $perm_name ?>
								</option>
							<?php
								}	
							?>
						</select>
					</div>
										
				</div>
				<div class="modal-footer">
					<button type="submit" class="btn btn-warning">Edit</button>
					<button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
				</div>
			</form>	
		</div>
	</div>
</div>
<script>

//# Kurzor v prvom vstupnom poli modálneho okna
$('#user-edit').on('shown.bs.modal', function () {
	$('#section').focus();
});

//# Vytvorí multi výberové pole
$('.chosen-select').chosen();
$('.chosen-container').css("width","100%");
$('.chosen-select-deselect').chosen({ allow_single_deselect: true });

</script>
