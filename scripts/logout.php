<?php
	session_start();
	
	require_once("../inc/connect.php");
			
	session_unset();
		
	header("Location:../?page=all-proc&p=1&search=");
?>