<?php
if (isset($_SESSION["procesy-logged-in"])){
  require_once("connect.php");
	$user_id = isset($_SESSION['procesy-user-id']) ? $_SESSION['procesy-user-id'] : -1;
	$sql = "SELECT * 
					FROM tbl_pristupy
					LEFT JOIN tbl_druhy_pristupov
					ON tbl_pristupy.id_druhu_pristupu = tbl_druhy_pristupov.id_pristupu
					WHERE id_pouzivatela = $user_id";
	
	$result = mysqli_query($connect, $sql);	
	$permissions = array();	
		
	while($row = mysqli_fetch_array($result)){
    $permission = $row["nazov_pristupu"];		
		array_push($permissions, $permission);
	} 

}
?>