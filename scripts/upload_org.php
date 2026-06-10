<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_ucast", $permissions)) exit;
	require_once("../inc/clear-input.php");

$soubor_name = ($_FILES["soubor"]["name"]);
$soubor = ($_FILES["soubor"]["tmp_name"]);
$ok = ($_POST["ok"]);

if ($ok == "Upload" && $soubor_name!="")
{
    if (move_uploaded_file($soubor, "../img/orgstr.pdf"))
        {
        chmod ("../img/orgstr.pdf", 0646);

        echo
        "<b>File $soubor_name was upload</b><BR>";


        }
    else
        {
        echo "<b>Error - file not uploaded</b><BR>";
        }
}

 else{
				echo mysqli_error($connect);
			}
?>

<script>
    function pageRedirect() {
        window.location.replace("http://procesy.evona.sk/?page=org");
    }
    setTimeout("pageRedirect()", 50);
</script>

