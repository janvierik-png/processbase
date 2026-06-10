<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_odborov", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	
	$sql = "SELECT * FROM tbl_proc WHERE odbor_id = $id";
	$result = mysqli_query($connect, $sql);
	if(mysqli_num_rows($result)>0){
		echo "Record required";
		exit;
	}
	
	$sql = "DELETE FROM tbl_odbory WHERE tbl_odbory_id = $id";
	if(mysqli_query($connect, $sql)){
		echo "OK";
	}else{
		echo mysqli_error($connect);
	}

?>