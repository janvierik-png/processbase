<?php
	session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
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

		// Vloženie procesu do tabuľky "tbl_proc"
		$sql = "INSERT
							 INTO tbl_proc(
								odbor_id,
								nazov,
								datum,
								zodp_id,
								popis,
								vstup,
								kod,
								vystup,
                                parent_id
							 )
							 VALUES(
								'$section',
								'$trip',
								'$date',
								'$type',
								'$desc',
								'$input',
								'$att_num',
								'$output',
                                '$parent_id'
							 )"
		;






		if(mysqli_query($connect, $sql)){
			$last_id = mysqli_insert_id($connect);


			for ($i = 0; $i < $focus_id_count; $i++){
				$focus_id[$i] = clear_input($focus_id[$i]);


				// Vloženie zamerania procesu do tabuľky "tbl_zameranie_proc"
				$sql = "INSERT INTO tbl_zameranie_proc(proc_id, zameranie_id) VALUES ($last_id, $focus_id[$i])";
				$result = mysqli_query($connect,$sql);
}
// Vloženie nadriadeného procesu do tabuľky "tbl_child_parent"
if(isset($_POST['parent'])){
				$sql = "INSERT INTO tbl_child_parent(merge_child_id, merge_parent_id) VALUES ($last_id, $parent_id)";
                $result = mysqli_query($connect,$sql);

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
				$file_name = clear_input($year . "-" .$section . "-" . $user . "-id" .$last_id . "-" . $uid . "." . end($file_name));
				$url = "uploads/" . $file_name;
				$target_file = clear_input($target_dir . $file_name);
				$extension = strtolower(pathinfo($target_file,PATHINFO_EXTENSION));
				$size = filesize($tmp_file_name);
				$size = round($size/1000000, 2) . " MB";

				// Vloženie údajov o prílohe do tabuľky "tbl_prilohy"
				$sql1 = "INSERT INTO tbl_prilohy(proc_id, meno, cele_meno, url, pripona, velkost) VALUES ($last_id, '$db_file_name', '$file_name', '$url', '$extension', '$size')";

				if(mysqli_query($connect, $sql1)){
					//print_r($connect);
					if(move_uploaded_file($tmp_file_name, $target_file)){
						echo "OK";
					} else{
						echo mysqli_error($connect);
					}
				}
			}else{
				echo "OK";
			}
		}else{
			echo mysqli_error($connect);
		}


	


	
	
	
?>