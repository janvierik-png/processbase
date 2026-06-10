<?php
	include_once("inc/navbar.php");
	require_once("inc/access-permissions.php");


	$business_trip_id = clear_input($_GET["id"]);
	$where_business_trip_id = "WHERE tbl_proc_id = $business_trip_id";

	$sql = "SELECT * FROM tbl_proc
				  LEFT JOIN tbl_prilohy
					ON tbl_proc.tbl_proc_id = tbl_prilohy.proc_id
					$where_business_trip_id
	";
	$result = $result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_assoc($result);
	$business_trip_name = $row["nazov"];
$process_code = $row["kod"];

	$sql = "SELECT * FROM tbl_prilohy WHERE proc_id = $business_trip_id";
  $result = mysqli_query($connect, $sql);
  $num_row = mysqli_num_rows($result);
?>



<h2><?php echo $process_code. ' ' .$business_trip_name ?>


<a href="?page=/printproc&id=<?php echo $business_trip_id ?>" target="_blank"

<button type="button" class="btn btn-default position-end">
<span class="glyphicon glyphicon-print" title="Print format" </span> </button> </a>


</h2>
<div><?php echo $num_row > 0 ? "Connected files:" : "" ?></div>




<?php
	$att_url_arr5 = array();
	while($row = mysqli_fetch_assoc($result)){
		$att_id = $row["tbl_prilohy_id"];
		$att_name = $row["meno"];
		$att_size = $row["velkost"];
		$att = $row["cele_meno"];
		$url = "../".$row["url"];
		array_push($att_url_arr5, $url);
		//print_r($att_name);
?>


	<div class="btn-group btn-att">
		<button type="button" class="btn btn-default"><?php echo $att_name . " (" . $att_size . ")"?></button>
		<button type="button" class="btn btn-warning dropdown-toggle" data-toggle="dropdown">
			<span class="caret"></span>
		</button>
		<ul class="dropdown-menu att-edit" role="menu">
			<li><a href="scripts/download-attachment.php?file-orig=<?php echo $att_name ?>&file=<?php echo $att ?>"><span class="glyphicon glyphicon-download-alt"></span> Download</a></li>
			<li><a href="<?php echo $url ?>" data-action="show-att" target="_blank"><span class="glyphicon glyphicon-eye-open"></span> Open</a></li>
			<?php
				if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_proc", $permissions)){
			?>
					<li><a href="#" data-action="delete-att" data-att="<?php echo $att ?>" data-id="<?php echo $att_id ?>" data-name="<?php echo $att_name ?>"><span class="glyphicon glyphicon-remove"></span> Delete</a></li>
			<?php
				}
			?>

		</ul>
	</div>

<?php
	}
?>

<?php
$business_trip_id = clear_input($_GET["id"]);
	$where_business_trip_id = "WHERE tbl_proc_id = $business_trip_id";

$sql = "SELECT * FROM tbl_proc
				  LEFT JOIN tbl_diagramy
					ON tbl_proc.tbl_proc_id = tbl_diagramy.proc_id
					$where_business_trip_id

	";
	$result = $result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_assoc($result);
	$business_trip_name = $row["nazov"];

	$sql = "SELECT * FROM tbl_diagramy WHERE proc_id = $business_trip_id";
  $result = mysqli_query($connect, $sql);
  $num_row = mysqli_num_rows($result);
?>

<?php
	$att_url_arr8 = array();
	while($row = mysqli_fetch_assoc($result)){
		$att_id = $row["tbl_prilohy_id"];
		$att_name = $row["meno"];
		$att_size = $row["velkost"];
		$att = $row["cele_meno"];
		$url = "../".$row["url"];
		array_push($att_url_arr8, $url);
?>
<?php
	}
?>

<?php
		$sql = "SELECT *
		                FROM tbl_proc
						LEFT JOIN tbl_odbory
						ON tbl_proc.odbor_id = tbl_odbory.tbl_odbory_id
						LEFT JOIN tbl_zamerania
						ON tbl_proc.zodp_id = tbl_zamerania.tbl_zamerania_id
						$where_business_trip_id

		";

		$result = mysqli_query($connect, $sql);
	//	print_r($result);
		while($row = mysqli_fetch_assoc($result)){
			$id = $row["tbl_proc_id"];
			$section_id = $row["odbor_id"];
			$section = $row["cely_nazov"];
			$name = $row["nazov"];
			$type_id = $row["tbl_zamerania_id"];
			$type = $row["nazov_zamerania"];
			$input = $row["vstup"];
			$output = $row["vystup"];
			$date = date_format(date_create($row["datum"]),"d.m.Y");
			$count = $row["kod"];
			$summary = $row["popis"];
			$parent_id = $row["parent_id"];
$decodedString = htmlspecialchars_decode($summary);
$decodedStringInput = htmlspecialchars_decode($input);
$decodedStringOutput = htmlspecialchars_decode($output);

	?>
<body>
<div>

<table  class="table responsive">
<col style="width:5%">
	<col style="width:10%">
<tr>
      <th >Process code</th> <td><?php echo $count ?></td>


      <td colspan = "2" ROWSPAN="12" <TD WIDTH="25%" BGCOLOR="#f2f2f2" ><b><p><h3>Description of process:</h3><?php echo $decodedString?></p></td>

      </tr>
      <th>Responsible Department</th> <td><b><a href="?page=section&id=<?php echo $section_id ?>&search=">

    <?php echo $section ?></a></b></td>


        </tr>
<tr>
      <th>Parent process</th>

      <td>


      <?php
               $sql2 = "SELECT * FROM tbl_child_parent
                           LEFT JOIN tbl_proc
                           ON tbl_child_parent.merge_parent_id = tbl_proc.tbl_proc_id
                           WHERE tbl_child_parent.merge_child_id = $id
               ";
               $result2 = mysqli_query($connect, $sql2);
               $parent_arr = array();

               while($row2 = mysqli_fetch_assoc($result2)){

              $parent = $row2["nazov"];
               $parent_id = $row2["merge_parent_id"];
              $process_code = $row2["kod"];


            ?>

            <b><a href="?page=editation&id=<?php echo $parent_id ?>"><?php echo ("<br>". $process_code. ' - ' .$parent)?></a></b>
<?php
				}
			?>

</td>
</tr>

<tr>
<th>Child processes</th>

<td>

<?php
         $sql3 = "SELECT * FROM tbl_child_parent
                     LEFT JOIN tbl_proc
                     ON tbl_child_parent.merge_child_id = tbl_proc.tbl_proc_id
                     WHERE tbl_child_parent.merge_parent_id   = $business_trip_id
order by kod
         "
;
$result3 = mysqli_query($connect, $sql3);
//$num_row3 = mysqli_num_rows($result3);
$child_arr = array();
              while($row3 = mysqli_fetch_assoc($result3)){

              $child = $row3["nazov"];
              $child_id = $row3["merge_child_id"];
              $process_code = $row3["kod"];

 ?>
<b><a href="?page=editation&id=<?php echo $child_id ?>"><?php echo  ("<br>". $process_code. ' - ' .$child) ?></a></b>

<?php
				}
			?>

</td>
</tr>

<tr>
      <th>Connected process </th>

      <td>
      <?php
               $sql1 = "SELECT * FROM tbl_merge_proc
                           LEFT JOIN tbl_proc
                           ON tbl_merge_proc.tbl_proc2_id = tbl_proc.tbl_proc_id
                           WHERE tbl_merge_proc.tbl_proc1_id = $id
               ";
               $result1 = mysqli_query($connect, $sql1);

              $merge = array();

               while($row1 = mysqli_fetch_assoc($result1)){

              $merge = $row1["nazov"];
              $process_code2 = $row1["tbl_proc_id"];
              $process_code3 = $row1["kod"];


            ?>
<b><a href="?page=editation&id=<?php echo $process_code2 ?>"><?php echo  ("<br>". $process_code3. ' - ' .$merge) ?></a></b>
<?php
				}
			?>

   </td>
</tr>

 <th>Responsible position</th> <td><b><a href="?page=zodp&id=<?php echo $type_id ?>&search="><?php echo $type ?></a></b></td>
</tr>
<tr>
      <th>Process participants</th>
      <?php
               $sql1 = "SELECT * FROM tbl_zameranie_proc
                           LEFT JOIN tbl_zamerania
                           ON tbl_zameranie_proc.zameranie_id = tbl_zamerania.tbl_zamerania_id
                           WHERE tbl_zameranie_proc.proc_id = $id
               ";
               $result1 = mysqli_query($connect, $sql1);

              $focus = array();

               while($row1 = mysqli_fetch_assoc($result1)){

              $focus[] = $row1["nazov_zamerania"];
               }


        $focus = implode ("<br>", $focus);

            ?>

    <td class="text-cut" title="<?php echo $focus ?>"><?php echo $focus ?></a></td>


</tr>


      <th>Input</th><td><?php echo $decodedStringInput ?></td>
      </tr>
      <tr>
      <th>Output</th><td><?php echo $decodedStringOutput ?></td>
      </tr>
      <tr>
      <th>Last actualization</th><td><?php echo $date ?></td>
      </tr>

       </tr>


      <?php
         if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_proc", $permissions)){
      ?>
            <th>Editation</th><?php
					if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_proc", $permissions)){
				?>
						<td>
							<span class="glyphicon glyphicon-open" data-action="insert-attachment" data-id="<?php echo $id ?>" data-name="<?php echo $name ?>" title="Upload attachment"></span>&nbsp;&nbsp;
							<span class="glyphicon glyphicon-picture" data-action="insert-attdiagram" data-id="<?php echo $id ?>" data-name="<?php echo $name ?>" title="Upload diagram of process"></span>&nbsp;&nbsp;
							<span class="glyphicon glyphicon-edit" data-action="edit-proc" data-id="<?php echo $id ?>" title="Edit process"></span>&nbsp;&nbsp;
							<span class="glyphicon glyphicon-trash" data-action="delete-proc" data-id="<?php echo $id ?>" data-name="<?php echo $name ?>" data-att-url="<?php echo implode(", ", $att_url_arr5) ?>" data-att-url2="<?php echo implode(", ", $att_url_arr8) ?>" title="Delete process"></span>


						</td>

				<?php
				}
				?>



   </tr>

   </div>

	</thead>




	<?php
}
	?>

	</tbody>

</table>
</div>

<?php
$business_trip_id = clear_input($_GET["id"]);
	$where_business_trip_id = "WHERE tbl_proc_id = $business_trip_id";

$sql = "SELECT * FROM tbl_proc
				  LEFT JOIN tbl_diagramy
					ON tbl_proc.tbl_proc_id = tbl_diagramy.proc_id
					$where_business_trip_id
	";
	$result = $result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_assoc($result);
	$business_trip_name = $row["nazov"];

	$sql = "SELECT * FROM tbl_diagramy WHERE proc_id = $business_trip_id";
  $result = mysqli_query($connect, $sql);
  $num_row = mysqli_num_rows($result);
?>
<h2>Process diagram</h2>
<div><?php echo $num_row > 0 ? "Diagrams for process:" : "" ?></div>

<?php
	$att_url_arr8 = array();
	while($row = mysqli_fetch_assoc($result)){
		$att_id = $row["tbl_prilohy_id"];
		$att_name = $row["meno"];
		$att_size = $row["velkost"];
		$att = $row["cele_meno"];
		$url = "../".$row["url"];
		array_push($att_url_arr8, $url);
?>

	<div class="btn-group btn-att">
		<button type="button" class="btn btn-default"><?php echo $att_name . " (" . $att_size . ")"?></button>
		<button type="button" class="btn btn-warning dropdown-toggle" data-toggle="dropdown">
			<span class="caret"></span>
		</button>
		<ul class="dropdown-menu att-edit" role="menu">
			<li><a href="scripts/download-attdiagram.php?file-orig=<?php echo $att_name ?>&file=<?php echo $att ?>"><span class="glyphicon glyphicon-download-alt"></span> Download</a></li>
			<li><a href="<?php echo $url ?>" data-action="show-att" target="_blank"><span class="glyphicon glyphicon-eye-open"></span> Open</a></li>
			<?php
				if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_proc", $permissions)){
			?>
					<li><a href="#" data-action="delete-attdiagram" data-att="<?php echo $att ?>" data-id="<?php echo $att_id ?>" data-name="<?php echo $att_name ?>"><span class="glyphicon glyphicon-remove"></span> Delete</a></li>
			<?php
				}
			?>

		</ul>
</div>
<div id="formConfirmation" >

<img src="<?php echo $url ?>"class="img-magnifier-container" width="1200" height="auto" >

</div>


<?php
	}
?>


<?php
	}
?>


