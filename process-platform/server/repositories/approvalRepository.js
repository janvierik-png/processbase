export function createApprovalRepository(db) {
  return {
    createWorkflow(workflow) {
      db.prepare(`
        INSERT INTO approval_workflows (id, process_id, state, requested_by_user_id, requested_at)
        VALUES (@id, @process_id, @state, @requested_by_user_id, @requested_at)
      `).run(workflow);
      return db.prepare("SELECT * FROM approval_workflows WHERE id = ?").get(workflow.id);
    },

    addStep(step) {
      db.prepare(`
        INSERT INTO approval_steps (id, workflow_id, approver_user_id, step_order, state, note, decided_at)
        VALUES (@id, @workflow_id, @approver_user_id, @step_order, @state, @note, @decided_at)
      `).run(step);
      return db.prepare("SELECT * FROM approval_steps WHERE id = ?").get(step.id);
    },

    listProcessWorkflow(processId) {
      return db.prepare(`
        SELECT approval_workflows.*, approval_steps.id AS step_id, approval_steps.approver_user_id,
               approval_steps.step_order, approval_steps.state AS step_state, approval_steps.note, approval_steps.decided_at
        FROM approval_workflows
        LEFT JOIN approval_steps ON approval_steps.workflow_id = approval_workflows.id
        WHERE approval_workflows.process_id = ?
        ORDER BY approval_workflows.requested_at DESC, approval_steps.step_order
      `).all(processId);
    }
  };
}
