<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pouzivatelov", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$sid = $_SESSION['procesy-user-id'];
	
	if($id == $sid){
		echo "Logged user";
		exit;
	}
			
	$sql = "DELETE FROM tbl_pouzivatelia WHERE id_pouzivatela = $id";
	$result = mysqli_query($connect, $sql);
	
	$sql1 = "DELETE FROM tbl_pristupy WHERE id_pouzivatela = $id";  
	$result1 = mysqli_query($connect, $sql1);

	if($result && $result1){
		echo "OK";
	}else{
		echo mysqli_error($connect);
	}

?>