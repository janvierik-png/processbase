<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_ucast", $permissions)) exit;
	require_once("../inc/clear-input.php");	
	
?>

<!-- Modal -->
<div id="focus-insert" class="modal fade" role="dialog"  data-backdrop="static">
  <div class="modal-dialog modal-30">

    <!-- Modal content-->
    <div class="modal-content">
			<form enctype="multipart/form-data">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title"><span class="glyphicon glyphicon-comment"></span> Add new work position</h4>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label for="focus-name">Work position name</label>
						<input type="text" class="form-control required" id="focus-name" name="focus-name" placeholder="Write a name of work position...">
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
$('#focus-insert').on('shown.bs.modal', function () {
	$('#focus-name').focus();
});
</script>