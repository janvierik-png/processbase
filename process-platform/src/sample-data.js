export const PROCESS_LIBRARY = [];

export const ORGANIZATIONS = [];

export const USERS = [];

export const ROLES = [
  { id: "admin", name: "Administrator", permissions: ["organization:write", "user:invite", "user:write", "process:write", "approval:override", "export:all"] },
  { id: "owner", name: "Owner firmy", permissions: ["organization:write", "user:invite", "process:write", "approval:request", "export:process"] },
  { id: "quality", name: "Manazer kvality", permissions: ["process:write", "iso:write", "approval:approve"] },
  { id: "approver", name: "Schvalovatel", permissions: ["process:read", "approval:approve"] },
  { id: "iso", name: "ISO auditor", permissions: ["process:read", "iso:write", "export:process"] }
];

export const INVITATIONS = [];

export const TRANSLATIONS = {
  sk: {
    "app.title": "Procesna kniznica",
    "actions.processes": "Procesy",
    "actions.settings": "Nastavenia firmy",
    "actions.save": "Ulozit",
    "actions.bpmnXml": "BPMN XML",
    "actions.camunda": "Camunda",
    "actions.newProcess": "Novy proces",
    "actions.newFolder": "Nova skupina",
    "actions.delete": "Vymazat",
    "tabs.diagram": "Diagram",
    "tabs.detail": "Popis",
    "tabs.iso": "ISO",
    "tabs.revisions": "Revizie",
    "tabs.approval": "Schvalovanie",
    "tabs.export": "Export",
    "tabs.admin": "Backoffice",
    "revisions.saveTitle": "Ulozit verziu procesu",
    "revisions.name": "Nazov verzie",
    "revisions.save": "Ulozit verziu",
    "revisions.open": "Otvorit verziu",
    "exports.html": "HTML s obrazkom",
    "attachments.upload": "Upload suboru",
    "attachments.add": "Pridat subory",
    "admin.translations": "Sprava prekladov",
    "admin.language": "Jazyk",
    "admin.key": "Kluc",
    "admin.value": "Preklad",
    "admin.add": "Pridat / ulozit preklad"
  },
  en: {
    "app.title": "Process Library",
    "actions.processes": "Processes",
    "actions.settings": "Company settings",
    "actions.save": "Save",
    "actions.bpmnXml": "BPMN XML",
    "actions.camunda": "Camunda",
    "actions.newProcess": "New process",
    "actions.newFolder": "New group",
    "actions.delete": "Delete",
    "tabs.diagram": "Diagram",
    "tabs.detail": "Description",
    "tabs.iso": "ISO",
    "tabs.revisions": "Revisions",
    "tabs.approval": "Approval",
    "tabs.export": "Export",
    "tabs.admin": "Backoffice",
    "revisions.saveTitle": "Save process version",
    "revisions.name": "Version name",
    "revisions.save": "Save version",
    "revisions.open": "Open version",
    "exports.html": "HTML with image",
    "attachments.upload": "Upload file",
    "attachments.add": "Add files",
    "admin.translations": "Translation management",
    "admin.language": "Language",
    "admin.key": "Key",
    "admin.value": "Translation",
    "admin.add": "Add / save translation"
  }
};

export const ISO_TEMPLATES = [
  {
    standard: "ISO 9001",
    clauses: [
      { clause: "4.4", title: "System manazerstva kvality a jeho procesy", evidence: "Mapa procesov, KPI, vlastnici procesov" },
      { clause: "7.2", title: "Kompetentnost", evidence: "Matica kompetencii, zaznamy zo skoleni" },
      { clause: "8.2.3", title: "Preskumanie poziadaviek", evidence: "Zaznam o preskumani objednavky" },
      { clause: "8.7", title: "Riadenie nezhodnych vystupov", evidence: "Zaznam o nezhode" },
      { clause: "10.2", title: "Nezhoda a napravne opatrenie", evidence: "Korekcne opatrenie, overenie ucinnosti" }
    ]
  },
  {
    standard: "ISO 14001",
    clauses: [
      { clause: "6.1.2", title: "Environmentalne aspekty", evidence: "Register aspektov a dopadov" },
      { clause: "8.1", title: "Operativne riadenie", evidence: "Prevadzkove postupy a zaznamy" },
      { clause: "9.1.1", title: "Monitorovanie a meranie", evidence: "Merania, reporty, vyhodnotenia" }
    ]
  },
  {
    standard: "ISO 45001",
    clauses: [
      { clause: "6.1.2", title: "Identifikacia nebezpecenstiev", evidence: "Register rizik BOZP" },
      { clause: "7.2", title: "Kompetentnost", evidence: "BOZP skolenia" },
      { clause: "8.1.2", title: "Odstranovanie nebezpecenstiev", evidence: "Opatrenia a kontroly" }
    ]
  },
  {
    standard: "ISO 27001",
    clauses: [
      { clause: "5.3", title: "Roly a zodpovednosti", evidence: "Bezpecnostne role" },
      { clause: "6.1.3", title: "Plan zaobchadzania s rizikami", evidence: "Plan opatreni" },
      { clause: "8.1", title: "Operativne planovanie a riadenie", evidence: "Prevadzkove zaznamy ISMS" }
    ]
  }
];
