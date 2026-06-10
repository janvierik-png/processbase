PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_id TEXT,
  owner_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  invited_by_user_id TEXT REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT,
  accepted_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TEXT
);

CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES processes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  purpose TEXT NOT NULL DEFAULT '',
  risks TEXT NOT NULL DEFAULT '',
  bpmn_xml TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_revisions (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  revision_date TEXT NOT NULL,
  version_label TEXT NOT NULL,
  change_note TEXT NOT NULL,
  author_user_id TEXT REFERENCES users(id),
  bpmn_xml TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_workflows (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'draft',
  requested_by_user_id TEXT REFERENCES users(id),
  requested_at TEXT,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS approval_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  approver_user_id TEXT NOT NULL REFERENCES users(id),
  step_order INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  note TEXT NOT NULL DEFAULT '',
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS iso_templates (
  id TEXT PRIMARY KEY,
  standard TEXT NOT NULL,
  clause TEXT NOT NULL,
  title TEXT NOT NULL,
  evidence_hint TEXT NOT NULL DEFAULT '',
  UNIQUE (standard, clause)
);

CREATE TABLE IF NOT EXISTS process_iso_links (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES iso_templates(id) ON DELETE SET NULL,
  standard TEXT NOT NULL,
  clause TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_processes_parent ON processes(parent_id);
CREATE INDEX IF NOT EXISTS idx_processes_org ON processes(organization_id);
CREATE INDEX IF NOT EXISTS idx_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_revisions_process ON process_revisions(process_id);
CREATE INDEX IF NOT EXISTS idx_attachments_process ON attachments(process_id);
CREATE INDEX IF NOT EXISTS idx_iso_links_process ON process_iso_links(process_id);
