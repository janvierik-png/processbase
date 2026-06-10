<?php
session_start();

if($_POST){
	
	require_once "../inc/connect.php";
	require_once("../inc/clear-input.php");
	
  $user = clear_input($_POST['user']);
	$password_new = clear_input($_POST['pwd-new']);
	$password_new_repeat = clear_input($_POST['pwd-new-repeat']);

	$select =   "SELECT     * 
							 FROM       tbl_pouzivatelia
							 WHERE      alias_pouzivatela = '".$user."' 
							 LIMIT      1
	";
	$result = mysqli_query($connect,$select);
	echo mysqli_error($connect);
  $num_row = mysqli_num_rows($result);
		
	if($num_row != 1){
		echo "User not exist";
		exit();
	}
	
	
	$user = mysqli_fetch_array($result);
	$id = $user["id_pouzivatela"];
	
	if($num_row == 1){
		if(empty($password_new) || empty($password_new_repeat)){
			exit();
		}
		
		if($password_new == $password_new_repeat){
			
			$pwd_new = md5($password_new);
			
			$change_password  = "UPDATE tbl_pouzivatelia
													 SET 
													 heslo_pouzivatela = '$pwd_new',
													 zmenene_heslo = 1
													 WHERE id_pouzivatela = '$id'						 
			";
			
			if (mysqli_query($connect, $change_password)) {
				
				$_SESSION["procesy-logged-in"] = "logged-in";
				$_SESSION['procesy-user-id'] = $user["id_pouzivatela"];
				$_SESSION['procesy-user'] = $user["meno_pouzivatela"];
		    $_SESSION['procesy-user-alias'] = $user["alias_pouzivatela"];
			  
				echo "Changed";
			
			}else{
				echo mysqli_error($connect);
			}
			
		}
	}
}

?>