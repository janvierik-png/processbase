
<?php
	include_once("inc/navbar.php");
	require_once("inc/access-permissions.php");

?>

<?php
if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_proc", $permissions)){
?>
<h2>Organization Structure</h2>

<?php
         if(isset($_SESSION["procesy-logged-in"]) && in_array("user_read", $permissions)){
      ?>
<h3>
<!-- Button trigger modal -->
<button type="button" class="btn btn-outline-secondary" data-toggle="modal" data-target="#exampleModal">
  Actualization of organization structure
</button>
</h3>
<?php
}


?>
<!-- Modal -->
<div class="modal fade" id="exampleModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="exampleModalLabel">Upload organization structure on PDF format</h5>
        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div class="modal-body">
      <head>
    <meta charset="UTF-8">
    <title>PHP File Upload</title>
</head>
<FORM ACTION="scripts/upload_org.php" METHOD="post" ENCTYPE="multipart/form-data">
<INPUT TYPE="file" NAME="soubor" SIZE="40">
      </div>
      <div class="modal-footer">
      <FORM ACTION="scripts/upload_org.php" METHOD="post" ENCTYPE="multipart/form-data">
        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
        <button type="submit" class="btn btn-primary"INPUT TYPE="submit" NAME="ok" VALUE="Upload" >Upload</button>
        </FORM>
      </div>
    </div>
  </div>
</div>


<?php
}
?>


<a href="img/orgstr.pdf" class="btn btn-primary btn-lg active" role="button" aria-pressed="true" target="_blank" >Show organization structure</a>

<body onload="reloadIFrame()">
<div>
<iframe id="iframed"  src="img/orgstr.pdf" width="100%" height="1000px" seamless > </iframe>

    </div>
<script>


        function reloadIFrame() {
            console.log('reloading..');
            document.getElementById('iframed').contentWindow.location.reload();
        }
    </script>
    </body>