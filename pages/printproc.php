<button onclick="window.print()">Print</button>
<?php
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




<h2><?php echo $process_code. ' ' .$business_trip_name ?></h2>







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

<tr>
      <th>Process Code</th>
      <td><?php echo $count ?></td>
      <th>Responsible position</th>
<td><a href="?page=zodp&id=<?php echo $type_id ?>&search="><?php echo $type ?></a></td>
  </tr>
  <tr>
   <th>Proces participants</th>
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

      <th>Department</th>
      <td><a href="?page=section&id=<?php echo $section_id ?>&search="><?php echo $section ?></a></td>

        </tr>
<tr>
      <th>Parent</th>

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

           <a href="?page=editation&id=<?php echo $parent_id ?>"><?php echo ("<br>". $process_code. ' - ' .$parent)?></a>
<?php
				}
			?>

</td>

 <th>Connected Process</th>

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

<tr>
<th>Child process</th>

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
<a href="?page=editation&id=<?php echo $child_id ?>"><?php echo  ("<br>". $process_code. ' - ' .$child) ?></a>

<?php
				}
			?>

</td>


      <th>Input</th>

<td class="text-cut" width=12%><?php echo $decodedStringInput ?></td>
       </tr>
      <th>Output</th>
   <td class="text-cut" width=12%><?php echo $decodedStringOutput ?></td>
      <th>Last actualization</th>
      <td><?php echo $date ?></td>
      </tr>




<tr>
 <td colspan = "4" ><b><p><h3>Process description:</h3><?php echo $decodedString?></p></td>

      <?php
         if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_proc", $permissions)){
      ?>





   </tr>
<tr>

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



		</ul>
</div>
<div id="formConfirmation" >

<img src="<?php echo $url ?>"  width="1300" height="auto" >

</div>


<?php
	}
?>


<?php
	}
?>
