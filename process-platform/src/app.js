import BpmnModeler from "bpmn-js/lib/Modeler";
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule,
  CamundaPlatformPropertiesProviderModule
} from "bpmn-js-properties-panel";
import camundaModdleDescriptors from "camunda-bpmn-moddle/resources/camunda.json";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "@bpmn-io/properties-panel/dist/assets/properties-panel.css";
import "../styles/app.css";
import { INVITATIONS, ISO_TEMPLATES, ORGANIZATIONS, PROCESS_LIBRARY, ROLES, TRANSLATIONS, USERS } from "./sample-data.js";

const OWNER_FLOW_VERSION = "owner-first-v3";

if (localStorage.getItem("processAppVersion") !== OWNER_FLOW_VERSION) {
  [
    "processLibrary",
    "processOrganizations",
    "processUsers",
    "processRoles",
    "processInvitations",
    "activeOrganizationId",
    "currentUserId",
    "activeProcessId"
  ].forEach((key) => localStorage.removeItem(key));
  localStorage.setItem("processAppVersion", OWNER_FLOW_VERSION);
}

const state = {
  library: JSON.parse(localStorage.getItem("processLibrary")) || PROCESS_LIBRARY,
  organizations: JSON.parse(localStorage.getItem("processOrganizations")) || ORGANIZATIONS,
  users: JSON.parse(localStorage.getItem("processUsers")) || USERS,
  roles: JSON.parse(localStorage.getItem("processRoles")) || ROLES,
  invitations: JSON.parse(localStorage.getItem("processInvitations")) || INVITATIONS,
  translations: JSON.parse(localStorage.getItem("processTranslations")) || TRANSLATIONS,
  language: localStorage.getItem("processLanguage") || "sk",
  isoTemplates: ISO_TEMPLATES,
  activeOrgId: localStorage.getItem("activeOrganizationId") || null,
  currentUserId: localStorage.getItem("currentUserId") || null,
  activeId: localStorage.getItem("activeProcessId") || null,
  selectedNodeId: null,
  selectedTreeId: localStorage.getItem("selectedTreeId") || null,
  sidebarCollapsed: localStorage.getItem("sidebarCollapsed") === "true",
  propertiesCollapsed: localStorage.getItem("propertiesCollapsed") === "true"
};

const els = {
  appShell: document.querySelector("#appShell"),
  landingShell: document.querySelector("#landingShell"),
  landingRegisterForm: document.querySelector("#landingRegisterForm"),
  landingLoginForm: document.querySelector("#landingLoginForm"),
  loginMessage: document.querySelector("#loginMessage"),
  processTree: document.querySelector("#processTree"),
  search: document.querySelector("#processSearch"),
  toggleSidebarBtn: document.querySelector("#toggleSidebarBtn"),
  togglePropertiesBtn: document.querySelector("#togglePropertiesBtn"),
  openSettingsBtn: document.querySelector("#openSettingsBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  addFolderBtn: document.querySelector("#addFolderBtn"),
  deleteTreeBtn: document.querySelector("#deleteTreeBtn"),
  languageSelect: document.querySelector("#languageSelect"),
  path: document.querySelector("#processPath"),
  title: document.querySelector("#processTitle"),
  owner: document.querySelector("#ownerValue"),
  status: document.querySelector("#statusValue"),
  revision: document.querySelector("#revisionValue"),
  iso: document.querySelector("#isoValue"),
  canvas: document.querySelector("#bpmnCanvas"),
  bpmnPropertiesPanel: document.querySelector("#bpmnPropertiesPanel"),
  processForm: document.querySelector("#processForm"),
  isoMap: document.querySelector("#isoMap"),
  isoForm: document.querySelector("#isoForm"),
  historyList: document.querySelector("#historyList"),
  revisionForm: document.querySelector("#revisionForm"),
  revisionName: document.querySelector("#revisionName"),
  workflowList: document.querySelector("#workflowList"),
  workflowForm: document.querySelector("#workflowForm"),
  approvalUser: document.querySelector("#approvalUser"),
  activeOrgName: document.querySelector("#activeOrgName"),
  organizationForm: document.querySelector("#organizationForm"),
  organizationName: document.querySelector("#organizationName"),
  organizationCompanyId: document.querySelector("#organizationCompanyId"),
  registrationDialog: document.querySelector("#registrationDialog"),
  registrationForm: document.querySelector("#registrationForm"),
  inviteForm: document.querySelector("#inviteForm"),
  inviteRole: document.querySelector("#inviteRole"),
  usersList: document.querySelector("#usersList"),
  rolesList: document.querySelector("#rolesList"),
  invitationsList: document.querySelector("#invitationsList"),
  attachmentForm: document.querySelector("#attachmentForm"),
  attachmentInput: document.querySelector("#attachmentInput"),
  attachmentsList: document.querySelector("#attachmentsList"),
  translationForm: document.querySelector("#translationForm"),
  translationLanguage: document.querySelector("#translationLanguage"),
  translationKey: document.querySelector("#translationKey"),
  translationValue: document.querySelector("#translationValue"),
  translationList: document.querySelector("#translationList"),
  dialog: document.querySelector("#camundaDialog"),
  camundaPreview: document.querySelector("#camundaPreview"),
  modelerStatus: document.querySelector("#modelerStatus"),
  modelerHost: document.querySelector("#bpmnModeler"),
  svgFallback: document.querySelector("#svgFallback")
};

let bpmnModeler = null;
let syncingModeler = false;

function flatten(nodes, parents = []) {
  return nodes.flatMap((node) => {
    const path = [...parents, node.name];
    const current = { ...node, path };
    return node.children ? [current, ...flatten(node.children, path)] : [current];
  });
}

function findProcess(id) {
  return flatten(state.library).find((item) => item.id === id);
}

function updateProcess(id, patch) {
  function walk(nodes) {
    return nodes.map((node) => {
      if (node.id === id) return { ...node, ...patch };
      if (node.children) return { ...node, children: walk(node.children) };
      return node;
    });
  }
  state.library = walk(state.library);
  persist();
}

function persist() {
  localStorage.setItem("processLibrary", JSON.stringify(state.library));
  localStorage.setItem("processOrganizations", JSON.stringify(state.organizations));
  localStorage.setItem("processUsers", JSON.stringify(state.users));
  localStorage.setItem("processRoles", JSON.stringify(state.roles));
  localStorage.setItem("processInvitations", JSON.stringify(state.invitations));
  localStorage.setItem("processTranslations", JSON.stringify(state.translations));
  localStorage.setItem("processLanguage", state.language);
  localStorage.setItem("activeOrganizationId", state.activeOrgId);
  localStorage.setItem("currentUserId", state.currentUserId);
  localStorage.setItem("activeProcessId", state.activeId);
  localStorage.setItem("selectedTreeId", state.selectedTreeId || "");
  localStorage.setItem("sidebarCollapsed", String(state.sidebarCollapsed));
  localStorage.setItem("propertiesCollapsed", String(state.propertiesCollapsed));
}

function activeOrganization() {
  return state.organizations.find((org) => org.id === state.activeOrgId);
}

function organizationUsers() {
  return state.users.filter((user) => user.organizationId === state.activeOrgId);
}

function organizationInvitations() {
  return state.invitations.filter((invite) => invite.organizationId === state.activeOrgId);
}

function allProcesses() {
  return flatten(state.library).filter((item) => item.type === "process");
}

function currentUser() {
  return state.users.find((user) => user.id === state.currentUserId);
}

function currentRole() {
  const user = currentUser();
  return user ? state.roles.find((role) => role.id === user.roleId) : null;
}

function isAuthenticated() {
  return Boolean(state.currentUserId && state.activeOrgId && currentUser());
}

function renderAuthState() {
  const authenticated = isAuthenticated();
  els.landingShell.hidden = authenticated;
  els.appShell.hidden = !authenticated;
  document.body.classList.toggle("is-authenticated", authenticated);
}

function createOwnerAccount({ organizationName, name, email, password }) {
  const orgId = `org_${Date.now()}`;
  const userId = `user_${Date.now()}`;
  const org = {
    id: orgId,
    name: organizationName,
    companyId: "",
    ownerUserId: userId,
    createdAt: new Date().toISOString().slice(0, 10)
  };
  const user = {
    id: userId,
    organizationId: orgId,
    name,
    email,
    password,
    roleId: "owner",
    active: true,
    status: "active"
  };
  state.organizations = [org, ...state.organizations];
  state.users = [user, ...state.users];
  state.library = [];
  state.activeOrgId = orgId;
  state.currentUserId = userId;
  state.activeId = null;
  persist();
  renderAuthState();
  window.scrollTo({ top: 0, left: 0 });
  renderTree();
  renderProcess();
}

function canManageOrganization() {
  const role = currentRole();
  return Boolean(role?.permissions.includes("organization:write") || role?.permissions.includes("user:invite"));
}

function setActiveTab(tabName) {
  document.querySelectorAll(".tab").forEach((item) => {
    const active = item.dataset.tab === tabName;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tabName}Panel`);
  });
}

function t(key) {
  return state.translations[state.language]?.[key] || state.translations.sk?.[key] || key;
}

function applyTranslations() {
  els.languageSelect.value = state.language;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  renderTranslationList();
}

function renderTranslationList() {
  if (!els.translationList) return;
  const rows = Object.entries(state.translations[els.translationLanguage.value] || {}).map(([key, value]) => `
    <article class="translation-row" data-translation-key="${key}">
      <strong>${escapeHtml(key)}</strong>
      <span>${escapeHtml(value)}</span>
    </article>
  `).join("");
  els.translationList.innerHTML = rows || "<article class=\"translation-row\"><span>Ziadne preklady.</span></article>";
}

function renderLayoutToggles() {
  els.appShell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  document.querySelector("#diagramPanel .canvas-layout")?.classList.toggle("properties-collapsed", state.propertiesCollapsed);
  els.toggleSidebarBtn.textContent = state.sidebarCollapsed ? "Zobrazit procesy" : "Skryt procesy";
  els.togglePropertiesBtn.textContent = state.propertiesCollapsed ? "Zobrazit vlastnosti" : "Skryt vlastnosti";
}

function renderTree() {
  const query = els.search.value.trim().toLowerCase();
  const matches = (node) => {
    const haystack = `${node.name} ${node.owner || ""} ${(node.iso || []).map((i) => `${i.standard} ${i.clause}`).join(" ")}`.toLowerCase();
    return haystack.includes(query) || (node.children || []).some(matches);
  };

  function branch(nodes, level = 0) {
    return nodes.filter(matches).map((node) => {
      const isProcess = node.type === "process";
      const active = node.id === state.activeId || node.id === state.selectedTreeId ? " active" : "";
      const button = `<button class="tree-item${active}" draggable="true" style="--level:${level}" data-id="${node.id}" data-type="${node.type}">
        <span class="tree-icon">${isProcess ? "P" : "F"}</span>
        <span>${node.name}</span>
      </button>`;
      return `${button}${node.children ? `<div class="tree-children">${branch(node.children, level + 1)}</div>` : ""}`;
    }).join("");
  }

  els.processTree.innerHTML = state.library.length
    ? branch(state.library)
    : `<div class="empty-tree">${activeOrganization() ? "Firma este nema vytvorene procesy." : "Najprv vytvorte firmu."}</div>`;
}

function renderProcess() {
  renderAuthState();
  if (!isAuthenticated()) {
    applyTranslations();
    return;
  }
  if (!state.activeId && allProcesses().length) {
    state.activeId = allProcesses()[0].id;
  }
  renderOrganization();
  renderUsers();
  const process = findProcess(state.activeId);
  if (!process) {
    renderEmptyProcess();
    return;
  }

  els.path.textContent = process.path.slice(0, -1).join(" / ");
  els.title.textContent = process.name;
  els.owner.textContent = process.owner;
  els.status.textContent = process.status;
  els.revision.textContent = process.revision;
  els.iso.textContent = process.iso.map((item) => `${item.standard.replace("ISO ", "")}: ${item.clause}`).join(", ");

  document.querySelector("#processName").value = process.name;
  document.querySelector("#processOwner").value = process.owner;
  document.querySelector("#processStatus").value = process.status;
  document.querySelector("#processRevision").value = process.revision;
  document.querySelector("#processPurpose").value = process.purpose;
  document.querySelector("#processRisks").value = process.risks;
  document.querySelector("#camundaDeployment").value = process.name;

  renderDiagram(process);
  renderIso(process);
  renderHistory(process);
  renderWorkflow(process);
  renderAttachments(process);
  renderLayoutToggles();
  applyTranslations();
}

function renderEmptyProcess() {
  const org = activeOrganization();
  els.path.textContent = org ? org.name : "Registracia firmy";
  els.title.textContent = org ? "Zatial nie je vytvoreny proces" : "Vytvorte owner ucet";
  els.owner.textContent = "-";
  els.status.textContent = "-";
  els.revision.textContent = "-";
  els.iso.textContent = "-";
  document.querySelector("#processName").value = "";
  document.querySelector("#processOwner").value = "";
  document.querySelector("#processStatus").value = "Navrh";
  document.querySelector("#processRevision").value = "";
  document.querySelector("#processPurpose").value = "";
  document.querySelector("#processRisks").value = "";
  document.querySelector("#camundaDeployment").value = "";
  els.modelerHost.hidden = true;
  els.svgFallback.hidden = false;
  els.modelerStatus.textContent = "Ziadny proces";
  els.svgFallback.innerHTML = `<div class="empty-canvas">
    <strong>${org ? "Vytvorte prvy proces tlacidlom +" : "Najprv sa zaregistrujte ako owner firmy"}</strong>
    <span>${org ? "Firma zacina s prazdnou procesnou kniznicou." : "Owner vytvori firmu a ziska nastavenia organizacie."}</span>
  </div>`;
  els.isoMap.innerHTML = "";
  els.historyList.innerHTML = "";
  els.workflowList.innerHTML = "";
  els.attachmentsList.innerHTML = "";
  renderLayoutToggles();
  applyTranslations();
}

async function renderDiagram(process) {
  if (BpmnModeler) {
    await renderBpmnModeler(process);
    return;
  }

  els.modelerHost.hidden = true;
  els.svgFallback.hidden = false;
  els.modelerStatus.textContent = "Fallback SVG canvas";
  renderFallbackDiagram(process);
}

async function renderBpmnModeler(process) {
  els.modelerHost.hidden = false;
  els.svgFallback.hidden = true;
  els.modelerStatus.textContent = "bpmn-js modeler";

  if (!bpmnModeler) {
    bpmnModeler = new BpmnModeler({
      container: els.modelerHost,
      propertiesPanel: {
        parent: els.bpmnPropertiesPanel
      },
      additionalModules: [
        BpmnPropertiesPanelModule,
        BpmnPropertiesProviderModule,
        CamundaPlatformPropertiesProviderModule
      ],
      moddleExtensions: {
        camunda: camundaModdleDescriptors
      }
    });
    bpmnModeler.on("commandStack.changed", async () => {
      if (syncingModeler) return;
      const active = findProcess(state.activeId);
      if (!active) return;
      const result = await bpmnModeler.saveXML({ format: true });
      updateProcess(active.id, { bpmnXml: result.xml });
    });
  }

  const xml = process.bpmnXml || toBpmnXml(process);
  try {
    syncingModeler = true;
    await bpmnModeler.importXML(xml);
    bpmnModeler.get("canvas").zoom("fit-viewport");
  } catch (error) {
    console.warn("BPMN import failed, using generated fallback XML.", error);
    await bpmnModeler.importXML(toBpmnXml(process));
    bpmnModeler.get("canvas").zoom("fit-viewport");
  } finally {
    syncingModeler = false;
  }
}

function renderFallbackDiagram(process) {
  const width = Math.max(1060, Math.max(...process.diagram.map((n) => n.x)) + 190);
  const lanes = [...new Set(process.diagram.map((node) => node.role || "Proces"))];
  const laneHeight = 96;
  const height = Math.max(310, lanes.length * laneHeight + 40);
  const laneY = (role) => 30 + lanes.indexOf(role || "Proces") * laneHeight;
  const lines = process.diagram.slice(0, -1).map((node, index) => {
    const next = process.diagram[index + 1];
    const y1 = laneY(node.role) + 48;
    const y2 = laneY(next.role) + 48;
    return `<path class="flow" d="M ${node.x + 112} ${y1} C ${node.x + 160} ${y1}, ${next.x - 52} ${y2}, ${next.x - 8} ${y2}" marker-end="url(#arrow)" />`;
  }).join("");

  const laneMarkup = lanes.map((role) => `
    <g>
      <rect class="lane" x="0" y="${laneY(role)}" width="${width}" height="${laneHeight}"></rect>
      <text class="lane-label" x="18" y="${laneY(role) + 28}">${role}</text>
    </g>
  `).join("");

  const nodes = process.diagram.map((node) => {
    const y = laneY(node.role) + 24;
    const selected = node.id === state.selectedNodeId ? " selected" : "";
    if (node.shape === "start" || node.shape === "end") {
      return `<g class="node${selected}" data-node-id="${node.id}">
        <circle cx="${node.x + 36}" cy="${y + 24}" r="24"></circle>
        <text x="${node.x + 76}" y="${y + 20}">${node.label}</text>
        <text class="node-role" x="${node.x + 76}" y="${y + 39}">${node.role}</text>
      </g>`;
    }
    if (node.shape === "gateway") {
      return `<g class="node${selected}" data-node-id="${node.id}">
        <polygon points="${node.x + 44},${y} ${node.x + 88},${y + 44} ${node.x + 44},${y + 88} ${node.x},${y + 44}"></polygon>
        <text x="${node.x + 108}" y="${y + 39}">${node.label}</text>
        <text class="node-role" x="${node.x + 108}" y="${y + 58}">${node.role}</text>
      </g>`;
    }
    return `<g class="node${selected}" data-node-id="${node.id}">
      <rect x="${node.x}" y="${y}" width="128" height="54" rx="6"></rect>
      <text x="${node.x + 14}" y="${y + 24}">${node.label}</text>
      <text class="node-role" x="${node.x + 14}" y="${y + 42}">${node.role}</text>
    </g>`;
  }).join("");

  els.svgFallback.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z"></path>
      </marker>
    </defs>
    ${laneMarkup}
    ${lines}
    ${nodes}
  </svg>`;
}

function renderIso(process) {
  const templateRows = state.isoTemplates.map((template) => `
    <article class="iso-template">
      <strong>${template.standard}</strong>
      <span>${template.clauses.map((clause) => `${clause.clause} ${clause.title}`).join(" | ")}</span>
    </article>
  `).join("");

  els.isoMap.innerHTML = `${process.iso.map((item) => `
    <article class="iso-row">
      <strong>${item.standard} / ${item.clause}</strong>
      <span>${item.evidence}</span>
    </article>
  `).join("")}
  <h3>ISO sablony</h3>
  ${templateRows}`;
}

function renderHistory(process) {
  const revisions = (process.revisions || []).map((revision) => `
    <article class="revision-row">
      <strong>${revision.name}</strong>
      <span>${revision.date}</span>
      <button type="button" data-open-revision="${revision.id}">Otvorit verziu</button>
    </article>
  `).join("");
  const history = process.history.map((item) => `<article>${item}</article>`).join("");
  els.historyList.innerHTML = `${revisions || "<article>Zatial nie je ulozena ziadna verzia procesu.</article>"}${history}`;
}

function renderWorkflow(process) {
  els.approvalUser.innerHTML = state.users
    .filter((user) => user.organizationId === state.activeOrgId)
    .filter((user) => user.active)
    .map((user) => `<option value="${user.id}">${user.name}</option>`)
    .join("");

  els.workflowList.innerHTML = (process.approvals || []).map((approval) => {
    const user = state.users.find((item) => item.id === approval.userId);
    return `<article class="workflow-step">
      <strong>${user ? user.name : approval.userId}</strong>
      <span>${approval.state} - ${approval.date}</span>
      <p>${approval.note}</p>
    </article>`;
  }).join("");
}

function renderUsers() {
  const org = activeOrganization();
  if (!org) {
    els.activeOrgName.textContent = "Bez firmy";
    els.organizationName.value = "";
    els.organizationCompanyId.value = "";
    els.usersList.innerHTML = "";
    els.rolesList.innerHTML = "";
    els.invitationsList.innerHTML = "";
    els.inviteRole.innerHTML = "";
    return;
  }

  els.activeOrgName.textContent = org.name;
  els.organizationName.value = org.name;
  els.organizationCompanyId.value = org.companyId || "";
  els.inviteRole.innerHTML = state.roles.map((role) => `<option value="${role.id}">${role.name}</option>`).join("");
  const canManage = canManageOrganization();
  els.organizationForm.querySelectorAll("input, button").forEach((control) => control.disabled = !canManage);
  els.inviteForm.querySelectorAll("input, select, button").forEach((control) => control.disabled = !canManage);
  els.inviteForm.querySelector("h3").textContent = canManage ? "Pozvat spolupracovnika" : "Pozvanie je dostupne ownerovi";

  els.usersList.innerHTML = organizationUsers().map((user) => {
    const role = state.roles.find((item) => item.id === user.roleId);
    return `<article class="user-row">
      <strong>${user.name}</strong>
      <span>${user.email}</span>
      <small>${role ? role.name : user.roleId} - ${user.status}</small>
    </article>`;
  }).join("");

  els.rolesList.innerHTML = state.roles.map((role) => `
    <article class="role-row">
      <strong>${role.name}</strong>
      <span>${role.permissions.join(", ")}</span>
    </article>
  `).join("");

  els.invitationsList.innerHTML = organizationInvitations().map((invite) => {
    const role = state.roles.find((item) => item.id === invite.roleId);
    return `<article class="invitation-row">
      <strong>${invite.email}</strong>
      <span>${role ? role.name : invite.roleId} - ${invite.status}</span>
      <small>Token: ${invite.token}</small>
    </article>`;
  }).join("");
}

function renderOrganization() {
  const org = activeOrganization();
  if (!org) {
    els.activeOrgName.textContent = "Bez firmy";
    return;
  }
  els.activeOrgName.textContent = org.name;
}

function renderAttachments(process) {
  els.attachmentsList.innerHTML = (process.attachments || []).map((attachment) => `
    <article class="attachment-row">
      <strong>${attachment.name}</strong>
      <span>${attachment.type} - ${attachment.owner}</span>
      ${attachment.dataUrl ? `<a href="${attachment.dataUrl}" download="${attachment.name}">Stiahnut</a>` : ""}
    </article>
  `).join("") || "<article class=\"attachment-row\"><span>Proces nema prilohy.</span></article>";
}

function containsNode(node, id) {
  return node.id === id || (node.children || []).some((child) => containsNode(child, id));
}

function removeTreeNode(nodes, id) {
  let removed = null;
  const next = [];
  for (const node of nodes) {
    if (node.id === id) {
      removed = node;
      continue;
    }
    if (node.children) {
      const result = removeTreeNode(node.children, id);
      removed = removed || result.removed;
      next.push({ ...node, children: result.nodes });
    } else {
      next.push(node);
    }
  }
  return { nodes: next, removed };
}

function insertTreeNode(nodes, targetId, nodeToInsert, mode) {
  const next = [];
  let inserted = false;

  for (const node of nodes) {
    if (node.id === targetId) {
      if (mode === "inside" && node.type === "folder") {
        next.push({ ...node, children: [...(node.children || []), nodeToInsert] });
      } else {
        next.push(node, nodeToInsert);
      }
      inserted = true;
      continue;
    }

    if (node.children) {
      const result = insertTreeNode(node.children, targetId, nodeToInsert, mode);
      inserted = inserted || result.inserted;
      next.push({ ...node, children: result.nodes });
    } else {
      next.push(node);
    }
  }

  return { nodes: next, inserted };
}

function moveTreeNode(draggedId, targetId, mode) {
  const dragged = flatten(state.library).find((node) => node.id === draggedId);
  const target = flatten(state.library).find((node) => node.id === targetId);
  if (!dragged || !target || containsNode(dragged, targetId)) return;

  const removed = removeTreeNode(state.library, draggedId);
  if (!removed.removed) return;

  const inserted = insertTreeNode(removed.nodes, targetId, removed.removed, mode);
  state.library = inserted.inserted ? inserted.nodes : [...removed.nodes, removed.removed];
  persist();
}

function deleteSelectedTreeNode() {
  const id = state.selectedTreeId || state.activeId;
  if (!id) return;
  const node = flatten(state.library).find((item) => item.id === id);
  if (!node) return;
  const message = node.type === "folder"
    ? `Vymazat skupinu "${node.name}" aj so vsetkym obsahom?`
    : `Vymazat proces "${node.name}"?`;
  if (!confirm(message)) return;

  const removed = removeTreeNode(state.library, id);
  state.library = removed.nodes;
  if (state.activeId === id || (removed.removed && containsNode(removed.removed, state.activeId))) {
    state.activeId = allProcesses()[0]?.id || null;
  }
  state.selectedTreeId = state.activeId;
  persist();
  renderTree();
  renderProcess();
}

async function saveCurrentBpmnXml(process) {
  const bpmnXml = bpmnModeler ? (await bpmnModeler.saveXML({ format: true })).xml : process.bpmnXml || toBpmnXml(process);
  updateProcess(process.id, { bpmnXml });
  return bpmnXml;
}

async function getDiagramSvg(process) {
  if (bpmnModeler) {
    const result = await bpmnModeler.saveSVG();
    return result.svg;
  }
  return process.diagramSvg || els.svgFallback.querySelector("svg")?.outerHTML || "";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openRevision(process, revisionId) {
  const revision = (process.revisions || []).find((item) => item.id === revisionId);
  if (!revision) return;
  updateProcess(process.id, {
    name: revision.snapshot.name,
    owner: revision.snapshot.owner,
    status: revision.snapshot.status,
    revision: revision.date,
    purpose: revision.snapshot.purpose,
    risks: revision.snapshot.risks,
    iso: revision.snapshot.iso,
    approvals: revision.snapshot.approvals,
    attachments: revision.snapshot.attachments,
    bpmnXml: revision.bpmnXml,
    diagramSvg: revision.diagramSvg,
    diagram: revision.snapshot.diagram || process.diagram || [],
    history: [`${new Date().toISOString().slice(0, 10)}: Otvorena revizia ${revision.name}.`, ...process.history]
  });
  renderProcess();
}

function activeProcessPatch() {
  return {
    name: document.querySelector("#processName").value.trim(),
    owner: document.querySelector("#processOwner").value.trim(),
    status: document.querySelector("#processStatus").value,
    revision: document.querySelector("#processRevision").value,
    purpose: document.querySelector("#processPurpose").value.trim(),
    risks: document.querySelector("#processRisks").value.trim()
  };
}

function toBpmnXml(process) {
  const nodes = process.diagram;
  if (!nodes.length) {
    return createEmptyBpmnXml(process.id, process.name);
  }
  const tasks = nodes.map((node) => {
    const tag = node.shape === "gateway" ? "exclusiveGateway" : node.shape === "start" ? "startEvent" : node.shape === "end" ? "endEvent" : "task";
    const incoming = nodes.findIndex((item) => item.id === node.id) > 0 ? `\n      <bpmn:incoming>flow_${nodes.findIndex((item) => item.id === node.id)}</bpmn:incoming>` : "";
    const outgoing = nodes.findIndex((item) => item.id === node.id) < nodes.length - 1 ? `\n      <bpmn:outgoing>flow_${nodes.findIndex((item) => item.id === node.id) + 1}</bpmn:outgoing>` : "";
    return `    <bpmn:${tag} id="${node.id}" name="${escapeXml(node.label)}">${incoming}${outgoing}
    </bpmn:${tag}>`;
  }).join("\n");
  const flows = nodes.slice(0, -1).map((node, index) => `    <bpmn:sequenceFlow id="flow_${index + 1}" sourceRef="${node.id}" targetRef="${nodes[index + 1].id}" />`).join("\n");
  const shapes = nodes.map((node) => {
    const bounds = node.shape === "start" || node.shape === "end"
      ? { x: node.x, y: node.y, width: 36, height: 36 }
      : node.shape === "gateway"
        ? { x: node.x, y: node.y, width: 50, height: 50 }
        : { x: node.x, y: node.y, width: 120, height: 70 };
    return `      <bpmndi:BPMNShape id="${node.id}_di" bpmnElement="${node.id}">
        <dc:Bounds x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" />
      </bpmndi:BPMNShape>`;
  }).join("\n");
  const edges = nodes.slice(0, -1).map((node, index) => {
    const next = nodes[index + 1];
    return `      <bpmndi:BPMNEdge id="flow_${index + 1}_di" bpmnElement="flow_${index + 1}">
        <di:waypoint x="${node.x + 120}" y="${node.y + 35}" />
        <di:waypoint x="${next.x}" y="${next.y + 35}" />
      </bpmndi:BPMNEdge>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_${process.id}" targetNamespace="https://procesna-kniznica.local/bpmn">
  <bpmn:process id="Process_${process.id}" name="${escapeXml(process.name)}" isExecutable="true">
${tasks}
${flows}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${process.id}">
    <bpmndi:BPMNPlane id="BPMNPlane_${process.id}" bpmnElement="Process_${process.id}">
${shapes}
${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function createEmptyBpmnXml(processId, processName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_${processId}" targetNamespace="https://procesna-kniznica.local/bpmn">
  <bpmn:process id="Process_${processId}" name="${escapeXml(processName)}" isExecutable="true" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_${processId}">
    <bpmndi:BPMNPlane id="BPMNPlane_${processId}" bpmnElement="Process_${processId}" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;"
  }[char]));
}

document.addEventListener("click", (event) => {
  const treeButton = event.target.closest(".tree-item");
  if (treeButton) {
    state.selectedTreeId = treeButton.dataset.id;
    if (treeButton.dataset.type !== "process") {
      persist();
      renderTree();
      return;
    }
    state.activeId = treeButton.dataset.id;
    state.selectedNodeId = null;
    persist();
    renderTree();
    renderProcess();
  }

  const revisionButton = event.target.closest("[data-open-revision]");
  if (revisionButton) {
    const process = findProcess(state.activeId);
    if (!process) return;
    openRevision(process, revisionButton.dataset.openRevision);
  }

  const node = event.target.closest(".node");
  if (node) {
    const process = findProcess(state.activeId);
    if (!process) return;
    const selected = process.diagram.find((item) => item.id === node.dataset.nodeId);
    state.selectedNodeId = selected.id;
    renderDiagram(process);
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.tab);
  });
});

els.openSettingsBtn.addEventListener("click", () => {
  if (!activeOrganization()) {
    renderAuthState();
    return;
  }
  setActiveTab("users");
});

els.toggleSidebarBtn.addEventListener("click", () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  persist();
  renderLayoutToggles();
});

els.togglePropertiesBtn.addEventListener("click", () => {
  state.propertiesCollapsed = !state.propertiesCollapsed;
  persist();
  renderLayoutToggles();
});

els.processForm.addEventListener("input", () => {
  if (!findProcess(state.activeId)) return;
  updateProcess(state.activeId, activeProcessPatch());
  renderTree();
  renderProcess();
});

els.isoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const process = findProcess(state.activeId);
  if (!process) return;
  const iso = [
    ...process.iso,
    {
      standard: document.querySelector("#isoStandard").value,
      clause: document.querySelector("#isoClause").value.trim(),
      evidence: document.querySelector("#isoEvidence").value.trim()
    }
  ];
  updateProcess(process.id, { iso });
  els.isoForm.reset();
  renderProcess();
});

els.workflowForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const process = findProcess(state.activeId);
  if (!process) return;
  const approval = {
    userId: document.querySelector("#approvalUser").value,
    state: document.querySelector("#approvalState").value,
    note: document.querySelector("#approvalNote").value.trim(),
    date: new Date().toISOString().slice(0, 10)
  };
  updateProcess(process.id, {
    approvals: [approval, ...(process.approvals || [])],
    history: [`${approval.date}: Pridany schvalovaci krok.`, ...process.history]
  });
  els.workflowForm.reset();
  renderProcess();
});

els.revisionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const process = findProcess(state.activeId);
  if (!process) return;
  const date = new Date().toISOString().slice(0, 10);
  const bpmnXml = await saveCurrentBpmnXml(process);
  const diagramSvg = await getDiagramSvg(process);
  const revision = {
    id: `rev_${Date.now()}`,
    name: els.revisionName.value.trim(),
    date,
    bpmnXml,
    diagramSvg,
    snapshot: {
      name: process.name,
      owner: process.owner,
      status: process.status,
      purpose: process.purpose,
      risks: process.risks,
      iso: process.iso || [],
      approvals: process.approvals || [],
      attachments: process.attachments || [],
      diagram: process.diagram || []
    }
  };
  updateProcess(process.id, {
    revision: date,
    revisions: [revision, ...(process.revisions || [])],
    history: [`${date}: Ulozena verzia ${revision.name}.`, ...process.history]
  });
  els.revisionForm.reset();
  renderProcess();
});

els.organizationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const org = activeOrganization();
  if (!org) return;
  state.organizations = state.organizations.map((item) => item.id === org.id
    ? {
        ...item,
        name: els.organizationName.value.trim(),
        companyId: els.organizationCompanyId.value.trim()
      }
    : item);
  persist();
  renderUsers();
});

els.inviteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.querySelector("#inviteEmail").value.trim().toLowerCase();
  const roleId = document.querySelector("#inviteRole").value;
  const invite = {
    id: `inv_${Date.now()}`,
    organizationId: state.activeOrgId,
    email,
    roleId,
    invitedByUserId: state.currentUserId,
    status: "pending",
    token: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `token_${Date.now()}`,
    createdAt: new Date().toISOString().slice(0, 10)
  };
  state.invitations = [invite, ...state.invitations];
  persist();
  els.inviteForm.reset();
  renderUsers();
});

els.registrationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createOwnerAccount({
    organizationName: document.querySelector("#registerOrganizationName").value.trim(),
    name: document.querySelector("#registerUserName").value.trim(),
    email: document.querySelector("#registerUserEmail").value.trim().toLowerCase(),
    password: document.querySelector("#registerPassword").value
  });
  els.registrationDialog.close();
});

els.landingRegisterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createOwnerAccount({
    organizationName: document.querySelector("#landingRegisterOrganization").value.trim(),
    name: document.querySelector("#landingRegisterName").value.trim(),
    email: document.querySelector("#landingRegisterEmail").value.trim().toLowerCase(),
    password: document.querySelector("#landingRegisterPassword").value
  });
  els.landingRegisterForm.reset();
});

els.landingLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.querySelector("#landingLoginEmail").value.trim().toLowerCase();
  const password = document.querySelector("#landingLoginPassword").value;
  const user = state.users.find((item) => item.email === email && item.password === password && item.active);
  if (!user) {
    els.loginMessage.textContent = "Nespravny email alebo heslo.";
    return;
  }
  state.currentUserId = user.id;
  state.activeOrgId = user.organizationId;
  state.activeId = allProcesses()[0]?.id || null;
  persist();
  els.loginMessage.textContent = "";
  els.landingLoginForm.reset();
  renderAuthState();
  window.scrollTo({ top: 0, left: 0 });
  renderTree();
  renderProcess();
});

els.search.addEventListener("input", renderTree);

els.deleteTreeBtn.addEventListener("click", deleteSelectedTreeNode);

els.languageSelect.addEventListener("change", () => {
  state.language = els.languageSelect.value;
  persist();
  applyTranslations();
});

els.translationLanguage.addEventListener("change", renderTranslationList);

els.translationList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-translation-key]");
  if (!row) return;
  const lang = els.translationLanguage.value;
  els.translationKey.value = row.dataset.translationKey;
  els.translationValue.value = state.translations[lang]?.[row.dataset.translationKey] || "";
});

els.translationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const lang = els.translationLanguage.value;
  state.translations[lang] = {
    ...(state.translations[lang] || {}),
    [els.translationKey.value.trim()]: els.translationValue.value.trim()
  };
  persist();
  els.translationForm.reset();
  els.translationLanguage.value = lang;
  applyTranslations();
});

document.querySelectorAll("[data-auth-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-auth-view]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".auth-form").forEach((form) => form.classList.toggle("active", form.id === `landing${button.dataset.authView[0].toUpperCase()}${button.dataset.authView.slice(1)}Form`));
  });
});

els.logoutBtn.addEventListener("click", () => {
  state.currentUserId = null;
  state.activeOrgId = null;
  state.activeId = null;
  persist();
  renderAuthState();
});

els.attachmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const process = findProcess(state.activeId);
  if (!process) return;
  const files = [...els.attachmentInput.files];
  const uploaded = await Promise.all(files.map(async (file) => ({
    id: `att_${Date.now()}_${file.name}`,
    name: file.name,
    type: file.type || "subor",
    owner: currentUser()?.name || "Owner",
    size: file.size,
    createdAt: new Date().toISOString().slice(0, 10),
    dataUrl: await readFileAsDataUrl(file)
  })));
  updateProcess(process.id, {
    attachments: [...(process.attachments || []), ...uploaded],
    history: [`${new Date().toISOString().slice(0, 10)}: Pridane prilohy (${uploaded.length}).`, ...process.history]
  });
  els.attachmentForm.reset();
  renderProcess();
});

els.processTree.addEventListener("dragstart", (event) => {
  const item = event.target.closest(".tree-item");
  if (!item) return;
  event.dataTransfer.setData("text/plain", item.dataset.id);
  event.dataTransfer.effectAllowed = "move";
  item.classList.add("dragging");
});

els.processTree.addEventListener("dragend", (event) => {
  event.target.closest(".tree-item")?.classList.remove("dragging");
  document.querySelectorAll(".tree-item.drop-target").forEach((item) => item.classList.remove("drop-target"));
});

els.processTree.addEventListener("dragover", (event) => {
  const item = event.target.closest(".tree-item");
  if (!item) return;
  event.preventDefault();
  item.classList.add("drop-target");
});

els.processTree.addEventListener("dragleave", (event) => {
  event.target.closest(".tree-item")?.classList.remove("drop-target");
});

els.processTree.addEventListener("drop", (event) => {
  const target = event.target.closest(".tree-item");
  const draggedId = event.dataTransfer.getData("text/plain");
  if (!target || !draggedId || draggedId === target.dataset.id) return;
  event.preventDefault();
  moveTreeNode(draggedId, target.dataset.id, target.dataset.type === "folder" ? "inside" : "after");
  renderTree();
  renderProcess();
});

document.querySelector("#addProcessBtn").addEventListener("click", () => {
  if (!activeOrganization()) {
    renderAuthState();
    return;
  }
  const id = `process_${Date.now()}`;
  const process = {
    id,
    name: "Novy proces",
    type: "process",
    owner: currentUser()?.name || "Owner",
    status: "Navrh",
    revision: new Date().toISOString().slice(0, 10),
    purpose: "",
    risks: "",
    iso: [],
    history: ["Vytvoreny novy proces."],
    approvals: [],
    attachments: [],
    bpmnXml: createEmptyBpmnXml(id, "Novy proces"),
    diagram: []
  };
  state.library = [
    ...state.library,
    process
  ];
  state.activeId = id;
  state.selectedTreeId = id;
  persist();
  renderTree();
  renderProcess();
});

els.addFolderBtn.addEventListener("click", () => {
  if (!activeOrganization()) {
    renderAuthState();
    return;
  }
  state.library = [
    ...state.library,
    {
      id: `folder_${Date.now()}`,
      name: "Nova skupina",
      type: "folder",
      children: []
    }
  ];
  persist();
  renderTree();
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  persist();
  document.querySelector("#saveBtn").textContent = "Ulozene";
  setTimeout(() => document.querySelector("#saveBtn").textContent = "Ulozit", 1200);
});

document.querySelector("#exportBtn").addEventListener("click", async () => {
  const process = findProcess(state.activeId);
  if (!process) return;
  const xml = bpmnModeler ? (await bpmnModeler.saveXML({ format: true })).xml : toBpmnXml(process);
  updateProcess(process.id, { bpmnXml: xml });
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(xml).catch(() => {});
  }
  const blob = new Blob([xml], { type: "application/xml" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${process.id}.bpmn`;
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelector("#camundaBtn").addEventListener("click", () => {
  const process = findProcess(state.activeId);
  if (!process) return;
  els.camundaPreview.textContent = `Pripraveny Camunda 7 deployment pre ${process.name}. Server pouzije endpoint z CAMUNDA7_BASE_URL a vola REST API /deployment/create.`;
  els.dialog.showModal();
});

document.querySelector("#mockDeployBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  const process = findProcess(state.activeId);
  if (!process) return;
  const bpmnXml = bpmnModeler ? (await bpmnModeler.saveXML({ format: true })).xml : process.bpmnXml || toBpmnXml(process);
  const payload = {
    processId: process.id,
    deploymentName: document.querySelector("#camundaDeployment").value,
    resourceName: `${process.id}.bpmn`,
    tenantId: document.querySelector("#camundaTenant").value.trim(),
    deployChangedOnly: true,
    bpmnXml
  };
  try {
    const response = await fetch("/api/camunda7/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Camunda 7 deployment zlyhal");
    updateProcess(process.id, {
      bpmnXml,
      history: [`${new Date().toISOString().slice(0, 10)}: BPMN deploy do Camunda 7 (${result.id}).`, ...process.history]
    });
    els.camundaPreview.textContent = `Deployment uspesny: ${result.id}`;
  } catch (error) {
    els.camundaPreview.textContent = `Deployment sa nepodaril: ${error.message}`;
  }
});

document.querySelector("#exportPdfBtn").addEventListener("click", () => {
  const process = findProcess(state.activeId);
  if (!process) return;
  downloadDocument(process, "pdf");
});

document.querySelector("#exportDocxBtn").addEventListener("click", () => {
  const process = findProcess(state.activeId);
  if (!process) return;
  downloadDocument(process, "docx");
});

document.querySelector("#exportHtmlBtn").addEventListener("click", async () => {
  const process = findProcess(state.activeId);
  if (!process) return;
  await downloadProcessHtml(process);
});

async function downloadDocument(process, format) {
  try {
    const response = await fetch(`/api/processes/${process.id}/export.${format}`);
    if (!response.ok) throw new Error("Export API is not available");
    const blob = await response.blob();
    downloadBlob(`${process.id}-documentacia.${format}`, blob);
  } catch (error) {
    const fallback = buildProcessDocument(process, format.toUpperCase());
    downloadTextFile(`${process.id}-documentacia.${format}.txt`, fallback);
  }
}

async function downloadProcessHtml(process) {
  const svg = await getDiagramSvg(process);
  const html = buildProcessHtmlDocument(process, svg);
  downloadBlob(`${process.id}-documentacia-s-obrazkom.html`, new Blob([html], { type: "text/html" }));
}

function escapeHtml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function buildProcessHtmlDocument(process, svg) {
  const iso = (process.iso || []).map((item) => `<li>${escapeHtml(item.standard)} ${escapeHtml(item.clause)}: ${escapeHtml(item.evidence)}</li>`).join("");
  const attachments = (process.attachments || []).map((item) => `<li>${escapeHtml(item.name)} (${escapeHtml(item.type)})</li>`).join("");
  const revisions = (process.revisions || []).map((item) => `<li>${escapeHtml(item.date)} - ${escapeHtml(item.name)}</li>`).join("");
  return `<!doctype html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(process.name)} - dokumentacia</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #18212f; }
    h1 { margin-bottom: 4px; }
    section { margin-top: 24px; }
    .diagram { border: 1px solid #d8dee8; padding: 16px; overflow: auto; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .meta div { border: 1px solid #d8dee8; padding: 12px; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(process.name)}</h1>
  <p>Procesna dokumentacia s obrazkom procesu.</p>
  <section class="meta">
    <div><strong>Vlastnik</strong><br>${escapeHtml(process.owner || "")}</div>
    <div><strong>Stav</strong><br>${escapeHtml(process.status || "")}</div>
    <div><strong>Revizia</strong><br>${escapeHtml(process.revision || "")}</div>
    <div><strong>Export</strong><br>${new Date().toISOString().slice(0, 10)}</div>
  </section>
  <section>
    <h2>Diagram</h2>
    <div class="diagram">${svg || "<p>Diagram nie je dostupny.</p>"}</div>
  </section>
  <section><h2>Ucel procesu</h2><p>${escapeHtml(process.purpose || "")}</p></section>
  <section><h2>Rizika a kontrolne body</h2><p>${escapeHtml(process.risks || "")}</p></section>
  <section><h2>ISO vazby</h2><ul>${iso}</ul></section>
  <section><h2>Prilohy</h2><ul>${attachments}</ul></section>
  <section><h2>Revizie</h2><ul>${revisions}</ul></section>
</body>
</html>`;
}

function buildProcessDocument(process, format) {
  const approvals = (process.approvals || []).map((approval) => {
    const user = state.users.find((item) => item.id === approval.userId);
    return `- ${user ? user.name : approval.userId}: ${approval.state} (${approval.date}) ${approval.note}`;
  }).join("\n");
  const iso = process.iso.map((item) => `- ${item.standard} ${item.clause}: ${item.evidence}`).join("\n");
  const attachments = (process.attachments || []).map((item) => `- ${item.name} (${item.type})`).join("\n");
  return `${format} EXPORT - ${process.name}

Vlastnik: ${process.owner}
Stav: ${process.status}
Revizia: ${process.revision}

Ucel:
${process.purpose}

Rizika a kontrolne body:
${process.risks}

ISO vazby:
${iso}

Schvalovanie:
${approvals}

Prilohy:
${attachments}
`;
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: "text/plain" });
  downloadBlob(fileName, blob);
}

function downloadBlob(fileName, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

renderTree();
renderProcess();
