<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pozicii", $permissions)) exit;
	require_once("../inc/clear-input.php");	
	
	$id = clear_input($_POST["id"]);
	$sql = "SELECT * FROM tbl_zodp WHERE tbl_zodp_id = $id";
	$result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_assoc($result);
	$name = $row["zodp"];
	
?>

<!-- Modal -->
<div id="type-edit" class="modal fade" role="dialog"  data-backdrop="static">
  <div class="modal-dialog modal-30">

    <!-- Modal content-->
    <div class="modal-content">
			<form enctype="multipart/form-data">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title"><span class="glyphicon glyphicon-blackboard"></span> Úprava typu podujatia</h4>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label for="type-name">Názov zodpovednej pozície</label>
						<input type="text" class="form-control required" id="type-name" name="type-name" value="<?php echo $name ?>" placeholder="Zadajte názov...">
						<input type="hidden" name="id" value="<?php echo $id ?>">
					</div>
				</div>
				<div class="modal-footer">
					<button type="submit" class="btn btn-warning">Upraviť</button>
					<button type="button" class="btn btn-default" data-dismiss="modal">Zrušiť</button>
				</div>
			</form>
    </div>
  </div>
</div>
<script>
//# Kurzor v prvom vstupnom poli modálneho okna
$('#type-edit').on('shown.bs.modal', function () {
	$('#type-name').focus();
});
</script>