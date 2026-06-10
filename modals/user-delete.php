<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pouzivatelov", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$name = clear_input($_POST["name"]);
	
?>

<!-- Modal -->
<div id="user-delete" class="modal fade" role="dialog"  data-backdrop="static">
  <div class="modal-dialog">

    <!-- Modal content-->
    <div class="modal-content">
      <div class="modal-header bg-danger">
        <button type="button" class="close" data-dismiss="modal">&times;</button>
        <h4 class="modal-title">Odstránenie používateľa</h4>
      </div>
      <div class="modal-body">
        <p>Naozaj si želáte odstrániť používateľa <b><?php echo $name ?></b>?</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-danger" data-id="<?php echo $id ?>">Áno</button>
        <button type="button" class="btn btn-default" data-dismiss="modal">Nie</button>
      </div>
    </div>

  </div>
</div>
