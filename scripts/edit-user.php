<?php
	session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pouzivatelov", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	$section = clear_input($_POST["section"]);
	$alias = clear_input($_POST["alias"]);
	$name = clear_input($_POST["name"]);
	$pwd = clear_input($_POST["pwd"]);
	$pwd_login = clear_input($_POST["pwd-login"]);
  $perm_id = empty($_POST["perm"]) ? [] : $_POST["perm"]; // array
	$perm_id_count = count($perm_id);
	
	
	// Povinné polia
	$required = array('section', 'alias', 'name', 'pwd', 'pwd-login', 'perm');

	
	$error = false;
	foreach($required as $field){
		if(empty($_POST[$field]) && $_POST[$field]!= 0){
			$error = true;
			echo $error;
		}
	}
	// Odpoveď pre ajax
	if ($error){
		echo "Required is missing";
		exit;
	}

	$sql = "SELECT * FROM tbl_pouzivatelia WHERE id_pouzivatela = $id";
	$result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_array($result);
	$db_id = $row["id_pouzivatela"];
	$db_alias = $row["alias_pouzivatela"];
	$db_password = $row["heslo_pouzivatela"];
	$pwd = $pwd == $db_password ? $pwd : md5($pwd);
	
	$sql1 = "SELECT * FROM tbl_pouzivatelia WHERE alias_pouzivatela = '$alias'";
	$result1 = mysqli_query($connect, $sql1);
	$alias_count = mysqli_num_rows($result1);
	
	if($alias != $db_alias && $alias_count != 0){
		echo "Record exist";
		exit;
	} 

	// Edit 
	$sql = "UPDATE 
						tbl_pouzivatelia
							SET
								alias_pouzivatela = '$alias', 
								meno_pouzivatela = '$name',
								odbor_id = '$section',
								heslo_pouzivatela = '$pwd',
								zmenene_heslo = '$pwd_login'
           		WHERE id_pouzivatela = '$id'					
	";
	
	$result = mysqli_query($connect, $sql);
	
	// Odstránenie pôvodných oprávnení z tabuľky "tbl_pristupy"
	$sql1 = "DELETE FROM tbl_pristupy WHERE id_pouzivatela = $id";
	$result1 = mysqli_query($connect, $sql1);
	
	for($i = 0; $i < $perm_id_count; $i++){
		$perm_id[$i] = clear_input($perm_id[$i]);
						
			// Vloženie nových oprávnení do tabuľky "tbl_pristupy"
			$sql2 = "INSERT INTO tbl_pristupy (id_pouzivatela, id_druhu_pristupu) VALUES ($id, $perm_id[$i])";
			$result2 = mysqli_query($connect,$sql2);
		
	}	
	
	// Checking edit and result
	if(!$sql || !$result || !$sql1 || !$result1 || !$sql2 || !$result2){
		echo mysqli_error($connect);
	}else{
		echo "OK";
	}
	
	
	
	
	
	
	
?>