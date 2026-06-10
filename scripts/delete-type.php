<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pozicii", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	
	$sql = "SELECT * FROM tbl_proc WHERE zodp_id = $id";
	$result = mysqli_query($connect, $sql);
	if(mysqli_num_rows($result)>0){
		echo "Record required";
		exit;
	}
	
	$sql = "DELETE FROM tbl_zodp WHERE tbl_zodp_id = $id";
	if(mysqli_query($connect, $sql)){
		echo "OK";
	}else{
		echo mysqli_error($connect);
	}

?>