<?php
session_start();
		
if($_POST) {
	
	require_once "../inc/connect.php";
	require_once("../inc/clear-input.php");
	
	$user = clear_input($_POST["user"]);
	$password = clear_input($_POST["pwd"]);
	$password = md5($password);
	
	//echo $password;
	//exit;
	$sql =  "SELECT     * 
					 FROM       tbl_pouzivatelia
					 LEFT JOIN	tbl_odbory
					 ON tbl_pouzivatelia.odbor_id = tbl_odbory.tbl_odbory_id						 
					 WHERE      alias_pouzivatela = '$user' AND heslo_pouzivatela = '$password' 
					 LIMIT      1
	";
	$result = mysqli_query($connect,$sql);
	echo mysqli_error($connect);
  $num_row = mysqli_num_rows($result);
	$user1 = mysqli_fetch_assoc($result);
	
	$sql1 = "SELECT *
					 FROM   tbl_pouzivatelia
					 WHERE  alias_pouzivatela='$user'
	
	";
	$result1 = mysqli_query($connect,$sql1);
  $num_row_user = mysqli_num_rows($result1);
	
	if($num_row_user != 1){
		echo "User not exist";
		exit();
	}
	
	if($num_row == 1){
		if($user1["zmenene_heslo"] == 0){
			echo "Unchanged password";
			exit;
		}
			
		
		$_SESSION["procesy-logged-in"] = "logged-in";
		$_SESSION['procesy-user-id'] = $user1["id_pouzivatela"];
		$_SESSION['procesy-user'] = $user1["meno_pouzivatela"];
		$_SESSION['procesy-section'] = $user1["odbor"];
		$_SESSION['procesy-user-alias'] = $user1["alias_pouzivatela"];
		
		echo "Logged in";
		
	}else if ($num_row == 0){
		echo "Bad password";
	}else{
		echo mysqli_error($connect);
	}
}
?>