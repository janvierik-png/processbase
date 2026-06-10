





<?php



	include_once("inc/navbar.php");



		
	// Stránkovanie + vyhľadávanie
 //****************************************************************************************************
	$where = $get_search != "" ? "WHERE alias_pouzivatela LIKE '%{$get_search}%' OR meno_pouzivatela LIKE '%{$get_search}%' OR odbor LIKE '%{$get_search}%' OR cely_nazov LIKE '%{$get_search}%'" : "";
	
		$sql = "SELECT * FROM tbl_pouzivatelia
						LEFT JOIN tbl_odbory
						ON tbl_pouzivatelia.odbor_id = tbl_odbory.tbl_odbory_id
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
	
	$sql = "SELECT * FROM tbl_pouzivatelia LEFT JOIN tbl_odbory ON tbl_pouzivatelia.odbor_id = tbl_odbory.tbl_odbory_id $where ORDER BY odbor, alias_pouzivatela LIMIT $from, $records_on_page";
	$result = mysqli_query($connect, $sql);



?>
<?php
			if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_pouzivatelov", $permissions)){
		?>

<h2>Users Administration</h2>

<table class="table table-hover">
	<thead class="bg-black text-white">
	<tr>
		<th>#</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span> Department</th>
		<th><span class="glyphicon glyphicon-sort-by-alphabet"></span> Alias</th>
		<th>Name</th>
		<th>Changed<br>&nbsp;&nbsp;&nbsp;password</th>
		<th>Access</th>
		<?php
			if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_pouzivatelov", $permissions)){
		?>
				<th>Editation</th>
		<?php
			}
		?>

	</tr>
	</thead>
	<tbody>
	<?php
		$i = 0;
		while($row = mysqli_fetch_assoc($result)){
			$id = $row["id_pouzivatela"];
			$section_short = $row["odbor"];
			$section_name = $row["cely_nazov"];
			$alias = $row["alias_pouzivatela"]; 
			$name = $row["meno_pouzivatela"];
      $changed_pwd = $row["zmenene_heslo"] == 1 ? "Áno" : "Nie";			
			$from++;
	?>
			<tr>
				<td><?php echo $from ?></td>
				<td title="<?php echo $section_name ?>"><?php echo $section_short ?></td>
				<td><?php echo $alias ?></td>
				<td><?php echo $name ?></td>
				<td><?php echo $changed_pwd ?></td>
				<td>
				<?php 
					$sql1 = "SELECT * FROM tbl_pristupy
									 LEFT JOIN tbl_druhy_pristupov
									 ON tbl_pristupy.id_druhu_pristupu = tbl_druhy_pristupov.id_pristupu
									 WHERE tbl_pristupy.id_pouzivatela = $id
					";
					$result1 = mysqli_query($connect, $sql1);
					$access = array();
					$i=0;
					while($row1 = mysqli_fetch_assoc($result1)){
						$access_type = $row1["nazov_pristupu"];
						$access_type1 = $access_type  == "sprava_proc" ? '<span class="glyphicon glyphicon-road" title="Správa procesov"></span>':"";
						$access_type2 = $access_type  == "sprava_odborov" ? '<span class="glyphicon glyphicon-map-marker" title="Správa organizačných zložiek"></span>':"";
						$access_type3 = $access_type  == "sprava_pozicii" ? '<span class="glyphicon glyphicon-blackboard" title="Správa pozícií"></span>':"";
						$access_type4 = $access_type  == "sprava_ucast" ? '<span class="glyphicon glyphicon-comment" title="Správa vykonávateľov procesu"></span>':"";
						$access_type5 = $access_type  == "sprava_pouzivatelov" ? '<span class="glyphicon glyphicon-user" title="Správa používateľov"></span>':"";
						$access_type6 = $access_type  == "user_read" ? '<span class="glyphicon glyphicon-search" title="Správa používateľov"></span>':"";
						array_push($access, $access_type1,$access_type2,$access_type3,$access_type4,$access_type5,$access_type6);
					}
					
          $access = implode($access, " ");
					echo $access;
					
				?>
				</td>
				<?php
					if(isset($_SESSION["procesy-logged-in"]) && in_array("sprava_pouzivatelov", $permissions)){
				?>
						<td>
							<span class="glyphicon glyphicon-edit" data-action="edit-user" data-id="<?php echo $id ?>" title="Update"></span>&nbsp;&nbsp;
							<span class="glyphicon glyphicon-trash" data-action="delete-user" data-id="<?php echo $id ?>" data-name="<?php echo $name ?>" title="Delete"></span>
						</td>
				<?php
				}
				?>
			</tr>
		
	<?php
	}
	?>

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
				echo '<li><a href="?page=admin-users&p='.$i.'&search='.$get_search.'">'.$i.'</a></li>';
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
				echo '<li><a href="?page=admin-users&p=1">1</a></li>';
			}
			
			// Tri bodky na konci
			if ($i == $all_pages_nums && $help_var + 1 < $all_pages_nums){ 
				echo '<li><span>...</span></li>';
			}
			if ($i == $all_pages_nums && $help_var  < $all_pages_nums){ 
				echo '<li><a href="?page=admin-users&p='.$i.'&search='.$get_search.'">'.$all_pages_nums.'</a></li>';
			}
		}

	?>

	</ul>
</div>
</tfoot>


