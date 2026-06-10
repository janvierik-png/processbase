<?php
	session_start();
	
	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_pouzivatelov", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$section = clear_input($_POST["section"]);
	$alias = clear_input($_POST["alias"]);
	$name = clear_input($_POST["name"]);
	$pwd = clear_input($_POST["pwd"]);
	$pwd = md5($pwd);
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

	$sql = "SELECT * FROM tbl_pouzivatelia WHERE alias_pouzivatela = '$alias'";
	$result = mysqli_query($connect, $sql);
	
	if(mysqli_num_rows($result)>0){
		echo "Record exist";
		exit;
	}
	

		// Vloženie procesu do tabuľky "tbl_proc"
		$sql = "INSERT 
							 INTO tbl_pouzivatelia(
								alias_pouzivatela, 
								meno_pouzivatela,
								odbor_id,
								heslo_pouzivatela,
								zmenene_heslo
							 ) 
							 VALUES(
								'$alias', 
								'$name',
								'$section',
								'$pwd',
								'$pwd_login'
							 )"
		;

		if(mysqli_query($connect, $sql)){
			$last_id = mysqli_insert_id($connect);
			for ($i = 0; $i < $perm_id_count; $i++){
				$perm_id[$i] = clear_input($perm_id[$i]);
				
				// Vloženie zamerania procesu do tabuľky "tbl_zameranie_proc"
				$sql = "INSERT INTO tbl_pristupy(id_pouzivatela, id_druhu_pristupu) VALUES ($last_id, $perm_id[$i])";
				$result = mysqli_query($connect,$sql);
			}
			echo "OK";
		}else{ 
			echo mysqli_error($connect);
		}
	
	
	
	
	
	
	
?>