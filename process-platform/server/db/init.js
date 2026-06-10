import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedIsoTemplates, seedMemberships, seedOrganizations, seedRoles, seedUsers } from "./seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, "process-platform.sqlite"));
db.pragma("foreign_keys = ON");
db.exec(readFileSync(join(__dirname, "schema.sql"), "utf8"));

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("roles", "organization_id", "TEXT REFERENCES organizations(id) ON DELETE CASCADE");
ensureColumn("processes", "organization_id", "TEXT REFERENCES organizations(id) ON DELETE CASCADE");

const orgStmt = db.prepare("INSERT OR IGNORE INTO organizations (id, name, company_id, owner_user_id) VALUES (?, ?, ?, ?)");
for (const org of seedOrganizations) {
  orgStmt.run(org.id, org.name, org.companyId, org.ownerUserId);
}

const roleStmt = db.prepare(`
  INSERT INTO roles (id, organization_id, name, permissions_json)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    permissions_json = excluded.permissions_json
`);
for (const role of seedRoles) {
  roleStmt.run(role.id, null, role.name, JSON.stringify(role.permissions));
}

const userStmt = db.prepare("INSERT OR IGNORE INTO users (id, name, email) VALUES (?, ?, ?)");
const userRoleStmt = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)");
for (const user of seedUsers) {
  userStmt.run(user.id, user.name, user.email);
  for (const roleId of user.roles) userRoleStmt.run(user.id, roleId);
}

const memberStmt = db.prepare("INSERT OR IGNORE INTO organization_members (organization_id, user_id, status) VALUES (?, ?, 'active')");
for (const membership of seedMemberships) {
  memberStmt.run(membership.organizationId, membership.userId);
}

const isoStmt = db.prepare("INSERT OR IGNORE INTO iso_templates (id, standard, clause, title, evidence_hint) VALUES (?, ?, ?, ?, ?)");
for (const template of seedIsoTemplates) isoStmt.run(...template);

db.close();
console.log("Database initialized in process-platform/data/process-platform.sqlite");
