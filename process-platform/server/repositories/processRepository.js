export function createProcessRepository(db) {
  return {
    listTree() {
      return db.prepare("SELECT * FROM processes ORDER BY parent_id, sort_order, name").all();
    },

    find(id) {
      return db.prepare("SELECT * FROM processes WHERE id = ?").get(id);
    },

    save(process) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO processes (id, organization_id, parent_id, name, owner_user_id, status, purpose, risks, bpmn_xml, sort_order, updated_at)
        VALUES (@id, @organization_id, @parent_id, @name, @owner_user_id, @status, @purpose, @risks, @bpmn_xml, @sort_order, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          organization_id = excluded.organization_id,
          parent_id = excluded.parent_id,
          name = excluded.name,
          owner_user_id = excluded.owner_user_id,
          status = excluded.status,
          purpose = excluded.purpose,
          risks = excluded.risks,
          bpmn_xml = excluded.bpmn_xml,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at
      `).run({ ...process, updated_at: now });
      return this.find(process.id);
    },

    addRevision(revision) {
      db.prepare(`
        INSERT INTO process_revisions (id, process_id, revision_date, version_label, change_note, author_user_id, bpmn_xml)
        VALUES (@id, @process_id, @revision_date, @version_label, @change_note, @author_user_id, @bpmn_xml)
      `).run(revision);
      return db.prepare("SELECT * FROM process_revisions WHERE id = ?").get(revision.id);
    },

    listRevisions(processId) {
      return db.prepare("SELECT * FROM process_revisions WHERE process_id = ? ORDER BY revision_date DESC").all(processId);
    }
  };
}
