<?php
session_start();
include_once("inc/connect.php");
include_once("inc/clear-input.php");
require_once("inc/access-permissions.php");
$today = date("Y-m-d");
   
if($_SERVER['HTTP_HOST']. $_SERVER['REQUEST_URI'] == $server_url."/")header("Location:?page=all-proc&p=1&search=");

?>

<!DOCTYPE html>
<html lang="eng">
<head>
<!-- Header -->
<title>Procesy</title>
<?php
  include_once("inc/header.php");
?>
</head>
<body>

<!-- Prekrytie obsahu stránky transparentným pozadím -->
<div id="overlay"><div id="spinner-text"></div><img id="spinner" src="img/ajax-loader.gif"></div>

<!-- Modálne okná -->
<div id="modals"></div>

<!-- Obsah stránky -->
<div class="content container-fluid">

<?php
  if(isset($_GET["page"]) && !empty($_GET["page"])){
    $page = clear_input($_GET["page"]);
    include_once("pages/".$page.".php");
  }
?>
<div class="hidden empty-table"></div>
</div>
<script>

	//# Nastav kurzor v záhlaví modálneho okna
	$(document).on("mousedown", ".modal-header", function() {
		$(this).css({"cursor":"move"});
	});
	$(document).on("mouseup", ".modal-header", function() {
		$(this).css({"cursor":"default"});
	});

	//# Po kliknutí na a[href='#'] nevykonaj presmerovanie
	$(document).on("click", "a[href='#']", function(e) {
		e.preventDefault();
	});

	//# Ak je prázdna tabuľka, tak zobraz text "Žiadne služobné procesy"
	if($("tbody tr").length == 0) $(".empty-table").removeClass("hidden");

</script>
<?php
	require_once("inc/js-open-modals.php");
	require_once("inc/js-submit-modals.php");
?>
</body>
</html>