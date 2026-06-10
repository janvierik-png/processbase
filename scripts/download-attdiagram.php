<?php

  require_once("../inc/clear-input.php");
	
	$filename = clear_input($_GET['file']);
	$filename_orig = clear_input($_GET['file-orig']);
	$filenamepath = "../uploads/".$filename;
	header('Content-Type: application/force-download; charset=utf-8');
	header("Content-Disposition: attachment; filename*=UTF-8''".rawurlencode($filename_orig));
	header('Content-Transfer-Encoding: binary');
	header('Content-Length: '.filesize($filenamepath));

	readfile($filenamepath);
?>