<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$name = clear_input($_POST["name"]);
	
?>

<!-- Modal -->
<div id="attachment-insert" class="modal fade" role="dialog"  data-backdrop="static">
  <div class="modal-dialog">

    <!-- Modal content-->
    <div class="modal-content">
			<form enctype="multipart/form-data">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title">Upload attachment</h4>
				</div>
				<div class="modal-body">
					<p>Choose attachment for the process <b><?php echo $name ?></b>.</p>
					<div class="form-group">
						<input type="file" class="form-control" id="attachment" name="attachment" multiple>
					<input type="hidden" id="id" name="id" value="<?php echo $id ?>">
					</div>
				</div>
				<div class="modal-footer">
					<button type="submit" class="btn btn-primary">Upload</button>
					<button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
				</div>
			</form>
    </div>
  </div>
</div>
