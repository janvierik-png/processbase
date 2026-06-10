<?php
	include_once("inc/navbar.php");
	require_once("inc/access-permissions.php");

?>
<h2>Process Tree Structure</h2><th>
<script type="text/javascript" src="https://unpkg.com/xlsx@0.15.1/dist/xlsx.full.min.js"></script>
<button type="button" class="btn btn-success" onclick="ExportToExcel('xlsx')">Export list to Excel</button>

          <a href="javascript:void(0);" class="btn btn-primary act-button-expand"> + Expand one level</a>



<div class="table-responsive">
<table id="tbl_exporttable_to_xls" class="collaptable table table-striped">
<thead class="bg-black text-white">
  <tr>
    <th>Process code</th>
		<th>Name of process</th>
        <th>Department</th>
		<th>Responsible position</th>
		<th>Process participants</th>
		<th>Input</th>
		<th>Output</th>
</thead>
<tbody>

<?php
$sql = "SELECT * FROM tbl_proc
						LEFT JOIN tbl_odbory
						ON tbl_proc.odbor_id = tbl_odbory.tbl_odbory_id
						LEFT JOIN tbl_zamerania
						ON tbl_proc.zodp_id = tbl_zamerania.tbl_zamerania_id
				order by poradie,kod

		";
			$result = mysqli_query($connect, $sql);



		while($row = mysqli_fetch_assoc($result)){
			$id = $row["tbl_proc_id"];
			$section_id = $row["odbor_id"];
			$section = $row["cely_nazov"];
			$count = $row["kod"];
			$name = $row["nazov"];
			$type_id = $row["tbl_zamerania_id"];
			$type = $row["nazov_zamerania"];
			$input = $row["vstup"];
			$output = $row["vystup"];
			$parent = $row["parent_id"];
			$date = date_format(date_create($row["datum"]),"d.m.Y");
			$decodedStringInput = htmlspecialchars_decode($input);
$decodedStringOutput = htmlspecialchars_decode($output);

?>

  </tr>

                   <tr data-id=<?php echo $id ?> data-parent= <?php echo $parent ?>>
                    <td width=8% ><?php echo $count ?></td>
				<td ><b><a href="?page=editation&id=<?php echo $id ?>"><span class="glyphicon glyphicon-list-alt" ></span><?php  echo ('   '.$name) ?></a></b></td>
                <td ><b><a href="?page=section&id=<?php echo $section_id ?>&p=1"><?php echo $section ?></a></b></td>

				<td><b><a href="?page=zodp&id=<?php echo $type_id ?>&p=1"><?php echo $type ?></a></b></td>

				<?php
					$sql1 = "SELECT * FROM tbl_zameranie_proc
									LEFT JOIN tbl_zamerania
									ON tbl_zameranie_proc.zameranie_id = tbl_zamerania.tbl_zamerania_id
									WHERE tbl_zameranie_proc.proc_id = $id
					";
					$result1 = mysqli_query($connect, $sql1);
					$focus = array();
					while($row1 = mysqli_fetch_assoc($result1)){
						array_push($focus, $row1["nazov_zamerania"]);
					}
          $focus = implode($focus, ", ");
				?>
				<td class="text-cut" title="<?php echo $focus ?>"><?php echo $focus ?></td>




<td class="text-cut" width=12%><?php echo $decodedStringInput ?></td>
<td class="text-cut" width=12%><?php echo $decodedStringOutput ?></td>


  </tr>
  	<?php
	}
	?>
</tbody>



</table>

</div>

 <script src="js/jquery.aCollapTable.js"></script>
<script>
$(document).ready(function(){
  $('.collaptable').aCollapTable({
    startCollapsed: true,
    addColumn: false,
    plusButton: '<a class="glyphicon glyphicon-plus" </a> ',
    minusButton: '<a class="glyphicon glyphicon-minus"></a> '
  });
});
</script>
<script type="text/javascript">

  var _gaq = _gaq || [   ];
  _gaq.push(['_setAccount', 'UA-36251023-1']);
  _gaq.push(['_setDomainName', 'jqueryscript.net']);
  _gaq.push(['_trackPageview']);

  (function() {
    var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
    ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
  })();

</script>

</body>
</html>


<script>

        function ExportToExcel(type, fn, dl) {
            var elt = document.getElementById('tbl_exporttable_to_xls');
            var wb = XLSX.utils.table_to_book(elt, { sheet: "sheet1" });
            return dl ?
                XLSX.write(wb, { bookType: type, bookSST: true, type: 'base64' }) :
                XLSX.writeFile(wb, fn || ('ProcessList.' + (type || 'xlsx')));
        }

    </script>