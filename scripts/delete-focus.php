<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_ucast", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	
	$sql = "SELECT * FROM tbl_zameranie_proc WHERE zameranie_id = $id";
	$result = mysqli_query($connect, $sql);
	if(mysqli_num_rows($result)>0){
		echo "Record required";
		exit;
	}

	$sql = "DELETE FROM tbl_zamerania WHERE tbl_zamerania_id = $id";
	if(mysqli_query($connect, $sql)){
		echo "OK";
	}else{
		echo mysqli_error($connect);
	}

?>