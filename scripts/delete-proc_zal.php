<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
		
	$att_url = clear_input($_POST["att_url"]);
	$att_url_arr = array();
	
	if($att_url != ""){
		$att_url_arr = explode(", ", $att_url);
	}


	
	$att_url_count = count($att_url_arr);

		
	//print_r(empty($att_url_arr));
	//exit;
	
	$sql1 = "DELETE FROM tbl_proc WHERE tbl_proc_id = $id";
	$sql2 = "DELETE FROM tbl_zameranie_proc WHERE proc_id = $id";
	$sql3 = "DELETE FROM tbl_child_parent WHERE merge_child_id = $id";

	$deleted_arr = array();
	if(!empty($att_url_arr)){
		// Odstráň všetky prílohy z tabuľky
		for ($i = 0; $i < $att_url_count; $i++) {
			$sql4 = "DELETE FROM tbl_prilohy WHERE proc_id = $id";
			if(mysqli_query($connect, $sql4))  {
				// Odstráň všetky prílohy priradené k ceste z priečinka "Uploads"
unlink($att_url_arr[$i]);
				array_push($deleted_arr, "OK");



			}
		}
	}

	if(!empty($att_url_arr)){
		// Odstráň všetky prílohy z tabuľky
		for ($i = 0; $i < $att_url_count; $i++) {
			$sql5 = "DELETE FROM tbl_diagramy WHERE proc_id = $id";
			if(mysqli_query($connect, $sql5))  {
				// Odstráň všetky prílohy priradené k ceste z priečinka "Uploads"

				array_push($deleted_arr, "OK");



			}
		}
	}



	if(mysqli_query($connect, $sql1) && mysqli_query($connect, $sql2) && mysqli_query($connect, $sql3)){
		array_push($deleted_arr, "OK");
		if(count($deleted_arr) == $att_url_count + 1){
			echo "OK";


		}else{
			echo mysqli_error($connect);
		}
	}else{
		echo mysqli_error($connect);
	}

?>