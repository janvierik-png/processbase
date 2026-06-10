<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$name = clear_input($_POST["name"]);
	$att = clear_input($_POST["att"]);
	
?>

<!-- Modal -->
<div id="attdiagram-delete" class="modal fade" role="dialog"  data-backdrop="static">
  <div class="modal-dialog">

    <!-- Modal content-->
    <div class="modal-content">
      <div class="modal-header bg-danger">
        <button type="button" class="close" data-dismiss="modal">&times;</button>
        <h4 class="modal-title">Delete attachment</h4>
      </div>
      <div class="modal-body">
        <p>Do you really want to delete the diagram named<b><?php echo $name ?></b>?</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-danger" data-id="<?php echo $id ?>" data-att="<?php echo $att ?>">YES</button>
        <button type="button" class="btn btn-default" data-dismiss="modal">NO</button>
      </div>
    </div>

  </div>
</div>
