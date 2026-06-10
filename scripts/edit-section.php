<?php
	session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_odborov", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$name = clear_input($_POST["section-name"]);
	$short = clear_input($_POST["section-short"]);
	$array = clear_input($_POST["section-array"]);
	
	// Povinné polia
	$required = array('section-name', 'section-short','section-array');

	$error = false;
	foreach($required as $field){
		if(empty($_POST[$field])){
			$error = true;
		}
	}
	// Odpoveď pre ajax
	if ($error){
		echo "Required is missing";
		exit;
	}
	
	$sql = "SELECT * FROM tbl_odbory WHERE tbl_odbory_id = $id";
	$result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_array($result);
	$db_id = $row["tbl_odbory_id"];
	$db_short = $row["odbor"];
	$db_name = $row["cely_nazov"];
	$db_array = $row["poradie"];


	$sql1 = "SELECT * FROM tbl_odbory WHERE odbor = '$short'";
	$result1 = mysqli_query($connect, $sql1);
	$short_count = mysqli_num_rows($result1);
	
	$sql2 = "SELECT * FROM tbl_odbory WHERE cely_nazov = '$name'";
	$result2 = mysqli_query($connect, $sql2);
	$name_count = mysqli_num_rows($result2);

	$sql3 = "SELECT * FROM tbl_odbory WHERE poradie = '$array'";
	$result3 = mysqli_query($connect, $sql3);
	$array_count = mysqli_num_rows($result3);
	
	if( ($short != $db_short && $short_count != 0) || ($name != $db_name && $name_count != 0) || ($array != $db_array && $array_count != 0)){
		echo "Record exist";
		exit;
	} 

	// Vloženie organizačnej zložky do tabuľky "tbl_odbory" 
	$sql = "UPDATE 
						tbl_odbory
					SET
						odbor = '$short', 
						cely_nazov = '$name',
						poradie = '$array'
					WHERE 
						tbl_odbory_id = $id
	";

	if(mysqli_query($connect, $sql)){
		echo "OK";
	}else{ 
		echo mysqli_error($connect);
	}
	
?>