<?php
	session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_ucast", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$name = clear_input($_POST["focus-name"]);
	
	
	// Povinné polia
	$required = array('focus-name');

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
	
	$sql = "SELECT * FROM tbl_zamerania WHERE nazov_zamerania = '$name'";
	$result = mysqli_query($connect, $sql);
	
	if(mysqli_num_rows($result)>0){
		echo "Record exist";
		exit;
	}

		// Vloženie organizačnej zložky do tabuľky "tbl_odbory" 
		$sql = "UPDATE 
							tbl_zamerania
						SET
							nazov_zamerania = '$name'
						WHERE 
							tbl_zamerania_id = $id
		";

		if(mysqli_query($connect, $sql)){
			echo "OK";
		}else{ 
			echo mysqli_error($connect);
		}
	
?>