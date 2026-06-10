<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_odborov", $permissions)) exit;
	require_once("../inc/clear-input.php");	
	
?>

<!-- Modal -->
<div id="section-insert" class="modal fade" role="dialog"  data-backdrop="static">
  <div class="modal-dialog modal-30">

    <!-- Modal content-->
    <div class="modal-content">
			<form enctype="multipart/form-data">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title"><span class="glyphicon glyphicon-map-marker"></span> Add new department </h4>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label for="section-short">Acronym of department</label>
						<input type="text" class="form-control required" id="section-short" name="section-short" placeholder="Acronym...">
					</div>
					<div class="form-group">
						<label for="section-name">Name of department</label>
						<input type="text" class="form-control required" id="section-name" name="section-name" placeholder="Department name...">
					</div>
					<div class="form-group">
						<label for="section-array">Number for ordering</label>
						<input type="text" class="form-control required" id="section-array" name="section-array" placeholder="Add order number for department (important for tree structure)...">

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
$('#section-insert').on('shown.bs.modal', function () {
	$('#section-short').focus();
});
</script>