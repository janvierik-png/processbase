<?php
	include_once("inc/connect.php");
	include_once("inc/clear-input.php");
	
	$get_page = isset($_GET["page"]) ? clear_input($_GET["page"]) : "";
	$get_id = isset($_GET["id"]) ? clear_input($_GET["id"]) : "";
	$get_p = isset($_GET["p"]) ? clear_input($_GET["p"]) : "";
	$get_search = isset($_GET["search"]) ? clear_input($_GET["search"]) : "";
	$admin_pages = ["admin-sections","admin-types","admin-focuses","admin-users"];

?>
<h1 size="4"<h1><img src="img/Evona_logo.png"  style="width:45px"> Process management </h1>
<nav class="navbar navbar-default">
	<div class="container-fluid">
		<div class="navbar-header">

		  <a class="navbar-brand" href="?page=all-proc&p=1&search=" title="Process Table"><span class="glyphicon glyphicon-th-list"></span></a>
		  <a class="navbar-brand" href="?page=tree" title="Process Hierarchy"><span class="glyphicon glyphicon-align-left"></span></a>
		    <a class="navbar-brand" href="?page=documents" title="Documents"><span class="glyphicon glyphicon-folder-open"></span></a>
		  <a class="navbar-brand" href="?page=org" title="Organization structure"><span class="glyphicon glyphicon-tree-deciduous"></span></a>

		</div>
		<?php	
			if(!in_array($get_page,$admin_pages)){
		?>

					
				<ul class="nav navbar-nav">	
					<li class="dropdown">
					<a class="dropdown-toggle" data-toggle="dropdown" href="#">Departments<span class="caret"></span></a>
						<ul class="dropdown-menu">
							<li><a href="?page=all-proc&p=1&search=">All Departments</a></li>
							<?php
							$sql = "SELECT * FROM tbl_odbory ORDER BY poradie";
							$result = mysqli_query($connect, $sql);
							while($row = mysqli_fetch_assoc($result)){
								$section_id = $row["tbl_odbory_id"];
								$section_short = $row["odbor"];
								$section_name = $row["cely_nazov"];
							?>	
							<li title="<?php echo $section_name ?>"><a href="?page=section&id=<?php echo $section_id ?>&p=1&search="><?php echo $section_short ?></a></li>
							<?php
							}
							?>
						</ul>
					</li>
				</ul>

					<ul class="nav navbar-nav">
					<li class="dropdown">
					<a class="dropdown-toggle" data-toggle="dropdown" href="#">Responsible positions<span class="caret"></span></a>
						<ul class="dropdown-menu" id="myDropdown">
                        <input class="form-control mr-sm-2" type="text" placeholder="Search.." id="myInput" onkeyup="filterFunction()">

							<li><a href="?page=all-proc&p=1&search=">All</a></li>
							<?php
							$sql = "SELECT * FROM tbl_zamerania order by nazov_zamerania";
							$result = mysqli_query($connect, $sql);
							while($row = mysqli_fetch_assoc($result)){
								$type_id = $row["tbl_zamerania_id"];
								$type_name = $row["nazov_zamerania"];
							?>
							<li title="<?php echo $type_name ?>"><a href="?page=zodp&id=<?php echo $type_id ?>&p=1&search="><?php echo $type_name ?></a></li>
							<?php
							}
							?>
						</ul>
					</li>

				</ul>

				<ul class="nav navbar-nav">
					<li class="dropdown">
					<a class="dropdown-toggle" data-toggle="dropdown" href="#">Participant<span class="caret"></span></a>
						<ul class="dropdown-menu" id="myDropdowns">
                        <input class="form-control mr-sm-2" type="text" placeholder="Search.." id="myInputs" onkeyup="filterFunctions()">
							<li><a href="?page=all-proc&p=1&search=">All</a></li>
							<?php
							$sql = "SELECT * FROM tbl_zamerania order by nazov_zamerania";
							$result = mysqli_query($connect, $sql);
							while($row = mysqli_fetch_assoc($result)){
								$focus_id = $row["tbl_zamerania_id"];
								$focus_name = $row["nazov_zamerania"];
							?>
							<li title="<?php echo $focus_name ?>"><a href="?page=focus&id=<?php echo $focus_id ?>&p=1&search="><?php echo $focus_name ?></a></li>
							<?php
							}
							?>
						</ul>
					</li>
				</ul>

			<?php
			}
			if(isset($_SESSION['procesy-logged-in'])){
			?>
				<ul class="nav navbar-nav">
					<?php
						if(in_array("sprava_odborov", $permissions) || in_array("sprava_pozicii", $permissions) || in_array("sprava_ucast", $permissions)  || in_array("sprava_pouzivatelov", $permissions)){
					?>				
					
					<li class="dropdown">
						<a class="dropdown-toggle" data-toggle="dropdown" href="#">Administration
						<span class="caret"></span></a>
						<ul class="dropdown-menu">
						<?php
							if(in_array("sprava_odborov", $permissions)){
						?>
								<li><a href="?page=admin-sections&p=1&search="><span class="glyphicon glyphicon-briefcase"></span> Departments</a></li>

							<?php
							}
							if(in_array("sprava_ucast", $permissions)){
							?>
								<li><a href="?page=admin-focuses&p=1&search="><span class="glyphicon glyphicon-education"></span> Work positions</a></li>
							<?php
							}
							if(in_array("sprava_pouzivatelov", $permissions)){ 
							?>
								<li><a href="?page=admin-users&p=1&search="><span class="glyphicon glyphicon-user"></span> Users</a></li>
							<?php
							}
							?>
						</ul>
					</li>
					<?php
					}
					?>

				</ul>
					<?php	
						if(in_array("sprava_proc", $permissions)){
							if(!in_array($get_page,$admin_pages)){								
					?>
								<ul class="nav navbar-nav navbar-left">
									&nbsp;<a href="#" data-target="#new-process" class="btn btn-default navbar-btn" title="New Process"><span class="glyphicon glyphicon-transfer"></span></a>
								</ul>
					<?php
							}
						}
					?>
					
					<?php
						if(in_array("sprava_odborov", $permissions)){
							if($get_page == "admin-sections"){
					?>
								<ul class="nav navbar-nav navbar-left">
									&nbsp;<a href="#" data-target="#new-section" class="btn btn-default navbar-btn" title="New Department"><span class="glyphicon glyphicon-map-marker"></span></a>
								</ul>
					<?php
							}
						}
					?>
					
					<?php
						if(in_array("sprava_pozicii", $permissions)){
							if($get_page == "admin-types"){
					?>
								<ul class="nav navbar-nav navbar-left">
									&nbsp;<a href="#" data-target="#new-type" class="btn btn-default navbar-btn" title="Nové podujatie"><span class="glyphicon glyphicon-blackboard"></span></a>
								</ul>
					<?php
							}
						}
					?>
					
					<?php
						if(in_array("sprava_ucast", $permissions)){
							if($get_page == "admin-focuses"){								
					?>
								<ul class="nav navbar-nav navbar-left">
									&nbsp;<a href="#" data-target="#new-focus" class="btn btn-default navbar-btn" title="New Position"><span class="glyphicon glyphicon-comment"></span></a>
								</ul>
					<?php
							}
						}
					?>
					
					<?php
						if(in_array("sprava_pouzivatelov", $permissions)){
							if($get_page == "admin-users"){	
					?>
							<ul class="nav navbar-nav navbar-left">
								&nbsp;<a href="#" data-target="#new-user" class="btn btn-default navbar-btn" title="New User"><span class="glyphicon glyphicon-user"></span></a>
							</ul>
					<?php
							}
						}
					?>

				
			<?php
			}
		  ?>

			<?php
				if($get_page != "editation")
				if($get_page != "tree2")
				if($get_page != "org"){
			?>
				<form id="form-search" name="form-search" class="navbar-form navbar-left" method="GET" action="">
					<div class="form-group">
						<input type="hidden" name="page" value="<?php echo $get_page ?>">
						<?php
							if($get_page == "section" || $get_page == "zodp" || $get_page == "focus"){
						?>
							<input type="hidden" name="id" value="<?php echo $get_id ?>">
						<?php
							}
						?>
						<input type="hidden" name="p" value="<?php echo $get_p ?>">
						<input type="text" class="form-control" name="search" value="<?php echo $get_search ?>" placeholder="Search...">
					</div>
					<button type="submit" class="btn btn-default">Search</button>
				</form>

		<?php
			}
			if(!isset($_SESSION['procesy-logged-in'])){
		?>
				<ul class="nav navbar-nav navbar-right">
					<li><a href="#" data-toggle="modal" data-target="#login"><span class="glyphicon glyphicon-log-in"></span> Login</a></li>
				</ul>
			<?php
				}else{
					$user = $_SESSION["procesy-user"];
			?>


				<ul class="nav navbar-nav navbar-right">
					<li class="dropdown">
						<a href="#" class="dropdown-toggle" data-toggle="dropdown" role="button" aria-expanded="false"><span class="glyphicon glyphicon-user"></span> <?php echo $user ?> <span class="caret"></span></a>
						<ul class="dropdown-menu" role="menu">
							<li><a href="#" id="user-settings"><span class="glyphicon glyphicon-cog"></span> Password Change</a></li>
							<li class="divider"></li>
							<li><a href="scripts/logout.php" onclick="showOverlay('Odhlasujem sa...')"><span class="glyphicon glyphicon-log-out"></span> Logout</a></li>
						</ul>
					</li>
				</ul>
			
			<?php
				}
			?>			
	</div>
</nav>


