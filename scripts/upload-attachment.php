<?php
session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	// Ak je čo nahrávať
	if($_FILES["attachment"]["tmp_name"] != ""){
		// Nahrávanie príloh
		$id = clear_input($_POST["id"]);

		$target_dir = "../uploads/";
		$user = $_SESSION['procesy-user-alias'];
		$section = $_SESSION['procesy-section'];
		$year = date("Y");
		$uid = uniqid();
		$db_file_name = clear_input(basename($_FILES["attachment"]["name"]));
		$file_name = explode(".", $db_file_name);
		$tmp_file_name = $_FILES["attachment"]["tmp_name"];
		$file_name = clear_input($year . "-" .$section . "-" . $user . "-id" .$id . "-" . $uid . "." . end($file_name));
		$url = "uploads/" . $file_name; 
		$target_file = clear_input($target_dir . $file_name);
		$extension = strtolower(pathinfo($target_file,PATHINFO_EXTENSION));
		$size = filesize($tmp_file_name);
		$size = round($size/1000000, 2) . " MB";


		// Vloženie údajov o prílohe do tabuľky "tbl_prilohy"
		$sql1 = "INSERT INTO tbl_prilohy(proc_id, meno, cele_meno, url, pripona, velkost) VALUES ($id, '$db_file_name', '$file_name', '$url', '$extension', '$size')";
		
		if(mysqli_query($connect, $sql1)){
			//print_r($connect);
			if(move_uploaded_file($tmp_file_name, $target_file)){
				echo "OK";
			} else{
				echo mysqli_error($connect);
			}
		}




		}else{
		echo mysqli_error($connect);
	}


?>