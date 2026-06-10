<?php
	include_once("inc/navbar.php");
	
	$type_id = clear_input($_GET["id"]);
	$where_type_id = "WHERE tbl_zamerania_id = $type_id";

	$sql = "SELECT * FROM tbl_zamerania
					$where_type_id
	";
	$result = $result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_assoc($result);
	$type_name= $row["nazov_zamerania"];
		require_once("inc/access-permissions.php");



?>

<h2><?php echo $type_name ?></h2>
<table class="table table-sort remember-sort">
	<thead class="bg-black text-white">
	<tr>

	   <th><span class="glyphicon glyphicon-sort-by-alphabet"></span>Process code</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span></span>Name of process</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span>Department</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span>Responsible position</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span>Process participants</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span>Input</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span>Output</th>
		<th></span></span>Last<br>actualization</th>

	</tr>
	</thead>
	<tbody>
	<?php
		// Stránkovanie + vyhľadávanie
	 //****************************************************************************************************
		if($get_search != ""){
			$searched_focuses = [];
			$focuses ="";
			$sql = "SELECT * FROM tbl_zameranie_proc
								LEFT JOIN tbl_zamerania
								ON tbl_zamerania.tbl_zamerania_id = tbl_zameranie_proc.zameranie_id
							WHERE nazov_zamerania LIKE '%{$get_search}%'
			";
			$result = mysqli_query($connect, $sql);
			if($num_of_rows= mysqli_num_rows($result)>0){
				while($row = mysqli_fetch_assoc($result)){
					$trip_id = $row["proc_id"];
					array_push($searched_focuses,"tbl_proc_id = ".$trip_id);
				}
				$focuses = implode(" OR ",$searched_focuses);
				$focuses = $focuses." OR";
			}
		}

		$where = $get_search != "" ?
			"WHERE (tbl_zamerania_id = $type_id) AND ($focuses nazov LIKE '%{$get_search}%'
				OR cely_nazov LIKE '%{$get_search}%'
				OR DATE_FORMAT(datum, '%e.%c.%Y') LIKE '%{$get_search}%'
				OR DATE_FORMAT(datum, '%d.%m.%Y') LIKE '%{$get_search}%'

				OR popis LIKE '%{$get_search}%'
				OR vstup LIKE '%{$get_search}%'
				OR kod LIKE '{$get_search}'
				OR vystup LIKE '%{$get_search}%')
			"
		: "WHERE tbl_zamerania_id = $type_id";

		// Výber pre určenie počtu vrátených riadkov
		$sql = "SELECT * FROM tbl_proc
		LEFT JOIN tbl_odbory
						ON tbl_proc.odbor_id = tbl_odbory.tbl_odbory_id
                        LEFT JOIN tbl_zamerania
						ON tbl_proc.zodp_id = tbl_zamerania.tbl_zamerania_id
						$where
		";
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

	  // Výber pre zobrazenie záznamov v tabuľke na stránke
		$sql = "SELECT * FROM tbl_proc
						LEFT JOIN tbl_odbory
						ON tbl_proc.odbor_id = tbl_odbory.tbl_odbory_id
						LEFT JOIN tbl_zamerania
						ON tbl_proc.zodp_id = tbl_zamerania.tbl_zamerania_id
						$where
						ORDER by kod
						LIMIT $from, $records_on_page
		";
		$result = mysqli_query($connect, $sql);

		while($row = mysqli_fetch_assoc($result)){
			$id = $row["tbl_proc_id"];
			$section_id = $row["tbl_odbory_id"];
			$section = $row["cely_nazov"];
			$name = $row["nazov"];
			$type_id = $row["tbl_zamerania_id"];
			$type = $row["nazov_zamerania"];
			$input = $row["vstup"];
			$output = $row["vystup"];
			$date = date_format(date_create($row["datum"]),"d.m.Y");
			$count = $row["kod"];
			$decodedStringInput = htmlspecialchars_decode($input);
            $decodedStringOutput = htmlspecialchars_decode($output);



	?>
			<tr>

				<td width=8% ><?php echo $count ?></td>
				<td><b><a href="?page=editation&id=<?php echo $id ?>"><span class="glyphicon glyphicon-list-alt" ></span><?php  echo ('   '.$name) ?></a></b></td>
				<td><b><a href="?page=section&id=<?php echo $section_id ?>&p=1"><?php echo $section ?></a></b></td>
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
				<td><?php echo $date ?></td>
			</tr>
	<?php
	}
	?>


	</tbody>
</table>

<tfoot>
<tr>
	<ul class="pagination">
	<?php


		for ($i=1;$i<=$all_pages_nums;$i++){

			// Stránky
			if ($i >=($p - 4) && $i < $p  || $i > $p &&  $i <=($p + 4)){
				$help_var = $i;
				echo '<li><a href="?page=zodp&id='.$type_id.'&p='.$i.'&search='.$get_search.'">'.$i.'</a></li>';
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
				echo '<li><a href="?page=zodp&id='.$type_id.'&p='.$i.'&search='.$get_search.'">1</a></li>';
			}

			// Tri bodky na konci
			if ($i == $all_pages_nums && $help_var + 1 < $all_pages_nums){
				echo '<li><span>...</span></li>';
			}
			if ($i == $all_pages_nums && $help_var  < $all_pages_nums){
				echo '<li><a href="?page=zodp&id='.$type_id.'&p='.$i.'&search='.$get_search.'">'.$all_pages_nums.'</a></li>';
			}
		}

	?>
	</ul>
	</div>
</tfoot>


