<?php
session_start();

	require_once("../inc/access-permissions.php");
	if(!in_array("sprava_proc", $permissions)) exit;
?>

<!-- Modal -->
<div class="modal fade" id="new-process" role="dialog" data-backdrop="static">
	<div class="modal-dialog modal-lg">

		<!-- Modal content-->
		<div class="modal-content">
			<form enctype="multipart/form-data">
				<div class="modal-header">
					<button type="button" class="close" data-dismiss="modal">&times;</button>
					<h4 class="modal-title"><span class="glyphicon glyphicon-transfer"></span> Add new process</h4>
				</div>
				<div class="modal-body">

					<div class="form-group">
						<label for="trip">Name of process</label>
						<input type="text" class="form-control required" id="trip" name="trip" placeholder="Write name of process...">
					</div>

					<div class="form-group">
						<label for="section">Responsible department</label>
						<select class="form-control required" id="section" name="section">
							<option selected disabled>Choose responsible department...</option>
							<?php
							$sql = "SELECT * FROM tbl_odbory ORDER BY odbor";
							$result = mysqli_query($connect, $sql);
							while($row = mysqli_fetch_assoc($result)){
								$section_id = $row["tbl_odbory_id"];
								$section_short = $row["odbor"];
								$section_name = $row["cely_nazov"];
							?>
							<option value="<?php echo $section_id ?>" title="<?php echo $section_name ?>"><?php echo $section_short ?></option>
							<?php
							}
							?>
						</select>
					</div>

					<div class="form-group">
						<label for="date">Date of actualization</label>
						<input type="text" class="form-control textarea" id="date" name="date" placeholder="Choose date of actualization...">
					</div>

					<div class="form-group">
						<label for="type">Responsible position</label>
						<select class="form-control required" id="type" name="type">


						<option selected disabled>Choose position responsible for process...</option>
							<?php
							$sql2 = "SELECT * FROM tbl_zamerania ORDER BY nazov_zamerania";
							$result2 = mysqli_query($connect, $sql2);
							while($row2 = mysqli_fetch_assoc($result2)){
								$ordered_id = $row2["tbl_zamerania_id"];
								$ordered = $row2["nazov_zamerania"];
							?>
							<option value="<?php echo $ordered_id ?>" title="<?php echo $ordered ?>"><?php echo $ordered ?></option>
							<?php
							}
							?>
						</select>
					</div>

					<div class="form-group">
						<label for="input">Input</label>

						<input type="text" class="form-control textarea" id="input" name="input" placeholder="Write inputs for the process start...">
					</div>

					<div class="form-group">
						<label for="state">Výstup</label>
						<input type="text" class="form-control textarea" id="state" name="state" placeholder="Write outputs for the process end...">
					</div>

					<div class="form-group">
						<label for="number">Process Code</label>
						<input type="text" class="form-control required" id="number" name="number" placeholder="Write process code...">
					</div>

<div class="form-group">
						<label for="focus">Members of process</label>
						<select class="chosen-select textarea" id="focus" name="focus" data-placeholder="Choose members of process..." multiple>
							<option></option>
							<?php
								$sql = "SELECT * FROM tbl_zamerania ORDER BY nazov_zamerania";
								$result = mysqli_query($connect, $sql);
								while($row = mysqli_fetch_assoc($result)){
									$id= $row["tbl_zamerania_id"];
									$focus = $row["nazov_zamerania"];

							?>
								<option value="<?php echo $id ?>">
									<?php echo $focus ?>
								</option>
							<?php
								}
							?>
						</select>
					</div>

<div class="form-group">
            <label for="parent">Process Parent</label>
            <select class="form-control textarea"  id="parent" name="parent">
               <option>Choose process parent...</option>
               <?php
               $sql = "SELECT * FROM tbl_proc ORDER BY kod";
               $result = mysqli_query($connect, $sql);
               while($row = mysqli_fetch_assoc($result)){
                  $process_id = $row["tbl_proc_id"];
                  $process_code = $row["kod"];
                  $process_name = $row["nazov"];
               ?>
               <option value="<?php echo $process_id ?>" title="<?php echo $process_name ?>"><?php echo $process_code. ' ' .$process_name ?></option>
               <?php
               }
               ?>
            </select>
         </div>


				<div class="form-group">
					<body>

						<label for="description">Process description</label>

  <textarea id="summernote" name="description"></textarea>


					</div>




					<div class="form-group">
						<input type="file" class="form-control" id="attachment" name="attachment">
					</div>



				</div>
				<div class="modal-footer">
					<button type="submit" class="btn btn-primary">Add process</button>
					<button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
				</div>
			</form>	
		</div>
	</div>
</div>
<script>

//# Kurzor v prvom vstupnom poli modálneho okna
$('#new-process').on('shown.bs.modal', function () {
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
</script>
