export const seedRoles = [
  { id: "admin", name: "Administrator", permissions: ["organization:write", "user:invite", "user:write", "process:write", "approval:override", "export:all"] },
  { id: "owner", name: "Owner firmy", permissions: ["organization:write", "user:invite", "process:write", "approval:request", "export:process"] },
  { id: "quality", name: "Manazer kvality", permissions: ["process:write", "iso:write", "approval:approve"] },
  { id: "approver", name: "Schvalovatel", permissions: ["process:read", "approval:approve"] },
  { id: "iso", name: "ISO auditor", permissions: ["process:read", "iso:write", "export:process"] }
];

export const seedUsers = [];

export const seedOrganizations = [];

export const seedMemberships = [];

export const seedIsoTemplates = [
  ["iso9001-4-4", "ISO 9001", "4.4", "System manazerstva kvality a jeho procesy", "Mapa procesov, KPI, vlastnici procesov"],
  ["iso9001-7-2", "ISO 9001", "7.2", "Kompetentnost", "Matica kompetencii, zaznamy zo skoleni"],
  ["iso9001-8-2-3", "ISO 9001", "8.2.3", "Preskumanie poziadaviek", "Zaznam o preskumani objednavky"],
  ["iso9001-8-7", "ISO 9001", "8.7", "Riadenie nezhodnych vystupov", "Zaznam o nezhode"],
  ["iso9001-10-2", "ISO 9001", "10.2", "Nezhoda a napravne opatrenie", "Korekcne opatrenie a overenie ucinnosti"],
  ["iso14001-6-1-2", "ISO 14001", "6.1.2", "Environmentalne aspekty", "Register aspektov a dopadov"],
  ["iso14001-8-1", "ISO 14001", "8.1", "Operativne riadenie", "Prevadzkove postupy a zaznamy"],
  ["iso45001-6-1-2", "ISO 45001", "6.1.2", "Identifikacia nebezpecenstiev", "Register rizik BOZP"],
  ["iso45001-7-2", "ISO 45001", "7.2", "Kompetentnost", "BOZP skolenia"],
  ["iso27001-5-3", "ISO 27001", "5.3", "Roly a zodpovednosti", "Bezpecnostne role"],
  ["iso27001-6-1-3", "ISO 27001", "6.1.3", "Plan zaobchadzania s rizikami", "Plan opatreni"]
];
