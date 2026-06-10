<?php
	session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_odborov", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$name = clear_input($_POST["section-name"]);
	$short = clear_input($_POST["section-short"]);
	$array = clear_input($_POST["section-array"]);
	
	// Povinné polia
	$required = array('section-name', 'section-short');

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
	
	$sql = "SELECT * FROM tbl_odbory WHERE odbor = '$short' OR cely_nazov = '$name'";
	$result = mysqli_query($connect, $sql);
	
	if(mysqli_num_rows($result)>0){
		echo "Record exist";
		exit;
	}

		// Vloženie organizačnej zložky do tabuľky "tbl_odbory" 
		$sql = "INSERT 
							 INTO tbl_odbory(
								odbor, 
								cely_nazov,
								poradie
							 ) 
							 VALUES(
								'$short', 
								'$name',
								'$array'
							 )"
		;

		if(mysqli_query($connect, $sql)){
			echo "OK";
		}else{ 
			echo mysqli_error($connect);
		}
	
	
	
	
	
	
	
?>