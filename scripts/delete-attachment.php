<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$att = clear_input($_POST["att"]);
	$url = "../uploads/".$att;
	
	$sql = "DELETE FROM tbl_prilohy WHERE tbl_prilohy_id = $id";
	if(mysqli_query($connect, $sql)){
		
		if(unlink($url)){
			echo "OK";
		}else{
			echo mysqli_error($connect);
		}
	
	}else{
		echo mysqli_error($connect);
	}

?>