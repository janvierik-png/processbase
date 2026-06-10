<?php
	session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$trip = clear_input($_POST["trip"]);
	$section = clear_input($_POST["section"]);
	$date = clear_input($_POST["date"]);
	$date = date_format(date_create($date),"Y-m-d");
	$type = clear_input($_POST["type"]);
  $input = clear_input($_POST["input"]);
  $output = clear_input($_POST["state"]);
  $att_num = clear_input($_POST["number"]);
  $focus_id = empty($_POST["focus"]) ? [] : $_POST["focus"]; // array
  $focus_id_count = count($focus_id);
   $merge_id = empty($_POST["merge"]) ? [] : $_POST["merge"]; // array
$merge_id_count = count($merge_id);
	$desc = clear_input($_POST["description"]);
	$parent_id = clear_input($_POST["parent"]);


	// Povinné polia
	$required = array('trip');

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

		// Úprava procesu v tabuľke "tbl_proc"
		$sql = "UPDATE 
							  tbl_proc
									SET
										odbor_id = '$section', 
										nazov = '$trip',
										datum = '$date',
										zodp_id = '$type',
										popis = '$desc',
										vstup = '$input',
										kod = '$att_num',
										vystup = '$output',
										parent_id = '$parent_id'
									WHERE tbl_proc_id = $id
		";

		if(mysqli_query($connect, $sql)){
			
			// Odstránenie pôvodných zameraní z tabuľky "tbl_zameranie_proc"
			$sql1 = "DELETE FROM tbl_zameranie_proc WHERE proc_id = $id";
			if(mysqli_query($connect,$sql1)){
			
				for($i = 0; $i < $focus_id_count; $i++){
					$focus_id[$i] = clear_input($focus_id[$i]);
									
						// Vloženie nových zameraní procesu do tabuľky "tbl_zameranie_proc"
						$sql2 = "INSERT INTO tbl_zameranie_proc (proc_id, zameranie_id) VALUES ($id, $focus_id[$i])";
						$result2 = mysqli_query($connect,$sql2);
						}

if(mysqli_query($connect, $sql)){
						// Odstránenie súvisiaceho procesu"
			$sql3 = "DELETE FROM tbl_merge_proc WHERE tbl_proc1_id = $id";
$sql4 = "DELETE FROM tbl_merge_proc WHERE tbl_proc2_id = $id";
			if(mysqli_query($connect,$sql3) && mysqli_query($connect, $sql4)){

				for($i = 0; $i < $merge_id_count; $i++){
					$merge_id[$i] = clear_input($merge_id[$i]);

						// Vloženie suvisiaceho procesu
						$sql5 = "INSERT INTO tbl_merge_proc (tbl_proc1_id, tbl_proc2_id)
						VALUES
						($id, $merge_id[$i]),
						($merge_id[$i], $id)";
						$result5 = mysqli_query($connect,$sql5);
						}




			$sql6 = "DELETE FROM tbl_child_parent WHERE merge_child_id = $id";
if(mysqli_query($connect,$sql6)){



			    $sql7 = "INSERT INTO tbl_child_parent(merge_child_id, merge_parent_id) VALUES ($id, $parent_id)";
                $result7 = mysqli_query($connect,$sql7);


				}







				// Ak je čo nahrávať
				if($_FILES["attachment"]["tmp_name"] != ""){
					// Nahrávanie príloh
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
					$sql3 = "INSERT INTO tbl_prilohy(proc_id, meno, cele_meno, url, pripona, velkost) VALUES ($id, '$db_file_name', '$file_name', '$url', '$extension', '$size')";
				
					if(mysqli_query($connect, $sql3)){
						//print_r($connect);
						if(!move_uploaded_file($tmp_file_name, $target_file)){
							echo mysqli_error($connect);
						}
					}
	}
	}
}


				echo "OK";
				}
		}else{ 
			echo mysqli_error($connect);
		}
	
	
	
	
	
	
	
?>