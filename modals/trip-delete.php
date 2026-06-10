<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$url = clear_input($_POST["att_url"]);
	$url2 = clear_input($_POST["att_url2"]);
	$name = clear_input($_POST["name"]);
	
?>

<!-- Modal -->
<div id="trip-delete" class="modal fade" role="dialog"  data-backdrop="static">
  <div class="modal-dialog">

    <!-- Modal content-->
    <div class="modal-content">
      <div class="modal-header bg-danger">
        <button type="button" class="close" data-dismiss="modal">&times;</button>
        <h4 class="modal-title">Process Delete</h4>
      </div>
      <div class="modal-body">
        <p>You really want to remove the process with attachments <b><?php echo $name ?></b>?</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-danger" data-id="<?php echo $id ?>" data-att-url="<?php echo $url ?>" data-att-url2="<?php echo $url2 ?>">YES</button>
        <button type="button" class="btn btn-default" data-dismiss="modal">NO</button>
      </div>
    </div>

  </div>
</div>
