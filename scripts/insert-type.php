<?php
	session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pozicii", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$name = clear_input($_POST["type-name"]);
	
	
	// Povinné polia
	$required = array('type-name');

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
	
	$sql = "SELECT * FROM tbl_zodp WHERE typ = '$name'";
	$result = mysqli_query($connect, $sql);
	
	if(mysqli_num_rows($result)>0){
		echo "Record exist";
		exit;
	}

		// Vloženie organizačnej zložky do tabuľky "tbl_odbory" 
		$sql = "INSERT 
							 INTO tbl_zodp(
								typ 
							 ) 
							 VALUES(
								'$name'
							 )"
		;

		if(mysqli_query($connect, $sql)){
			echo "OK";
		}else{ 
			echo mysqli_error($connect);
		}
	
	
	
	
	
	
	
?>