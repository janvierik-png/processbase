export function createIsoRepository(db) {
  return {
    listTemplates() {
      return db.prepare("SELECT * FROM iso_templates ORDER BY standard, clause").all();
    },

    linkProcess(link) {
      db.prepare(`
        INSERT INTO process_iso_links (id, process_id, template_id, standard, clause, evidence)
        VALUES (@id, @process_id, @template_id, @standard, @clause, @evidence)
      `).run(link);
      return db.prepare("SELECT * FROM process_iso_links WHERE id = ?").get(link.id);
    },

    listProcessLinks(processId) {
      return db.prepare("SELECT * FROM process_iso_links WHERE process_id = ? ORDER BY standard, clause").all(processId);
    }
  };
}
