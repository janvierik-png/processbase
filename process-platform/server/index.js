import express from "express";
import multer from "multer";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db/database.js";
import { getCamunda7Config } from "./config/camunda7.js";
import { createApprovalRepository } from "./repositories/approvalRepository.js";
import { createIsoRepository } from "./repositories/isoRepository.js";
import { createOrganizationRepository } from "./repositories/organizationRepository.js";
import { createProcessRepository } from "./repositories/processRepository.js";
import { createUserRepository } from "./repositories/userRepository.js";
import { buildDocx, buildPdf } from "./services/documentExportService.js";
import { createCamunda7Service } from "./services/camunda7Service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadDir = join(__dirname, "..", "data", "attachments");
mkdirSync(uploadDir, { recursive: true });

const db = openDatabase();
const processes = createProcessRepository(db);
const organizations = createOrganizationRepository(db);
const users = createUserRepository(db);
const iso = createIsoRepository(db);
const approvals = createApprovalRepository(db);
const camunda7 = createCamunda7Service(getCamunda7Config());
const upload = multer({ dest: uploadDir });
const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.static(join(__dirname, "..", "dist")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/processes", (req, res) => {
  res.json(processes.listTree());
});

app.get("/api/processes/:id", (req, res) => {
  const process = processes.find(req.params.id);
  if (!process) return res.status(404).json({ error: "Process not found" });
  res.json({
    process,
    revisions: processes.listRevisions(process.id),
    iso: iso.listProcessLinks(process.id),
    approvals: approvals.listProcessWorkflow(process.id)
  });
});

app.post("/api/processes", (req, res) => {
  const process = processes.save({
    id: req.body.id || randomUUID(),
    organization_id: req.body.organization_id || null,
    parent_id: req.body.parent_id || null,
    name: req.body.name,
    owner_user_id: req.body.owner_user_id || null,
    status: req.body.status || "draft",
    purpose: req.body.purpose || "",
    risks: req.body.risks || "",
    bpmn_xml: req.body.bpmn_xml || null,
    sort_order: req.body.sort_order || 0
  });
  res.status(201).json(process);
});

app.post("/api/register", (req, res) => {
  const result = organizations.register({
    organizationName: req.body.organizationName,
    companyId: req.body.companyId || "",
    userName: req.body.userName,
    email: req.body.email,
    passwordHash: req.body.passwordHash || ""
  });
  res.status(201).json(result);
});

app.get("/api/organizations/:id", (req, res) => {
  const org = organizations.find(req.params.id);
  if (!org) return res.status(404).json({ error: "Organization not found" });
  res.json(org);
});

app.patch("/api/organizations/:id", (req, res) => {
  const org = organizations.update(req.params.id, {
    name: req.body.name,
    company_id: req.body.companyId
  });
  if (!org) return res.status(404).json({ error: "Organization not found" });
  res.json(org);
});

app.get("/api/organizations/:id/users", (req, res) => {
  res.json(organizations.listMembers(req.params.id));
});

app.get("/api/organizations/:id/invitations", (req, res) => {
  res.json(organizations.listInvitations(req.params.id));
});

app.post("/api/organizations/:id/invitations", (req, res) => {
  res.status(201).json(organizations.invite({
    organizationId: req.params.id,
    email: req.body.email,
    roleId: req.body.roleId,
    invitedByUserId: req.body.invitedByUserId || null
  }));
});

app.post("/api/processes/:id/revisions", (req, res) => {
  res.status(201).json(processes.addRevision({
    id: randomUUID(),
    process_id: req.params.id,
    revision_date: req.body.revision_date || new Date().toISOString().slice(0, 10),
    version_label: req.body.version_label || "v1",
    change_note: req.body.change_note || "",
    author_user_id: req.body.author_user_id || null,
    bpmn_xml: req.body.bpmn_xml || null
  }));
});

app.post("/api/processes/:id/attachments", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Missing file" });
  const attachment = {
    id: randomUUID(),
    process_id: req.params.id,
    file_name: req.file.originalname,
    mime_type: req.file.mimetype,
    storage_path: req.file.path,
    owner_user_id: req.body.owner_user_id || null
  };
  db.prepare(`
    INSERT INTO attachments (id, process_id, file_name, mime_type, storage_path, owner_user_id)
    VALUES (@id, @process_id, @file_name, @mime_type, @storage_path, @owner_user_id)
  `).run(attachment);
  res.status(201).json(attachment);
});

app.get("/api/users", (req, res) => {
  res.json(users.listUsers());
});

app.get("/api/roles", (req, res) => {
  res.json(users.listRoles());
});

app.get("/api/iso/templates", (req, res) => {
  res.json(iso.listTemplates());
});

app.get("/api/camunda7/config", (req, res) => {
  res.json(camunda7.config);
});

app.get("/api/camunda7/deployments", async (req, res) => {
  try {
    res.json(await camunda7.listDeployments());
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message, details: error.body || null });
  }
});

app.post("/api/camunda7/deploy", async (req, res) => {
  try {
    const result = await camunda7.deployBpmn({
      deploymentName: req.body.deploymentName,
      resourceName: req.body.resourceName || `${req.body.processId || "process"}.bpmn`,
      bpmnXml: req.body.bpmnXml,
      deployChangedOnly: req.body.deployChangedOnly !== false,
      tenantId: req.body.tenantId || ""
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message, details: error.body || null });
  }
});

app.post("/api/camunda7/start", async (req, res) => {
  try {
    res.status(201).json(await camunda7.startProcessDefinition({
      key: req.body.key,
      variables: req.body.variables || {},
      businessKey: req.body.businessKey || ""
    }));
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message, details: error.body || null });
  }
});

app.post("/api/processes/:id/iso-links", (req, res) => {
  res.status(201).json(iso.linkProcess({
    id: randomUUID(),
    process_id: req.params.id,
    template_id: req.body.template_id || null,
    standard: req.body.standard,
    clause: req.body.clause,
    evidence: req.body.evidence || ""
  }));
});

app.post("/api/processes/:id/approvals", (req, res) => {
  const workflow = approvals.createWorkflow({
    id: randomUUID(),
    process_id: req.params.id,
    state: "requested",
    requested_by_user_id: req.body.requested_by_user_id || null,
    requested_at: new Date().toISOString()
  });
  for (const [index, approver_user_id] of (req.body.approver_user_ids || []).entries()) {
    approvals.addStep({
      id: randomUUID(),
      workflow_id: workflow.id,
      approver_user_id,
      step_order: index + 1,
      state: "pending",
      note: "",
      decided_at: null
    });
  }
  res.status(201).json(workflow);
});

app.get("/api/processes/:id/export.pdf", async (req, res) => {
  const process = processes.find(req.params.id);
  if (!process) return res.status(404).json({ error: "Process not found" });
  const buffer = await buildPdf(process, {
    revisions: processes.listRevisions(process.id),
    iso: iso.listProcessLinks(process.id)
  });
  res.type("application/pdf").send(buffer);
});

app.get("/api/processes/:id/export.docx", async (req, res) => {
  const process = processes.find(req.params.id);
  if (!process) return res.status(404).json({ error: "Process not found" });
  const buffer = await buildDocx(process, {
    revisions: processes.listRevisions(process.id),
    iso: iso.listProcessLinks(process.id)
  });
  res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document").send(buffer);
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Process platform API running on http://127.0.0.1:${port}`);
});
