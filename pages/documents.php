

<?php
	include_once("inc/navbar.php");




	// Stránkovanie + vyhľadávanie
 //****************************************************************************************************
	$where = $get_search != "" ? "WHERE meno LIKE '%{$get_search}%' OR cele_meno LIKE '%{$get_search}%'" : "";

	$sql = "SELECT * FROM tbl_prilohy
	LEFT JOIN tbl_proc
						ON tbl_prilohy.proc_id = tbl_proc.tbl_proc_id
						$where ORDER BY meno";
	$result = mysqli_query($connect, $sql);
	$num_of_rows= mysqli_num_rows($result);

	// Maximálny počet záznamov v tabuľke na stránke
	$records_on_page = $pocet_zaznamov_na_stranke;

	// Výpočet všetkých stránok
	$all_pages_nums = ceil($num_of_rows/$records_on_page);

	if(isset($_GET['p']) && $_GET['p']>0 && $_GET['p']<=$all_pages_nums && is_numeric($_GET['p'])){
		$p=clear_input($_GET['p']);
		$from=($p*$records_on_page)-$records_on_page;
	} else {
		$from=0;
		$p=1;
	}

	$sql = "SELECT * FROM tbl_prilohy
	LEFT JOIN tbl_proc
						ON tbl_prilohy.proc_id = tbl_proc.tbl_proc_id
	$where ORDER BY meno LIMIT $from, $records_on_page";
	$result = mysqli_query($connect, $sql);

?>

<h2>Documents</h2>
<div class="table-sort"  >
<table class="table table-sort">
	<thead class="bg-black text-white">
	<tr>
        <th><span class="glyphicon glyphicon-sort-by-alphabet"></span> Document name</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span> Process name</th>
		<th style="width:8%"><span class="glyphicon glyphicon-sort-by-alphabet"></span>Size</th>
        <th style="width:5%"> Show </th>

	</tr>
	</thead>
	<tbody>
	<?php

		$att_url_arr5 = array();
		while($row = mysqli_fetch_assoc($result)){
			$id = $row["tbl_prilohy_id"];
			$document_process = $row["nazov"];
			$document_process_id = $row["proc_id"];
			$process_code = $row["kod"];
			$document_name = $row["meno"];
			$document_size = $row["velkost"];
			$url = "../".$row["url"];
			array_push($att_url_arr5, $url);
				//print_r($url);


	?>
			<tr>
<td><?php echo $document_name ?></td>
				<td><b><a  href="?page=editation&id=<?php echo 	$document_process_id ?>"><span class="glyphicon glyphicon-list-alt" ></span><?php  echo ('   '.$process_code.'   '.$document_process) ?></a></b></td>

				<td><?php echo $document_size ?></td>



		<td><a href="<?php echo $url ?>" data-action="show-att" target="_blank"><span class="glyphicon glyphicon-eye-open"></span></a></td>




		</ul>

			</tr>

	<?php
	}
	?>

	</tbody>
</table>
<tfoot>
	<ul class="pagination">
	<?php


		for ($i=1;$i<=$all_pages_nums;$i++){

			// Stránky
			if ($i >=($p - 4) && $i < $p  || $i > $p &&  $i <=($p + 4)){
				$help_var = $i;
				echo '<li><a href="?page=admin-sections&p='.$i.'&search='.$get_search.'">'.$i.'</a></li>';
			}

			// Aktívna stránka
			if ($i == $p){
				$help_var=$i;
				echo '<li class="active"><a href="#">'.$i.'</a></li>';
			}

			// Tri bodky na začiatku
			if ($i == 2 && !isset($help_var)== 1){
				echo '<li><span>...</span></li>';
			}
			if ($i == 1 && !isset($help_var)== 1){
				echo '<li><a href="?page=admin-sections&p=1">1</a></li>';
			}

			// Tri bodky na konci
			if ($i == $all_pages_nums && $help_var + 1 < $all_pages_nums){
				echo '<li><span>...</span></li>';
			}
			if ($i == $all_pages_nums && $help_var  < $all_pages_nums){
				echo '<li><a href="?page=admin-sections&p='.$i.'&search='.$get_search.'">'.$all_pages_nums.'</a></li>';
			}
		}

	?>
	</ul>
</div>
</tfoot>