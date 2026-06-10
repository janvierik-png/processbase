<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_odborov", $permissions)) exit;
	require_once("../inc/clear-input.php");	
	
	$id = clear_input($_POST["id"]);
	$sql = "SELECT * FROM tbl_odbory WHERE tbl_odbory_id = $id";
	$result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_assoc($result);
	$short = $row["odbor"];
	$name = $row["cely_nazov"];
	$array = $row["poradie"];
	
?>

<!-- Modal -->
<div id="section-edit" class="modal fade" role="dialog"  data-backdrop="static">
  <div class="modal-dialog modal-30">

    <!-- Modal content-->
    <div class="modal-content">
			<form enctype="multipart/form-data">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title"><span class="glyphicon glyphicon-map-marker"></span> Edit department</h4>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label for="section-short">Acronym of department</label>
						<input type="text" class="form-control required" id="section-short" name="section-short" value="<?php echo $short ?>" placeholder="Acronym...">
					</div>
					<div class="form-group">
						<label for="section-name">Name of department</label>
						<input type="text" class="form-control required" id="section-name" name="section-name" value="<?php echo $name ?>" placeholder="Department name...">
						<input type="hidden" name="id" value="<?php echo $id ?>">
					</div>
					<div class="form-group">
						<label for="section-array">Number for ordering</label>
						<input type="text" class="form-control required" id="section-array" name="section-array" value="<?php echo $array ?>" placeholder="Add order number for department (important for tree structure)...">
						<input type="hidden" name="id" value="<?php echo $id ?>">
					</div>
				</div>
				<div class="modal-footer">
					<button type="submit" class="btn btn-warning">Update</button>
					<button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
				</div>
			</form>
    </div>
  </div>
</div>
<script>
//# Kurzor v prvom vstupnom poli modálneho okna
$('#section-edit').on('shown.bs.modal', function () {
	$('#section-short').focus();
});
</script>