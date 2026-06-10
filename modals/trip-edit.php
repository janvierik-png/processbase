<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
	require_once("../inc/clear-input.php");
	
	$id = clear_input($_POST["id"]);
	
	$sql = "SELECT * FROM tbl_proc
					LEFT JOIN tbl_odbory
					ON tbl_proc.odbor_id = tbl_odbory.tbl_odbory_id
					LEFT JOIN tbl_zamerania
					ON tbl_proc.zodp_id = tbl_zamerania.tbl_zamerania_id
					WHERE tbl_proc.tbl_proc_id = $id
	";
	$result = mysqli_query($connect, $sql);
	$row = mysqli_fetch_assoc($result);
	
	$section_id = $row["odbor_id"];
	$section = $row["cely_nazov"];
	$name = $row["nazov"];
	$type_id = $row["tbl_zamerania_id"];
	$type = $row["nazov_zamerania"];
	$input = $row["vstup"];
	$output = $row["vystup"];
	$date = date_format(date_create($row["datum"]),"d.m.Y");
	$count = $row["kod"];
	$des = $row["popis"];
	$parent_id = $row["parent_id"];
$decodedString = htmlspecialchars_decode($des);
$decodedString2 = htmlspecialchars_decode($input);
?>

<!-- Modal -->
<div class="modal fade" id="business-trip-edit" role="dialog" data-backdrop="static">
	<div class="modal-dialog modal-lg">
	
		<!-- Modal content-->
		<div class="modal-content">
			<form enctype="multipart/form-data">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title"><span class="glyphicon glyphicon-transfer"></span> Process Editation</h4>
				</div>
				<div class="modal-body">

					<div class="form-group">
						<label for="trip">Name of process </label>
						<input type="text" class="form-control required" id="trip" name="trip" value="<?php echo $name ?>" placeholder="Write name of process...">
						<input type="hidden" id="id" name="id" value="<?php echo $id ?>">
					</div>

					<div class="form-group">
						<label for="section">Responsible department</label>
						<select class="form-control required" id="section" name="section">
							<option selected disabled>Choose responsible department...</option>
							<?php
							$sql = "SELECT * FROM tbl_odbory ORDER BY odbor";
							$result = mysqli_query($connect, $sql);
							while($row = mysqli_fetch_assoc($result)){
								$sect_id = $row["tbl_odbory_id"];
								$sect_short = $row["odbor"];
								$sect_name = $row["cely_nazov"];
							?>	
							<option value="<?php echo $sect_id ?>" title="<?php echo $sect_name ?>" <?php if($section_id == $sect_id) echo "selected" ?>><?php echo $sect_short ?></option>  
							<?php
							}
							?>
						</select>
					</div>
				
					<div class="form-group">
						<label for="date">Date of actualization</label>
						<input type="text" class="form-control required" id="date" name="date" value="<?php echo $date ?>" placeholder="Choose date of actualization...">
					</div>
								
					<div class="form-group">
						<label for="type">Responsible position</label>
						<select class="chosen-select textarea" id="type" name="type">
						<option selected disabled>Choose position responsible for process...</option>
							<?php
							$sql = "SELECT * FROM tbl_zamerania ORDER BY nazov_zamerania";
							$result = mysqli_query($connect, $sql);
							while($row = mysqli_fetch_assoc($result)){
								$tp_id = $row["tbl_zamerania_id"];
								$tp = $row["nazov_zamerania"];
							?>	
							<option value="<?php echo $tp_id ?>" title="<?php echo $tp ?>" <?php if($type_id == $tp_id) echo "selected" ?>><?php echo $tp ?></option>  
							<?php
							}
							?>
						</select>
					</div>
				
					<div class="form-group">
						<label for="input">Input</label>
						<input type="text" class="form-control textarea" id="input" name="input" value="<?php echo $input ?>" placeholder="Write inputs for the process start...">
					</div>
					
					<div class="form-group">
						<label for="state">Output</label>
						<input type="text" class="form-control textarea" id="state" name="state" value="<?php echo $output ?>" placeholder="Write outputs for the process end...">
					</div>	
					
					<div class="form-group">
						<label for="number">Process Code</label>
						<input type="text" class="form-control required" id="number" name="number" value="<?php echo $count ?>" placeholder="Write process code...">
					</div>
					
					<div class="form-group">
						<label for="focus">Members of process</label>
						<select class="chosen-select textarea" id="focus" name="focus" data-placeholder="Choose members of process..." multiple>
							<option></option>
							<?php

								$focus_arr = array();
								$sql = "SELECT * FROM tbl_zameranie_proc WHERE proc_id = $id";
								$result = mysqli_query($connect, $sql);
								while($row = mysqli_fetch_assoc($result)){
									$fid = $row["zameranie_id"];
									array_push($focus_arr, $fid);

								}

								$sql1 = "SELECT * FROM tbl_zamerania ORDER BY nazov_zamerania";
								$result1 = mysqli_query($connect, $sql1);
								while($row1 = mysqli_fetch_assoc($result1)){
									$foc_id= $row1["tbl_zamerania_id"];
									$foc_name = $row1["nazov_zamerania"];
									
									
							?>
								<option value="<?php echo $foc_id ?>" <?php if(in_array($foc_id, $focus_arr)) echo "selected" ?>>
									<?php echo $foc_name ?>
								</option>
							<?php
								}	
							?>
						</select>
					</div>

					 <div class="form-group">
						<label for="parent">Process Parent</label>
						<select class="chosen-select textarea" id="parent" name="parent">
							<option>Choose process parent...</option>

 <?php

                                $proc_arr = array();
								$sql = "SELECT * FROM tbl_child_parent
                           LEFT JOIN tbl_proc
                           ON tbl_child_parent.merge_parent_id = tbl_proc.tbl_proc_id
                           WHERE tbl_child_parent.merge_child_id = $id";
								$result = mysqli_query($connect, $sql);
								while($row = mysqli_fetch_assoc($result)){
									$pid = $row["merge_parent_id"];
									array_push($proc_arr, $pid);

								}

							$sql1 = "SELECT * FROM tbl_proc ORDER BY kod";

							$result1 = mysqli_query($connect, $sql1);
							while($row1 = mysqli_fetch_assoc($result1)){
								$process_id = $row1["tbl_proc_id"];
								$process_code = $row1["kod"];
								$process_name = $row1["nazov"];


							?>
							<option value="<?php echo $process_id ?>" <?php if(in_array($process_id, $proc_arr)) echo "selected" ?>>
									<?php echo $process_code. ' ' .$process_name ?>
								</option>
							<?php
							}
							?>
						</select>
					</div>

					<div class="form-group">
						<label for="merge">Connected process</label>
						<select class="chosen-select textarea" id="merge" name="merge" data-placeholder="If you know connected process choose it..." multiple>
							<option></option>
							<?php

								$merge_arr = array();
								$sql = "SELECT * FROM tbl_merge_proc WHERE tbl_proc1_id = $id";
								$result = mysqli_query($connect, $sql);
								while($row = mysqli_fetch_assoc($result)){
									$merge = $row["tbl_proc2_id"];
									array_push($merge_arr, $merge);

								}

								$sql1 = "SELECT * FROM tbl_proc ORDER BY kod";
								$result1 = mysqli_query($connect, $sql1);
								while($row1 = mysqli_fetch_assoc($result1)){
									$mer_id= $row1["tbl_proc_id"];
									$process_code = $row1["kod"];
									$mer_name = $row1["nazov"];


							?>
								<option value="<?php echo $mer_id ?>" <?php if(in_array($mer_id, $merge_arr)) echo "selected" ?>>
									<?php echo $process_code. ' ' .$mer_name ?>
								</option>
							<?php
								}
							?>
						</select>
					</div>

					<div class="form-group">
					<body>

						<label for="description">Description of process</label>

  <textarea id="summernote" name="description">

    <?php echo $decodedString?></textarea>


					</div>



					<div class="form-group">
						<input type="file" class="form-control" id="attachment" name="attachment">
					</div>
					
				</div>
				<div class="modal-footer">
					<button type="submit" class="btn btn-warning">Update</button>
					<button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
				</div>
			</form>	
		</div>
	</div>
</div>
<script>




//# Kurzor v prvom vstupnom poli modálneho okna
$('#business-trip-edit').on('shown.bs.modal', function () {
	$('#trip').focus();
});

 //# Vytvorí kalendár pri kliknutí do vstupného pola id="#business-trip-date" 
$("#date").datetimepicker({
	locale: "sk",
	calendarWeeks: true,
	useCurrent: false,
	format: "DD.MM.YYYY",
	sideBySide: true
});

//# Vytvorí multi výberové pole
$('.chosen-select').chosen();
$('.chosen-container').css("width","100%");
$('.chosen-select-deselect').chosen({ allow_single_deselect: true });


//# Umožní písať editovateľný text
 $(document).ready(function() {
        $('#summernote').summernote();
    });


