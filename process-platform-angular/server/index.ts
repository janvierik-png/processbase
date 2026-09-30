import 'dotenv/config';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import cors from 'cors';
import express from 'express';
import {
  InvitationStatus,
  OrganizationRole,
  ProcessNodeType,
  ProcessStatus,
  ApprovalStatus,
  AuthTokenType,
  JobDescriptionStatus,
  DocumentStatus,
  FeedbackKind,
  FeedbackStatus,
  Prisma,
  RaciRole,
  ResponsibilityRole
} from '../generated/prisma/client';
import { acceptRequestId, logError } from './log';
import { AI_MODEL, AI_PROVIDER_LABEL, AiContent, AiError, IMPORT_TOOL, PLATFORM_AI_KEY, PROCESS_DRAFT_TOOL, callAiTool, importPrompt, processDraftPrompt } from './ai';
import { ExtractError, ExtractedDocument, blocksToText, extractDocument } from './doc-extract';
import { ZipError } from './zip';
import { Citation, ImportCandidates, candidatesFromAi, candidatesFromDocument } from './import-candidates';
import { ProcessDraft, draftSteps, foldName, sanitizeDraft } from '../src/app/shared/process-draft/draft';
import { parseProcessText } from '../src/app/shared/process-draft/text-parser';
import { draftToBpmnXml } from '../src/app/shared/process-draft/bpmn-layout';
import { prisma } from './prisma';
import { SECRETS_FILE, secret } from './secrets';
import { APP_URL, emailDeliveryStats, queueEmail } from './mailer';
import {
  fileKey,
  isFileKey,
  openStored,
  parseDataUrl,
  removeStored,
  storeBuffer,
  storedSize,
  storeStream
} from './file-storage';

const app = express();
// za reverznou proxy (nginx, Angular dev proxy) ber IP klienta z X-Forwarded-For,
// ale len ak prisla z lokalnej alebo sukromnej siete — z internetu by sa dala podvrhnut
app.set('trust proxy', process.env['TRUST_PROXY'] ?? 'loopback, linklocal, uniquelocal');
const port = Number(process.env['API_PORT'] ?? 3000);
const host = process.env['API_HOST'] ?? '0.0.0.0';

app.use(cors({ origin: true }));

/**
 * Ak bezi backoffice na vlastnom porte (BACKOFFICE_PORT), API operatora sa na
 * verejnom porte neponuka vobec — utocnik z internetu nema ani prihlasovaci formular.
 */
const BACKOFFICE_PORT = Number(process.env['BACKOFFICE_PORT'] ?? 0) || null;
app.use('/api/backoffice', (request, response, next) => {
  if (BACKOFFICE_PORT && request.socket.localPort !== BACKOFFICE_PORT) {
    response.status(404).json({ message: 'Not found' });
    return;
  }
  next();
});
/**
 * Maximalna velkost nahravaneho suboru. Subor sa posiela ako binarny stream (#10)
 * a limit sa strazi pocas zapisu na disk, nie cez express.json.
 * Rovnaka hodnota je aj na klientovi v src/app/core/utils/upload-limits.ts.
 */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Bezpecnostne hlavicky (#6). Rucne namiesto helmet, aby pribudnutie zavislosti
 * nevynutilo prestavbu node_modules volume v Dockeri.
 */
app.use((request, response, next) => {
  // #32 — ID poziadavky spaja chybu v logu s tym, co nahlasi pouzivatel
  const requestId = acceptRequestId(request.get('x-request-id'), randomUUID);
  response.locals['requestId'] = requestId;
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  response.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  response.removeHeader('X-Powered-By');
  next();
});

/**
 * Technicke metriky sluzby (#18) — v pamati procesu, od posledneho startu.
 * Incident = odpoved 5xx; zapisuje sa len metoda, routa, stav a typ chyby,
 * nikdy obsah poziadavky ani odpovede (moze obsahovat udaje zakaznika).
 */
const serviceMetrics = { startedAt: new Date(), requests: 0, clientErrors: 0, serverErrors: 0 };
type Incident = { at: string; method: string; route: string; status: number; error: string | null; requestId: string | null };
const incidents: Incident[] = [];
const MAX_INCIDENTS = 50;

function routeLabel(request: express.Request): string {
  if (request.route?.path) return `${request.baseUrl ?? ''}${request.route.path}`;
  // bez zhody na routu — ID v ceste nahradit, aby sa do metrik nedostali identifikatory
  return request.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

app.use((request, response, next) => {
  if (!request.path.startsWith('/api/')) {
    next();
    return;
  }
  serviceMetrics.requests++;
  response.on('finish', () => {
    if (response.statusCode >= 500) {
      serviceMetrics.serverErrors++;
      incidents.unshift({
        at: new Date().toISOString(),
        method: request.method,
        route: routeLabel(request),
        status: response.statusCode,
        error: (response.locals['errorName'] as string | undefined) ?? null,
        requestId: (response.locals['requestId'] as string | undefined) ?? null
      });
      incidents.length = Math.min(incidents.length, MAX_INCIDENTS);
    } else if (response.statusCode >= 400) {
      serviceMetrics.clientErrors++;
    }
  });
  next();
});

/**
 * Jednoduchy limit pokusov (#6). Drzi sa v pamati procesu — pre viac instancii
 * by bolo treba zdielane uloziste (Redis a pod.).
 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function rateLimitLogin(request: express.Request, response: express.Response, next: express.NextFunction): void {
  // pocitadlo pre kazdy tok (aplikacia, backoffice, pozvanka) + IP + prihlasovacie meno.
  // Len IP by za proxy (vsetci maju rovnaku adresu) umoznila jednym utocnikom
  // zablokovat prihlasenie vsetkym; takto sa brzdi skusanie hesiel ku konkretnemu uctu.
  const login = String(request.body?.email ?? request.body?.username ?? '').trim().toLowerCase();
  const key = `${request.path}|${request.ip ?? 'neznamy'}|${login}`;
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    next();
    return;
  }

  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    const zostava = Math.ceil((entry.resetAt - now) / 60000);
    response.status(429).json({
      message: `Prilis vela pokusov o prihlasenie. Skus znova o ${zostava} min.`
    });
    return;
  }
  next();
}

// obcasne upratanie starych zaznamov, nech mapa nerastie donekonecna
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt < now) loginAttempts.delete(key);
  }
}, LOGIN_WINDOW_MS).unref();

// subory uz chodia ako binarny stream (#10); JSON nesie len XML diagramov a texty
app.use(express.json({ limit: '25mb' }));

/**
 * Verejne endpointy platformy (#2). Vsetko ostatne pod /api/ vyzaduje prihlasenie.
 * Backoffice ma vlastny guard nizsie.
 */
const PUBLIC_API_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/register$/ },
  { method: 'POST', pattern: /^\/api\/login$/ },
  { method: 'GET', pattern: /^\/api\/check\/(email|org-name)$/ },
  { method: 'GET', pattern: /^\/api\/invitations\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/invitations\/[^/]+\/accept$/ },
  { method: 'GET', pattern: /^\/api\/translations$/ },
  { method: 'GET', pattern: /^\/api\/iso-norms$/ },
  // #20 — odkazy z emailov a obnova hesla (bez prihlasenia)
  { method: 'POST', pattern: /^\/api\/auth\/(verify-email|forgot-password|reset-password)$/ }
];

function isPublicRoute(method: string, path: string): boolean {
  if (path.startsWith('/api/backoffice')) return true; // ma vlastny guard
  return PUBLIC_API_ROUTES.some((route) => route.method === method && route.pattern.test(path));
}

app.use('/api', async (request, response, next) => {
  try {
    const fullPath = request.baseUrl + request.path;
    if (isPublicRoute(request.method, fullPath)) {
      next();
      return;
    }
    const context = await resolveSession(request);
    if (!context) {
      response.status(401).json({ message: 'Vyzaduje sa prihlasenie.' });
      return;
    }
    (request as any).auth = context;
    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Opravnenia podla roly vo firme (B7). Rovnaka matica, akou klient popisuje
 * roly (src/app/core/data/default-data.ts); vlastnik smie vsetko.
 * Citat moze kazdy clen firmy — pravidla su len pre zapis.
 */
type Permission = 'organization:write' | 'user:invite' | 'process:write' | 'iso:write' | 'approval:approve';

const ROLE_PERMISSIONS: Record<OrganizationRole, Permission[]> = {
  [OrganizationRole.OWNER]: ['organization:write', 'user:invite', 'process:write', 'iso:write', 'approval:approve'],
  [OrganizationRole.ADMIN]: ['organization:write', 'user:invite', 'process:write', 'iso:write', 'approval:approve'],
  [OrganizationRole.MANAGER]: ['process:write', 'iso:write', 'approval:approve'], // manazer kvality
  [OrganizationRole.MODELER]: ['approval:approve'], // schvalovatel — cita a schvaluje
  [OrganizationRole.AUDITOR]: ['iso:write'], // ISO auditor
  [OrganizationRole.VIEWER]: []
};

function hasPermission(request: express.Request, permission: Permission): boolean {
  return ROLE_PERMISSIONS[auth(request).role]?.includes(permission) ?? false;
}

/** Uprava procesu, ktora meni len ISO vazby — smie ju aj ISO auditor. */
function isIsoOnlyPatch(body: unknown): boolean {
  const keys = Object.keys((body ?? {}) as object);
  return keys.length > 0 && keys.every((key) => key === 'iso' || key === 'changeDescription');
}

type PermissionRule = {
  methods: string[];
  pattern: RegExp;
  /** staci jedno z opravneni */
  anyOf: Permission[] | ((request: express.Request) => Permission[]);
};

const PERMISSION_RULES: PermissionRule[] = [
  // procesy, dokumenty, verzie, nasadenie
  { methods: ['POST'], pattern: /^\/api\/organizations\/[^/]+\/processes(\/import-bpmn)?$/, anyOf: ['process:write'] },
  {
    methods: ['PATCH'],
    pattern: /^\/api\/processes\/[^/]+$/,
    anyOf: (request) => (isIsoOnlyPatch(request.body) ? ['process:write', 'iso:write'] : ['process:write'])
  },
  { methods: ['DELETE'], pattern: /^\/api\/processes\/[^/]+$/, anyOf: ['process:write'] },
  { methods: ['PUT'], pattern: /^\/api\/processes\/[^/]+\/activities$/, anyOf: ['process:write'] },
  // #37 — schvalovanie: navrh odosiela editor, rozhoduje schvalovatel (nie ten isty clovek — kontrola v handleri)
  { methods: ['POST'], pattern: /^\/api\/processes\/[^/]+\/approval-requests$/, anyOf: ['process:write'] },
  { methods: ['POST'], pattern: /^\/api\/approval-requests\/[^/]+\/(approve|reject)$/, anyOf: ['approval:approve'] },
  { methods: ['POST'], pattern: /^\/api\/approval-requests\/[^/]+\/withdraw$/, anyOf: ['process:write'] },
  { methods: ['POST'], pattern: /^\/api\/processes\/[^/]+\/(documents|revisions|camunda7\/deploy|publish)$/, anyOf: ['process:write'] },
  { methods: ['POST'], pattern: /^\/api\/camunda7\/deploy$/, anyOf: ['process:write'] },
  { methods: ['POST'], pattern: /^\/api\/processes\/[^/]+\/iso-detect$/, anyOf: ['process:write', 'iso:write'] },
  { methods: ['PATCH', 'DELETE'], pattern: /^\/api\/documents\/[^/]+$/, anyOf: ['process:write'] },
  // #31 — nova verzia riadeneho dokumentu
  { methods: ['POST'], pattern: /^\/api\/documents\/[^/]+\/versions$/, anyOf: ['process:write'] },
  // #40 — neaplikovatelne polozky pripravenosti: navrhne editor alebo ISO auditor, schvali iny schvalovatel
  { methods: ['POST'], pattern: /^\/api\/processes\/[^/]+\/readiness-exceptions$/, anyOf: ['process:write', 'iso:write'] },
  { methods: ['DELETE'], pattern: /^\/api\/readiness-exceptions\/[^/]+$/, anyOf: ['process:write', 'iso:write'] },
  { methods: ['POST'], pattern: /^\/api\/readiness-exceptions\/[^/]+\/approve$/, anyOf: ['approval:approve'] },

  // firma, pozvanky (aj ich citanie — obsahuju tokeny), nastavenia
  { methods: ['PATCH'], pattern: /^\/api\/organizations\/[^/]+$/, anyOf: ['organization:write'] },
  { methods: ['GET', 'POST'], pattern: /^\/api\/organizations\/[^/]+\/invitations$/, anyOf: ['user:invite'] },
  { methods: ['POST'], pattern: /^\/api\/organizations\/[^/]+\/settings\/translation$/, anyOf: ['organization:write'] },

  // #42/#41 — navrh z textu a import: rozbor smie editor aj sprava firmy; co z toho vytvori, overi handler
  { methods: ['POST'], pattern: /^\/api\/process-drafts\/from-text$/, anyOf: ['process:write'] },
  { methods: ['POST'], pattern: /^\/api\/import\/(analyze|apply)$/, anyOf: ['process:write', 'organization:write'] },
  { methods: ['POST'], pattern: /^\/api\/organizations\/[^/]+\/settings\/ai$/, anyOf: ['organization:write'] },

  // #45 — vlastne polia procesu definuje sprava firmy; hodnoty pri procese zapisuje editor (PATCH procesu)
  { methods: ['POST'], pattern: /^\/api\/organizations\/[^/]+\/process-fields$/, anyOf: ['organization:write'] },
  { methods: ['PUT'], pattern: /^\/api\/organizations\/[^/]+\/process-fields\/order$/, anyOf: ['organization:write'] },
  { methods: ['PATCH', 'DELETE'], pattern: /^\/api\/process-fields\/[^/]+$/, anyOf: ['organization:write'] },

  // #43 — IT systemy: zaradit a upravit smie aj editor procesov, vyradit a zmazat len sprava firmy
  { methods: ['POST'], pattern: /^\/api\/organizations\/[^/]+\/systems$/, anyOf: ['organization:write', 'process:write'] },
  { methods: ['PATCH'], pattern: /^\/api\/systems\/[^/]+$/, anyOf: ['organization:write', 'process:write'] },
  { methods: ['DELETE'], pattern: /^\/api\/systems\/[^/]+$/, anyOf: ['organization:write'] },
  { methods: ['POST'], pattern: /^\/api\/systems\/[^/]+\/(archive|restore)$/, anyOf: ['organization:write'] },

  // organizacna struktura (#12–#16)
  { methods: ['POST'], pattern: /^\/api\/organizations\/[^/]+\/(units|positions|people|job-profiles)$/, anyOf: ['organization:write'] },
  {
    methods: ['PATCH', 'DELETE'],
    pattern: /^\/api\/(units|positions|people|assignments|job-profiles|job-description-versions)\/[^/]+$/,
    anyOf: ['organization:write']
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/(people\/[^/]+\/leave|positions\/[^/]+\/(assignments|archive|restore)|job-profiles\/[^/]+\/versions|job-description-versions\/[^/]+\/publish)$/,
    anyOf: ['organization:write']
  }
];

/** Zapis bez pravidla, ktory smie kazdy prihlaseny (vlastna relacia a ucet). */
const SELF_SERVICE_WRITES = [
  /^\/api\/logout$/,
  /^\/api\/auth\/resend-verification$/,
  // #36 — podnet k procesu smie poslat kazdy clen firmy; o vybaveni rozhoduje handler (vlastnik miesta alebo editor)
  /^\/api\/processes\/[^/]+\/feedback$/,
  /^\/api\/feedback\/[^/]+\/decide$/,
  // #38 — vlastne upozornenia (handler meni len upozornenia prihlaseneho)
  /^\/api\/me\/notifications\/read$/,
  // #40 — zaznam o vykonani smie pridat aj vykonavatel procesu; handler overi vztah k procesu
  /^\/api\/processes\/[^/]+\/evidence$/
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.use('/api', (request, response, next) => {
  const context = (request as any).auth as AuthContext | undefined;
  if (!context) {
    next(); // verejne routy a backoffice (vlastny guard)
    return;
  }
  const fullPath = request.baseUrl + request.path;
  const rule = PERMISSION_RULES.find((item) => item.methods.includes(request.method) && item.pattern.test(fullPath));

  if (!rule) {
    // fail-closed: novy zapisujuci endpoint bez pravidla sa odmietne, kym sa nedoplni
    if (WRITE_METHODS.has(request.method) && !SELF_SERVICE_WRITES.some((pattern) => pattern.test(fullPath))) {
      console.error(`[opravnenia] req=${response.locals['requestId']} chyba pravidlo pre ${request.method} ${routeLabel(request)}`);
      response.status(403).json({ message: 'Na tuto akciu nemate opravnenie.' });
      return;
    }
    next();
    return;
  }

  const anyOf = typeof rule.anyOf === 'function' ? rule.anyOf(request) : rule.anyOf;
  if (!anyOf.some((permission) => hasPermission(request, permission))) {
    response.status(403).json({ message: 'Na tuto akciu nemate opravnenie.' });
    return;
  }
  next();
});

type Responsibility = { id: string; name: string; role: string; holders: string[]; vacant: boolean; archived?: boolean };

type ProcessTreeNode = {
  id: string;
  name: string;
  /** #30 — kod procesu, prazdny ak nie je zadany */
  code?: string;
  type: 'folder' | 'process';
  parentId?: string | null;
  children?: ProcessTreeNode[];
  owner?: string;
  ownerPosition?: Responsibility | null;
  vacantResponsibilities?: Responsibility[];
  status?: string;
  publication?: Publication;
  trigger?: string;
  outcome?: string;
  activities?: Array<{ id: string; title: string; description: string; systemIds?: string[]; raci?: ReturnType<typeof mapStepResponsibility>[] }>;
  readiness?: ReadinessItem[];
  revision?: string;
  purpose?: string;
  risks?: string;
  descriptionText?: string;
  relatedProcessIds?: string[];
  inputs?: string[];
  outputs?: string[];
  upstreamProcessIds?: string[];
  downstreamProcessIds?: string[];
  successMeasure?: string;
  resources?: string;
  opportunities?: string;
  evidenceRequirements?: string[];
  systemIds?: string[];
  customFields?: Record<string, CustomFieldValue>;
  positionIds?: string[];
  positions?: Responsibility[];
  isoSuggestions?: unknown;
  translations?: unknown;
  bpmnXml?: string;
  diagramType?: string;
  flowchartXml?: string;
  diagramSvg?: string;
  iso?: Array<{ standard: string; clause: string; evidence: string }>;
  revisions?: Array<{ id: string; name: string; date: string; bpmnXml: string; diagramSvg?: string }>;
  attachments?: unknown[];
  approvals?: unknown[];
  history?: string[];
};

function mapAttachment(attachment: any, versions?: { count: number; next: any | null }) {
  return {
    id: attachment.id,
    name: attachment.fileName,
    // #31 — verzia riadeneho dokumentu
    documentId: attachment.documentId ?? attachment.id,
    version: attachment.version ?? 1,
    effectiveFrom: day(attachment.effectiveFrom ?? null),
    changeNote: attachment.changeNote ?? null,
    versionCount: versions?.count ?? 1,
    nextVersion: versions?.next ? { id: versions.next.id, version: versions.next.version, effectiveFrom: day(versions.next.effectiveFrom) } : null,
    type: attachment.mimeType,
    owner: attachment.uploadedBy?.name ?? '',
    size: attachment.sizeBytes,
    // den nahratia v case firmy (UTC by po polnoci ukazal vcerajsok)
    createdAt: new Intl.DateTimeFormat('sv-SE', { timeZone: BUSINESS_TIMEZONE }).format(attachment.createdAt),
    // obsah suboru sa vo vypisoch neposiela — na stiahnutie sluzi /api/documents/:id/download
    processId: attachment.processNodeId ?? undefined,
    processName: attachment.processNode?.name ?? undefined,
    positionIds: (attachment.positions ?? []).map((item: any) => item.positionId),
    positions: (attachment.positions ?? []).map((item: any) => ({
      id: item.position?.id ?? item.positionId,
      name: item.position?.name ?? ''
    }))
  };
}

// len stlpce, ktore mapAttachment potrebuje — plny proces by tahal BPMN XML
// ku kazdemu dokumentu a plny pouzivatel aj hash hesla
// --- #31 DOC-02 verzie riadenych dokumentov ---

/** Co treba o verzii dokumentu vediet pre snapshot procesu. */
const DOCUMENT_VERSION_SELECT = { id: true, fileName: true, documentId: true, version: true, effectiveFrom: true } as const;

type DocumentVersionLike = { id: string; documentId?: string | null; version?: number | null; effectiveFrom?: Date | null };

/** Z verzii dokumentov ta, ktora v dany den plati: najvyssia verzia s ucinnostou do toho dna. */
function currentDocumentVersions<T extends DocumentVersionLike>(attachments: T[], at = today()): T[] {
  const byDocument = new Map<string, T>();
  for (const item of attachments) {
    if (item.effectiveFrom && item.effectiveFrom > at) continue;
    const key = item.documentId ?? item.id;
    const best = byDocument.get(key);
    if (!best || (item.version ?? 1) > (best.version ?? 1)) byDocument.set(key, item);
  }
  return [...byDocument.values()];
}

const ATTACHMENT_INCLUDE = {
  processNode: { select: { name: true } },
  uploadedBy: { select: { name: true } },
  positions: { include: { position: { select: { id: true, name: true } } } }
};

/**
 * Zoznam dokumentov: za kazdy dokument jeho platna verzia (ak este ziadna
 * neplati, naplanovana), pocet verzii a najblizsia naplanovana verzia.
 */
async function listCurrentDocuments(where: Record<string, unknown>) {
  const attachments = await prisma.attachment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: ATTACHMENT_INCLUDE,
    omit: { storagePath: true }
  });
  const now = today();
  const groups = new Map<string, typeof attachments>();
  for (const item of attachments) {
    const key = item.documentId ?? item.id;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((versions) => {
    const current = currentDocumentVersions(versions, now)[0] ?? null;
    const future = versions
      .filter((item) => item.effectiveFrom && item.effectiveFrom > now && (!current || item.version > current.version))
      .sort((a, b) => a.version - b.version);
    return mapAttachment(current ?? future[0], { count: versions.length, next: current ? future[0] ?? null : future[1] ?? null });
  });
}

function emptyBpmnXml(id: string, name: string): string {
  const escapedName = escapeXml(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_${id}" targetNamespace="https://processbase.local/bpmn">
  <bpmn:process id="Process_${id}" name="${escapedName}" isExecutable="true" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_${id}">
    <bpmndi:BPMNPlane id="BPMNPlane_${id}" bpmnElement="Process_${id}" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    const replacements: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;'
    };
    return replacements[char] ?? char;
  });
}

async function ensureOrganization(organizationId: string) {
  const existing = await prisma.organization.findFirst({
    where: {
      OR: [
        { id: organizationId },
        { slug: organizationId }
      ]
    }
  });
  if (existing) return existing;

  const slugBase = organizationId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organizacia';
  return prisma.organization.create({
    data: {
      id: organizationId,
      name: 'Organizacia',
      slug: `${slugBase}-${Date.now()}`
    }
  });
}

/**
 * Popis miest pre audit log: "Veduci kvality (Jan Novak)". Zapisuje sa, kto
 * miesto zastaval V CASE ZMENY — historia tak neskor neukaze noveho cloveka.
 */
async function describePositions(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const positions = await prisma.orgPosition.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, assignments: { where: activeOn(today()), select: { person: { select: { name: true } } } } }
  });
  const byId = new Map(positions.map((position) => [position.id, position]));
  return ids.map((id) => {
    const position = byId.get(id);
    if (!position) return id;
    const holders = position.assignments.map((assignment) => assignment.person.name);
    return `${position.name} (${holders.length ? holders.join(', ') : 'neobsadene'})`;
  });
}

/** Zodpovedne miesto procesu s aktualnymi drzitelmi (#15). */
function mapResponsibility(link: any) {
  const holders = (link.position?.assignments ?? []).map((assignment: any) => assignment.person?.name).filter(Boolean);
  return {
    id: link.position?.id ?? link.positionId,
    name: link.position?.name ?? '',
    role: link.role ?? ResponsibilityRole.PERFORMER,
    holders,
    vacant: holders.length === 0,
    // #43 — miesto bolo archivovane: vazba ostala, treba urcit nove miesto
    archived: Boolean(link.position?.archivedAt)
  };
}

function mapNode(node: any): ProcessTreeNode {
  const responsibilities = (node.positions ?? []).map(mapResponsibility);
  const ownerPosition = responsibilities.find((item: any) => item.role === ResponsibilityRole.OWNER) ?? null;
  const performers = responsibilities.filter((item: any) => item.role === ResponsibilityRole.PERFORMER);
  return {
    id: node.id,
    name: node.name,
    code: node.code ?? '',
    type: node.type === ProcessNodeType.GROUP ? 'folder' : 'process',
    parentId: node.parentId ?? null,
    // vlastnik = kto DNES zastava miesto vlastnika; bez miesta povodny vlastnik-ucet
    owner: ownerPosition ? ownerPosition.holders.join(', ') : (node.owner?.name ?? ''),
    ownerPosition,
    // neobsadena zodpovednost musi byt vidiet (#14, #15)
    vacantResponsibilities: responsibilities.filter((item: any) => item.vacant),
    // #27 — stav sa uz nenastavuje rucne, vyplyva z publikovanych verzii
    ...publicationState(node),
    revision: node.revisions?.[0]?.createdAt?.toISOString().slice(0, 10) ?? node.updatedAt?.toISOString().slice(0, 10),
    purpose: node.description ?? '',
    // #28 — rychly proces: spustac, vysledok, kroky a co chyba na publikovanie
    trigger: node.trigger ?? '',
    outcome: node.outcome ?? '',
    activities: (node.activities ?? []).map((activity: any) => ({
      id: activity.id,
      title: activity.title,
      description: activity.description ?? '',
      systemIds: activity.systemIds ?? [],
      // #29 — RACI kroku s ludmi, ktori miesta zastavaju
      raci: (activity.responsibilities ?? [])
        .map(mapStepResponsibility)
        .sort((a: any, b: any) => RACI_ORDER.indexOf(a.role) - RACI_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, 'sk'))
    })),
    readiness: node.type === ProcessNodeType.GROUP ? [] : publishReadiness(node),
    descriptionText: node.descriptionText ?? '',
    relatedProcessIds: node.relatedProcessIds ?? [],
    // #40 — riadeny proces a profil Kvalita a audit
    inputs: node.inputs ?? [],
    outputs: node.outputs ?? [],
    upstreamProcessIds: node.upstreamProcessIds ?? [],
    downstreamProcessIds: node.downstreamProcessIds ?? [],
    successMeasure: node.successMeasure ?? '',
    resources: node.resources ?? '',
    risks: node.risks ?? '',
    opportunities: node.opportunities ?? '',
    evidenceRequirements: node.evidenceRequirements ?? [],
    // #43 — IT systemy procesu (nazvy dohlada klient zo zoznamu systemov firmy)
    systemIds: node.systemIds ?? [],
    // #45 — vlastne polia firmy (nazvy poli su v nastaveniach firmy)
    customFields: customFieldValues(node.customFields),
    positionIds: performers.map((item: any) => item.id),
    positions: performers,
    isoSuggestions: node.isoSuggestions ?? [],
    translations: node.translations ?? null,
    bpmnXml: node.bpmnXml ?? undefined,
    diagramType: node.diagramType ?? 'NONE',
    flowchartXml: node.flowchartXml ?? undefined,
    iso: (node.isoLinks ?? []).map((link: string) => {
      const [standard, clause = ''] = link.split(':');
      return { standard, clause, evidence: '' };
    }),
    revisions: (node.revisions ?? []).map((revision: any) => ({
      id: revision.id,
      name: revision.name,
      date: revision.createdAt.toISOString().slice(0, 10),
      bpmnXml: revision.bpmnXml,
      diagramSvg: revision.diagramSvg ?? undefined
    })),
    attachments: [],
    approvals: [],
    history: [],
    children: (node.children ?? []).sort((a: any, b: any) => a.sortOrder - b.sortOrder).map(mapNode)
  };
}

function buildProcessTree(nodes: any[]): ProcessTreeNode[] {
  const mapped = new Map<string, any>();
  const roots: any[] = [];

  for (const node of nodes) {
    mapped.set(node.id, { ...node, children: [] });
  }

  for (const node of mapped.values()) {
    if (node.parentId && mapped.has(node.parentId)) {
      mapped.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots.sort((a, b) => a.sortOrder - b.sortOrder).map(mapNode);
}

function isoLinksFromBody(iso: unknown): string[] {
  if (!Array.isArray(iso)) return [];
  return iso.map((item: any) => `${item.standard ?? ''}:${item.clause ?? ''}`.replace(/:$/, '')).filter(Boolean);
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/organizations/:organizationId/processes', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const organization = await ensureOrganization(organizationId);
    const nodes = await prisma.processNode.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        owner: { select: { name: true } },
        revisions: { orderBy: { createdAt: 'desc' } },
        positions: responsibilityInclude(),
        ...publicationInclude()
      }
    });
    response.json(buildProcessTree(nodes));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/processes', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const organization = await ensureOrganization(organizationId);
    const type = request.body.type === 'folder' ? ProcessNodeType.GROUP : ProcessNodeType.PROCESS;
    const name = request.body.name ?? (type === ProcessNodeType.GROUP ? 'Nova skupina' : 'Novy proces');
    const [parentId = null] = await assertOwnedIds('processNode', organization.id, [request.body.parentId]);
    const code = type === ProcessNodeType.PROCESS ? normalizeProcessCode(request.body.code) : null;
    if (code) await assertCodeFree(organization.id, '', code);
    const processNode = await prisma.processNode.create({
      data: {
        organizationId: organization.id,
        parentId,
        type,
        name,
        code,
        description: request.body.purpose ?? null,
        // #27 — novy proces je vzdy navrh; platnym sa stane az publikovanim
        status: ProcessStatus.DRAFT,
        sortOrder: Number(request.body.sortOrder ?? 0),
        bpmnXml: type === ProcessNodeType.PROCESS ? emptyBpmnXml(`process_${Date.now()}`, name) : null,
        isoLinks: isoLinksFromBody(request.body.iso)
      },
      include: { owner: true, revisions: true, children: true }
    });
    response.status(201).json(mapNode(processNode));
  } catch (error) {
    next(error);
  }
});

const MAX_IMPORT_BPMN_BYTES = 10 * 1024 * 1024;

/** Rovnaka kontrola ako v modeleri — server ju robi znova, klientovi neveri (#39). */
function checkBpmnXml(xml: string): string | null {
  if (Buffer.byteLength(xml, 'utf8') > MAX_IMPORT_BPMN_BYTES) return 'BPMN subor je vacsi ako 10 MB.';
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return 'BPMN subor obsahuje DTD alebo entity — z bezpecnostnych dovodov sa neprijima.';
  if (!/<([\w-]+:)?definitions[\s>]/.test(xml) || !xml.includes('http://www.omg.org/spec/BPMN/20100524/MODEL')) {
    return 'Subor nie je BPMN 2.0 (chyba koren definitions alebo menny priestor BPMN).';
  }
  return null;
}

/**
 * LINK-01 (#39): diagram z bezplatneho modelera sa stane NAVRHOM procesu.
 * Povodne XML sa ulozi bez zmeny (ziadna konverzia na kroky, ziadne
 * „zjednodusenie“). Nazov, ucel a vlastnik su povinne; nic sa nepublikuje.
 */
app.post('/api/organizations/:organizationId/processes/import-bpmn', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const body = request.body ?? {};
    const bpmnXml = typeof body.bpmnXml === 'string' ? body.bpmnXml : '';
    const problem = checkBpmnXml(bpmnXml);
    if (problem) throw new HttpError(400, problem);

    const name = cleanText(body.name, 300);
    const purpose = cleanText(body.purpose, 2000);
    const missing = [!name && 'nazov', !purpose && 'ucel', !body.ownerPositionId && !cleanText(body.newPositionName) && 'vlastnik'].filter(Boolean);
    if (missing.length) throw new HttpError(400, `Pred vytvorenim procesu doplnte: ${missing.join(', ')}.`);

    let ownerPositionId: string;
    if (body.ownerPositionId) {
      [ownerPositionId] = await assertOwnedIds('orgPosition', organizationId, [body.ownerPositionId]);
    } else {
      // nove miesto smie zalozit len ten, kto smie menit organizaciu
      if (!hasPermission(request, 'organization:write')) throw new HttpError(403, 'Na zalozenie noveho pracovneho miesta nemate opravnenie.');
      const positionName = cleanText(body.newPositionName, 200)!;
      const existing = await prisma.orgPosition.findFirst({
        where: { organizationId, name: { equals: positionName, mode: 'insensitive' } }
      });
      ownerPositionId = existing?.id ?? (await prisma.orgPosition.create({ data: { organizationId, name: positionName } })).id;
    }
    const [parentId = null] = await assertOwnedIds('processNode', organizationId, [body.parentId]);

    const node = await prisma.processNode.create({
      data: {
        organizationId,
        parentId,
        type: ProcessNodeType.PROCESS,
        name: name!,
        description: purpose,
        status: ProcessStatus.DRAFT,
        diagramType: 'BPMN',
        // povodne XML bez zmeny — aj prvky a rozsirenia, ktore aplikacia nezobrazuje
        bpmnXml,
        positions: { create: { positionId: ownerPositionId, role: ResponsibilityRole.OWNER } }
      }
    });
    const sourceName = cleanText(body.sourceFileName, 200);
    await prisma.processChangeLog.create({
      data: {
        processNodeId: node.id,
        userId: auth(request).userId,
        changedFields: { import: { from: null, to: `BPMN z bezplatneho modelera${sourceName ? ` (${sourceName})` : ''}` } },
        description: 'Import diagramu ako navrh — pred publikovanim doplnte kroky a skontrolujte obsah.'
      }
    });

    const fresh = await prisma.processNode.findUnique({ where: { id: node.id }, include: processInclude() });
    response.status(201).json(mapNode(fresh));
  } catch (error) {
    next(error);
  }
});


/**
 * Zodpovedne miesta procesu (#15) aj s tym, kto ich DNES zastava — vlastnik
 * procesu sa zobrazuje podla obsadenia miesta, nie podla pevne zapisaneho cloveka.
 */
function responsibilityInclude(at: Date = today()) {
  return {
    include: {
      position: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
          assignments: { where: activeOn(at), select: { person: { select: { name: true } } } }
        }
      }
    }
  };
}

function processInclude() {
  return {
    owner: { select: { name: true } },
    revisions: { orderBy: { createdAt: 'desc' as const } },
    children: true,
    positions: responsibilityInclude(),
    ...publicationInclude()
  };
}

/**
 * #27 — co treba k vypoctu stavu publikovania: verzie (bez snapshotu) a prilohy
 * (patria do obsahu navrhu, takze menia jeho odtlacok).
 */
function publicationInclude() {
  return {
    versions: {
      orderBy: { revision: 'desc' as const },
      select: { id: true, revision: true, effectiveFrom: true, effectiveTo: true, contentHash: true, nextReviewAt: true }
    },
    attachments: { select: DOCUMENT_VERSION_SELECT },
    // #28 — kroky patria do obsahu navrhu, #29 aj s RACI
    activities: activityInclude(),
    // #37 — cakajuca ziadost o schvalenie
    approvalRequests: {
      where: { status: ApprovalStatus.PENDING },
      select: { id: true, requestedById: true, createdAt: true, effectiveFrom: true, requestedBy: { select: { name: true } } }
    },
    // #45 — povinne vlastne polia firmy patria k minimu na publikovanie
    organization: { select: { processFields: REQUIRED_FIELDS_SELECT } }
  };
}

const REQUIRED_FIELDS_SELECT = {
  where: { required: true, archivedAt: null },
  orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  select: { id: true, label: true, type: true }
};

// --- #27 CORE-01 verzie procesu: navrh vs. nemenna publikovana verzia ---

type Publication = {
  effective: { revision: number; effectiveFrom: string } | null;
  scheduled: { revision: number; effectiveFrom: string } | null;
  latestRevision: number;
  /** navrh (ProcessNode) sa lisi od poslednej publikovanej verzie */
  hasDraftChanges: boolean;
  /** #37 — ziadost o schvalenie, ktora caka na rozhodnutie */
  pendingApproval: { id: string; requestedBy: string | null; requestedById: string | null; createdAt: string; effectiveFrom: string | null } | null;
};

type ProcessSnapshot = {
  schema: 1;
  name: string;
  /** #30 — len ak je kod zadany (starsie verzie a procesy bez kodu ho nemaju) */
  code?: string;
  purpose: string;
  descriptionText: string;
  diagramType: string;
  bpmnXml: string | null;
  flowchartXml: string | null;
  isoLinks: string[];
  relatedProcessIds: string[];
  /** #28 — spustac, vysledok a kroky (v starsich verziach chybaju) */
  trigger?: string;
  outcome?: string;
  /** #29 — raci len pri krokoch, ktore ho maju (starsie verzie ho nemaju) */
  activities?: Array<{ id: string; title: string; description: string; raci?: SnapshotRaci[]; systemIds?: string[] }>;
  /** #40 — riadeny proces a profil Kvalita a audit; len vyplnene polia (odtlacok starsich verzii sa nemeni) */
  inputs?: string[];
  outputs?: string[];
  upstreamProcessIds?: string[];
  downstreamProcessIds?: string[];
  successMeasure?: string;
  resources?: string;
  risks?: string;
  opportunities?: string;
  evidenceRequirements?: string[];
  /** #43 — IT systemy procesu (ID; nazov sa dohlada, aj archivovaneho systemu) */
  systemIds?: string[];
  /** #45 — hodnoty vlastnych poli podla ID definicie (nazov pola sa dohlada) */
  customFields?: Record<string, CustomFieldValue>;
  /** ID miest, nie mena — kto miesto zastava, sa odvodzuje z obsadenia v case */
  responsibilities: Array<{ positionId: string; role: string }>;
  documentIds: string[];
  /** #31 — ktora verzia dokumentu platila pri publikovani (mimo odtlacku) */
  documents: Array<{ id: string; name: string; documentId?: string; version?: number }>;
};

// --- #29 CORE-03 RACI na kroku ---

type RaciCode = 'R' | 'A' | 'C' | 'I';
/** Miesto (bezne) alebo osoba (vynimka) — v snapshote len ID, mena sa dopocitaju k datumu. */
type SnapshotRaci = { role: RaciCode; positionId?: string; personId?: string };

const RACI_CODE: Record<RaciRole, RaciCode> = {
  [RaciRole.RESPONSIBLE]: 'R',
  [RaciRole.ACCOUNTABLE]: 'A',
  [RaciRole.CONSULTED]: 'C',
  [RaciRole.INFORMED]: 'I'
};
const RACI_FROM_CODE: Record<RaciCode, RaciRole> = {
  R: RaciRole.RESPONSIBLE,
  A: RaciRole.ACCOUNTABLE,
  C: RaciRole.CONSULTED,
  I: RaciRole.INFORMED
};
const RACI_ORDER: RaciCode[] = ['R', 'A', 'C', 'I'];
const MAX_RACI_PER_STEP = 20;

const raciSortKey = (item: { role: RaciCode; positionId?: string | null; personId?: string | null }) =>
  `${RACI_ORDER.indexOf(item.role)}:${item.positionId ?? ''}:${item.personId ?? ''}`;

/** Zodpovednosti kroku v tvare snapshotu, zoradene — rovnaky obsah = rovnaky odtlacok. */
function snapshotRaci(activity: any): SnapshotRaci[] {
  return (activity.responsibilities ?? [])
    .map((item: any): SnapshotRaci => item.positionId
      ? { role: RACI_CODE[item.role as RaciRole], positionId: item.positionId }
      : { role: RACI_CODE[item.role as RaciRole], personId: item.personId })
    .sort((a: SnapshotRaci, b: SnapshotRaci) => raciSortKey(a).localeCompare(raciSortKey(b)));
}

/** Zodpovednost kroku pre klienta: miesto s dnesnymi (alebo k datumu verzie) ludmi, osoba ako vynimka. */
function mapStepResponsibility(item: any) {
  const holders = item.position ? (item.position.assignments ?? []).map((assignment: any) => assignment.person?.name).filter(Boolean) : [];
  return {
    role: RACI_CODE[item.role as RaciRole],
    positionId: item.positionId ?? null,
    personId: item.personId ?? null,
    name: item.position?.name ?? item.person?.name ?? '',
    holders,
    vacant: Boolean(item.positionId) && holders.length === 0,
    /** priradene konkretnej osobe — pri jej odchode treba krok upravit */
    exception: Boolean(item.personId),
    personLeft: item.person ? item.person.active === false : false,
    archived: Boolean(item.position?.archivedAt)
  };
}

/** Co treba nacitat ku krokom — pre navrh s dnesnym obsadenim. */
function activityInclude(at: Date = today()) {
  return {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      title: true,
      description: true,
      systemIds: true,
      responsibilities: {
        select: {
          role: true,
          positionId: true,
          personId: true,
          position: { select: { id: true, name: true, archivedAt: true, assignments: { where: activeOn(at), select: { person: { select: { name: true } } } } } },
          person: { select: { id: true, name: true, active: true } }
        }
      }
    }
  };
}

/** Verzia ucinna v dany den; v jeden den s dvoma verziami vyhra vyssia revizia. */
function pickEffective<T extends { revision: number; effectiveFrom: Date; effectiveTo: Date | null }>(versions: T[], at: Date): T | null {
  return versions
    .filter((version) => version.effectiveFrom <= at && (!version.effectiveTo || version.effectiveTo >= at))
    .sort((a, b) => b.revision - a.revision)[0] ?? null;
}

/** Obsah procesu v tvare, ktory sa uklada do publikovanej verzie. */
function buildSnapshot(node: any): ProcessSnapshot {
  const responsibilities = (node.positions ?? [])
    .map((link: any) => ({ positionId: link.positionId, role: String(link.role) }))
    .sort((a: any, b: any) => `${a.role}:${a.positionId}`.localeCompare(`${b.role}:${b.positionId}`));
  // #31 — k navrhu patri verzia dokumentu, ktora dnes plati; starsie a naplanovane nie
  const documents = currentDocumentVersions(node.attachments ?? [])
    .map((attachment: any) => ({ id: attachment.id, name: attachment.fileName, documentId: attachment.documentId ?? attachment.id, version: attachment.version ?? 1 }))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));
  return {
    schema: 1,
    name: node.name,
    // bez kodu kluc chyba — odtlacok existujucich verzii ostava rovnaky
    ...(node.code ? { code: node.code } : {}),
    purpose: node.description ?? '',
    descriptionText: node.descriptionText ?? '',
    diagramType: node.diagramType ?? 'NONE',
    bpmnXml: node.bpmnXml ?? null,
    flowchartXml: node.flowchartXml ?? null,
    isoLinks: [...(node.isoLinks ?? [])].sort(),
    relatedProcessIds: [...(node.relatedProcessIds ?? [])].sort(),
    trigger: node.trigger ?? '',
    outcome: node.outcome ?? '',
    activities: (node.activities ?? []).map((activity: any) => {
      const raci = snapshotRaci(activity);
      // bez zodpovednosti kluc chyba — odtlacok starsich verzii ostava rovnaky
      const systemIds = [...(activity.systemIds ?? [])].sort();
      return {
        id: activity.id,
        title: activity.title,
        description: activity.description ?? '',
        ...(raci.length > 0 ? { raci } : {}),
        // #43 — bez systemov kluc chyba (odtlacok starsich verzii sa nemeni)
        ...(systemIds.length > 0 ? { systemIds } : {})
      };
    }),
    ...controlledSnapshotFields(node),
    // #45 — vlastne polia len ked su vyplnene (odtlacok starsich verzii sa nemeni)
    ...(Object.keys(customFieldValues(node.customFields)).length > 0 ? { customFields: sortedFieldValues(customFieldValues(node.customFields)) } : {}),
    responsibilities,
    documentIds: documents.map((document: any) => document.id),
    documents
  };
}

/** #40 — polia riadeneho procesu do snapshotu, len ked su vyplnene. */
function controlledSnapshotFields(node: any): Partial<ProcessSnapshot> {
  const fields: Partial<ProcessSnapshot> = {};
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) as string[] : []);
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
  if (list(node.inputs).length) fields.inputs = list(node.inputs);
  if (list(node.outputs).length) fields.outputs = list(node.outputs);
  if (list(node.upstreamProcessIds).length) fields.upstreamProcessIds = [...list(node.upstreamProcessIds)].sort();
  if (list(node.downstreamProcessIds).length) fields.downstreamProcessIds = [...list(node.downstreamProcessIds)].sort();
  if (text(node.successMeasure)) fields.successMeasure = node.successMeasure;
  if (text(node.resources)) fields.resources = node.resources;
  if (text(node.risks)) fields.risks = node.risks;
  if (text(node.opportunities)) fields.opportunities = node.opportunities;
  if (list(node.evidenceRequirements).length) fields.evidenceRequirements = list(node.evidenceRequirements);
  if (list(node.systemIds).length) fields.systemIds = [...list(node.systemIds)].sort();
  return fields;
}

/** Odtlacok obsahu; premenovanie dokumentu nie je zmena postupu, preto bez nazvov. */
function snapshotHash(snapshot: ProcessSnapshot): string {
  const { documents: _names, ...content } = snapshot;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

type ReadinessItem = { key: string; label: string; ok: boolean; required: boolean };

/**
 * #28 — co proces potrebuje, aby sa dal publikovat (Rychly proces). Povinne
 * polozky publikovanie blokuju, odporucane len upozornia. Nie je to hodnotenie
 * kvality ani zhody s normou — len zoznam chybajucich udajov.
 */
function publishReadiness(node: any): ReadinessItem[] {
  const owner = (node.positions ?? []).find((link: any) => link.role === ResponsibilityRole.OWNER);
  const ownerHeld = (owner?.position?.assignments ?? []).length > 0;
  return [
    { key: 'name', label: 'Názov procesu', ok: Boolean(node.name?.trim()), required: true },
    { key: 'purpose', label: 'Účel — prečo proces existuje', ok: Boolean(node.description?.trim()), required: true },
    { key: 'activities', label: 'Aspoň jeden krok', ok: (node.activities ?? []).length > 0, required: true },
    { key: 'owner', label: 'Vlastník — pracovné miesto, ktoré za proces zodpovedá', ok: Boolean(owner), required: true },
    { key: 'trigger', label: 'Spúšťač — kedy sa proces začína', ok: Boolean(node.trigger?.trim()), required: false },
    { key: 'outcome', label: 'Výsledok — čo proces prinesie', ok: Boolean(node.outcome?.trim()), required: false },
    { key: 'ownerHeld', label: 'Miesto vlastníka niekto zastáva', ok: !owner || ownerHeld, required: false },
    // #45 — povinne vlastne polia firmy
    ...(node.organization?.processFields ?? []).map((field: any) => ({
      key: `field:${field.id}`,
      label: field.label,
      ok: hasFieldValue(field, customFieldValues(node.customFields)[field.id]),
      required: true
    }))
  ];
}

/** Stav procesu z jeho verzii — rucne nastavit sa neda (predtym sa dal oznacit "schvaleny" bez schvalenia). */
function publicationState(node: any): { status: string; publication?: Publication } {
  if (node.type === ProcessNodeType.GROUP) return { status: '' };
  if (!node.versions) return { status: 'Návrh' };
  const now = today();
  const versions = node.versions as Array<{ revision: number; effectiveFrom: Date; effectiveTo: Date | null; contentHash: string }>;
  const latest = [...versions].sort((a, b) => b.revision - a.revision)[0] ?? null;
  const effective = pickEffective(versions, now);
  const scheduled = latest && latest.effectiveFrom > now ? latest : null;
  return {
    status: effective ? `Platná v${effective.revision}` : scheduled ? `Naplánovaná v${scheduled.revision}` : 'Návrh',
    publication: {
      effective: effective ? { revision: effective.revision, effectiveFrom: day(effective.effectiveFrom)! } : null,
      scheduled: scheduled ? { revision: scheduled.revision, effectiveFrom: day(scheduled.effectiveFrom)! } : null,
      latestRevision: latest?.revision ?? 0,
      hasDraftChanges: latest ? snapshotHash(buildSnapshot(node)) !== latest.contentHash : true,
      pendingApproval: node.approvalRequests?.[0]
        ? {
            id: node.approvalRequests[0].id,
            requestedBy: node.approvalRequests[0].requestedBy?.name ?? null,
            requestedById: node.approvalRequests[0].requestedById ?? null,
            createdAt: node.approvalRequests[0].createdAt.toISOString(),
            effectiveFrom: day(node.approvalRequests[0].effectiveFrom)
          }
        : null
    }
  };
}

function mapVersionMeta(version: any, now = today()) {
  return {
    id: version.id,
    revision: version.revision,
    effectiveFrom: day(version.effectiveFrom),
    effectiveTo: day(version.effectiveTo),
    nextReviewAt: day(version.nextReviewAt),
    changeReason: version.changeReason ?? null,
    publishedAt: version.publishedAt.toISOString(),
    publishedBy: version.publishedBy?.name ?? null,
    // #37 — kto verziu schvalil (pri priamom publikovani null)
    approvedBy: version.approvedBy?.name ?? null,
    approvedAt: version.approvedAt ? version.approvedAt.toISOString() : null,
    state: version.effectiveFrom > now
      ? 'scheduled'
      : !version.effectiveTo || version.effectiveTo >= now ? 'effective' : 'superseded'
  };
}

/**
 * Publikovana verzia v tvare detailu procesu. Zodpovednosti sa zobrazia s ludmi,
 * ktori miesta zastavali v den `at` — nie s dnesnymi, ak sa pozerame do minulosti.
 */
async function versionView(node: any, version: any, at: Date) {
  const snapshot = version.snapshot as ProcessSnapshot;
  const stepRaci = (snapshot.activities ?? []).flatMap((activity) => activity.raci ?? []);
  const positions = await prisma.orgPosition.findMany({
    where: {
      id: { in: [...snapshot.responsibilities.map((item) => item.positionId), ...stepRaci.flatMap((item) => item.positionId ?? [])] },
      organizationId: node.organizationId
    },
    select: { id: true, name: true, assignments: { where: activeOn(at), select: { person: { select: { name: true } } } } }
  });
  const byId = new Map(positions.map((position) => [position.id, position]));
  const people = await prisma.person.findMany({
    where: { id: { in: stepRaci.flatMap((item) => item.personId ?? []) }, organizationId: node.organizationId },
    select: { id: true, name: true, active: true }
  });
  const personById = new Map(people.map((person) => [person.id, person]));
  // #29 — RACI kroku v tvare ako z DB, aby ho mapNode zobrazil s obsadenim k datumu `at`
  const activities = (snapshot.activities ?? []).map((activity) => ({
    ...activity,
    responsibilities: (activity.raci ?? []).map((item) => ({
      role: RACI_FROM_CODE[item.role],
      positionId: item.positionId ?? null,
      personId: item.personId ?? null,
      position: item.positionId
        ? byId.get(item.positionId) ?? { id: item.positionId, name: '(zrušené pracovné miesto)', assignments: [] }
        : null,
      person: item.personId
        ? personById.get(item.personId) ?? { id: item.personId, name: '(osoba už nie je v adresári)', active: false }
        : null
    }))
  }));
  const mapped = mapNode({
    ...node,
    name: snapshot.name,
    code: snapshot.code ?? null,
    description: snapshot.purpose,
    descriptionText: snapshot.descriptionText,
    diagramType: snapshot.diagramType,
    bpmnXml: snapshot.bpmnXml,
    flowchartXml: snapshot.flowchartXml,
    isoLinks: snapshot.isoLinks,
    relatedProcessIds: snapshot.relatedProcessIds,
    // #40 — riadeny proces zo snapshotu (starsie verzie tieto polia nemaju)
    inputs: snapshot.inputs ?? [],
    outputs: snapshot.outputs ?? [],
    upstreamProcessIds: snapshot.upstreamProcessIds ?? [],
    downstreamProcessIds: snapshot.downstreamProcessIds ?? [],
    successMeasure: snapshot.successMeasure ?? '',
    resources: snapshot.resources ?? '',
    risks: snapshot.risks ?? '',
    opportunities: snapshot.opportunities ?? '',
    evidenceRequirements: snapshot.evidenceRequirements ?? [],
    systemIds: snapshot.systemIds ?? [],
    customFields: snapshot.customFields ?? {},
    trigger: snapshot.trigger ?? '',
    outcome: snapshot.outcome ?? '',
    activities,
    positions: snapshot.responsibilities.map((item) => ({
      positionId: item.positionId,
      role: item.role,
      // miesto mohlo byt medzitym zrusene — verzia si ho pamata len podla ID
      position: byId.get(item.positionId) ?? { id: item.positionId, name: '(zrušené pracovné miesto)', assignments: [] }
    }))
  });
  const related = snapshot.relatedProcessIds.length
    ? await prisma.processNode.findMany({
        where: { id: { in: snapshot.relatedProcessIds }, organizationId: node.organizationId },
        select: { id: true, name: true }
      })
    : [];
  // #31 — verzia dokumentu, ktoru verzia procesu ma, a ci uz plati novsia
  const snapshotDocuments = (snapshot.documents ?? []).map((item) => ({ ...item, documentId: item.documentId ?? item.id, version: item.version ?? 1 }));
  const documentVersions = snapshotDocuments.length
    ? await prisma.attachment.findMany({
        where: { organizationId: node.organizationId, documentId: { in: snapshotDocuments.map((item) => item.documentId) } },
        select: DOCUMENT_VERSION_SELECT
      })
    : [];
  const currentByDocument = new Map(currentDocumentVersions(documentVersions).map((item) => [item.documentId ?? item.id, item]));
  const documents = snapshotDocuments.map((item) => {
    const current = currentByDocument.get(item.documentId);
    return { ...item, newerVersion: current && current.id !== item.id && (current.version ?? 1) > item.version ? current.version : null };
  });
  return {
    ...mapped,
    // stav a zmeny navrhu sa pocitaju z procesu, nie zo snapshotu
    ...publicationState(node),
    view: 'version',
    version: mapVersionMeta(version),
    documents,
    relatedProcesses: related
  };
}

/** Navrh procesu so vsetkym, co patri do snapshotu verzie. */
async function loadDraftForPublication(request: express.Request, processId: string) {
  const node = await prisma.processNode.findFirst({
    where: { id: processId, organizationId: orgScope(request) },
    include: {
      positions: true,
      attachments: { select: DOCUMENT_VERSION_SELECT },
      activities: activityInclude(),
      organization: { select: { processFields: REQUIRED_FIELDS_SELECT } }
    }
  });
  if (!node) throw new HttpError(404, 'Proces sa nenasiel.');
  if (node.type === ProcessNodeType.GROUP) throw new HttpError(400, 'Skupinu procesov nemozno publikovat.');
  return node;
}

/**
 * Spolocne kontroly pre priame publikovanie aj odoslanie na schvalenie:
 * minimum (#28), zmena oproti poslednej verzii, dovod zmeny, ucinnost.
 */
async function preparePublication(node: any, body: any) {
  const missing = publishReadiness(node).filter((item) => item.required && !item.ok);
  if (missing.length > 0) {
    throw new HttpError(400, `Na publikovanie chýba: ${missing.map((item) => item.label.split(' — ')[0].toLowerCase()).join(', ')}.`);
  }
  const now = today();
  const effectiveFrom = parseDay(body?.effectiveFrom, now, 'effectiveFrom')!;
  // spatne datovana ucinnost by prepisala, co ludia v minulosti realne pouzivali
  if (effectiveFrom < now) throw new HttpError(400, 'Ucinnost nemoze zacat v minulosti.');
  const nextReviewAt = parseDay(body?.nextReviewAt, null, 'nextReviewAt');
  if (nextReviewAt && nextReviewAt <= effectiveFrom) throw new HttpError(400, 'Termin revizie musi byt po zaciatku ucinnosti.');
  const changeReason = cleanText(body?.changeReason, 1000);

  const snapshot = buildSnapshot(node);
  if (snapshot.code) await assertCodeFreeForPublication(node, snapshot.code, effectiveFrom);
  const contentHash = snapshotHash(snapshot);
  const last = await prisma.processVersion.findFirst({ where: { processNodeId: node.id }, orderBy: { revision: 'desc' } });
  if (last) {
    if (last.contentHash === contentHash) throw new HttpError(409, `Navrh sa nelisi od verzie v${last.revision}.`);
    if (!changeReason) throw new HttpError(400, 'Uvedte dovod zmeny oproti predchadzajucej verzii.');
    if (effectiveFrom < last.effectiveFrom) {
      throw new HttpError(400, `Ucinnost musi zacat najskor ${day(last.effectiveFrom)} (vtedy zacina v${last.revision}).`);
    }
  }
  return { snapshot, contentHash, effectiveFrom, nextReviewAt, changeReason };
}

// --- #30 CORE-04 kod procesu ---

/** Kod bez medzier, velkymi pismenami; prazdny = proces bez kodu. */
function normalizeProcessCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Kód procesu musí byť text.');
  const code = value.trim().toLocaleUpperCase('sk-SK');
  if (!code) return null;
  if (code.length > 32 || !/^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(code)) {
    throw new HttpError(400, 'Kód procesu môže mať najviac 32 znakov — písmená, číslice, pomlčku, bodku, lomku alebo podčiarkovník, bez medzier.');
  }
  return code;
}

/** Navrh: kod nesmie mat iny proces firmy (strazi aj unikatny index). */
async function assertCodeFree(organizationId: string, processId: string, code: string) {
  const taken = await prisma.processNode.findFirst({
    where: { organizationId, code, id: { not: processId } },
    select: { name: true }
  });
  if (taken) throw new HttpError(409, `Kód ${code} už používa proces „${taken.name}“.`);
}

/**
 * Publikovanie: kod nesmie mat ani platna alebo naplanovana verzia ineho
 * procesu — ten mohol kod v navrhu zmenit, no jeho verzia ho este ukazuje.
 */
async function assertCodeFreeForPublication(node: any, code: string, effectiveFrom: Date) {
  const candidates = await prisma.processVersion.findMany({
    where: {
      organizationId: node.organizationId,
      processNodeId: { not: node.id },
      snapshot: { path: ['code'], equals: code },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }]
    },
    select: { processNodeId: true, revision: true, effectiveFrom: true, snapshot: true }
  });
  for (const candidate of candidates) {
    // verzia nahradena v ten isty den nikdy neplatila (vyhrava vyssia revizia)
    const shadowed = await prisma.processVersion.findFirst({
      where: { processNodeId: candidate.processNodeId, revision: { gt: candidate.revision }, effectiveFrom: { lte: candidate.effectiveFrom } },
      select: { id: true }
    });
    if (shadowed) continue;
    const name = (candidate.snapshot as unknown as ProcessSnapshot).name;
    throw new HttpError(409, `Kód ${code} má ešte verzia v${candidate.revision} procesu „${name}“ — dva platné procesy nesmú mať rovnaký kód.`);
  }
}

/** Vytvori dalsiu verziu; predchadzajuca plati do dna pred novou (v ten isty den vyhra vyssia revizia). */
async function createVersion(input: {
  organizationId: string;
  processNodeId: string;
  snapshot: ProcessSnapshot;
  contentHash: string;
  effectiveFrom: Date;
  nextReviewAt: Date | null;
  changeReason: string | null;
  publishedById: string | null;
  approvedById?: string | null;
}) {
  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.processVersion.findFirst({ where: { processNodeId: input.processNodeId }, orderBy: { revision: 'desc' } });
    if (last && input.effectiveFrom < last.effectiveFrom) {
      throw new HttpError(409, `Medzitym vznikla verzia v${last.revision} s ucinnostou od ${day(last.effectiveFrom)}.`);
    }
    if (last) {
      const dayBefore = new Date(input.effectiveFrom.getTime() - 24 * 60 * 60 * 1000);
      await tx.processVersion.update({
        where: { id: last.id },
        data: { effectiveTo: dayBefore < last.effectiveFrom ? last.effectiveFrom : dayBefore }
      });
    }
    const version = await tx.processVersion.create({
      data: {
        organizationId: input.organizationId,
        processNodeId: input.processNodeId,
        revision: (last?.revision ?? 0) + 1,
        snapshot: input.snapshot as any,
        contentHash: input.contentHash,
        changeReason: input.changeReason,
        effectiveFrom: input.effectiveFrom,
        nextReviewAt: input.nextReviewAt,
        publishedById: input.publishedById,
        approvedById: input.approvedById ?? null,
        approvedAt: input.approvedById ? new Date() : null
      },
      include: { publishedBy: { select: { name: true } }, approvedBy: { select: { name: true } } }
    });
    // #38 — dotknutym ludom: nova verzia a odkedy plati
    await emitEvent(tx, {
      organizationId: input.organizationId,
      type: 'ProcessPublished',
      processNodeId: input.processNodeId,
      actorId: input.approvedById ?? input.publishedById,
      payload: { name: input.snapshot.name, revision: version.revision, effectiveFrom: day(version.effectiveFrom), changeReason: input.changeReason }
    });
    return version;
  });
  kickDispatcher();
  // termin revizie do 30 dni — vlastnik sa to dozvie hned, nie az pri hodinovej kontrole
  if (created.nextReviewAt && created.nextReviewAt.getTime() - today().getTime() <= 30 * 24 * 60 * 60 * 1000) {
    scanReviewDue().catch((error) => logError('revizie', error));
  }
  return created;
}

app.post('/api/processes/:processId/publish', async (request, response, next) => {
  try {
    const node = await loadDraftForPublication(request, String(request.params.processId));
    const organization = await prisma.organization.findUnique({ where: { id: node.organizationId }, select: { requireApproval: true } });
    // #37 — firma, ktora vyzaduje schvalenie, nezverejni verziu obidenim schvalovania
    if (organization?.requireApproval) {
      throw new HttpError(409, 'Firma vyzaduje schvalenie — odoslite navrh na schvalenie.');
    }
    const prepared = await preparePublication(node, request.body);
    const userId = auth(request).userId;
    const version = await createVersion({ organizationId: node.organizationId, processNodeId: node.id, ...prepared, publishedById: userId });

    await prisma.processChangeLog.create({
      data: {
        processNodeId: node.id,
        userId,
        changedFields: { publikovanie: { from: version.revision > 1 ? `v${version.revision - 1}` : null, to: `v${version.revision} od ${day(prepared.effectiveFrom)}` } },
        description: prepared.changeReason
      }
    });
    response.status(201).json(mapVersionMeta(version));
  } catch (error) {
    next(error);
  }
});

// --- #37 GOV-01 schvalovanie verzie ---

/** Miesta, ktore clovek v dany den zastava — zapise sa k rozhodnutiu ako historicky zaznam. */
async function positionsHeldBy(organizationId: string, userId: string, at: Date): Promise<string> {
  const person = await prisma.person.findFirst({ where: { organizationId, userId }, select: { id: true } });
  if (!person) return '';
  const held = await prisma.positionAssignment.findMany({
    where: { personId: person.id, organizationId, ...activeOn(at) },
    select: { position: { select: { name: true } } }
  });
  return held.map((item) => item.position.name).join(', ');
}

function mapApprovalRequest(item: any) {
  const decision = (item.steps ?? []).find((step: any) => step.status !== ApprovalStatus.PENDING) ?? null;
  return {
    id: item.id,
    processId: item.processNodeId,
    processName: item.processNode?.name ?? undefined,
    status: String(item.status).toLowerCase(),
    requestedBy: item.requestedBy?.name ?? null,
    requestedById: item.requestedById ?? null,
    createdAt: item.createdAt.toISOString(),
    effectiveFrom: day(item.effectiveFrom),
    nextReviewAt: day(item.nextReviewAt),
    changeReason: item.changeReason ?? null,
    decidedAt: item.decidedAt ? item.decidedAt.toISOString() : null,
    decision: decision
      ? { by: decision.assignee?.name ?? null, positions: decision.deciderPositions || null, comment: decision.comment ?? null }
      : null,
    versionId: item.versionId ?? null
  };
}

const APPROVAL_INCLUDE = {
  requestedBy: { select: { name: true } },
  processNode: { select: { name: true } },
  steps: { include: { assignee: { select: { name: true } } }, orderBy: { order: 'asc' as const } }
};

async function requireApprovalRequest(request: express.Request, requestId: string) {
  const item = await prisma.approvalRequest.findFirst({
    where: { id: requestId, organizationId: orgScope(request) },
    include: APPROVAL_INCLUDE
  });
  if (!item) throw new HttpError(404, 'Ziadost o schvalenie sa nenasla.');
  return item;
}

/** Odoslanie navrhu na schvalenie — obsah sa zmrazi, neskorsie upravy navrhu ho nemenia. */
app.post('/api/processes/:processId/approval-requests', async (request, response, next) => {
  try {
    const node = await loadDraftForPublication(request, String(request.params.processId));
    const pending = await prisma.approvalRequest.findFirst({ where: { processNodeId: node.id, status: ApprovalStatus.PENDING } });
    if (pending) throw new HttpError(409, 'Proces uz caka na schvalenie.');
    const prepared = await preparePublication(node, request.body);
    const userId = auth(request).userId;
    const created = await prisma.approvalRequest.create({
      data: {
        organizationId: node.organizationId,
        processNodeId: node.id,
        requestedById: userId,
        title: node.name,
        snapshot: prepared.snapshot as any,
        contentHash: prepared.contentHash,
        effectiveFrom: prepared.effectiveFrom,
        nextReviewAt: prepared.nextReviewAt,
        changeReason: prepared.changeReason
      },
      include: APPROVAL_INCLUDE
    });
    await prisma.processChangeLog.create({
      data: { processNodeId: node.id, userId, changedFields: { schvalovanie: { from: null, to: 'odoslane na schvalenie' } }, description: prepared.changeReason }
    });
    // #38 — schvalovatelom (okrem ziadatela)
    const latest = await prisma.processVersion.findFirst({ where: { processNodeId: node.id }, orderBy: { revision: 'desc' }, select: { revision: true } });
    await emitEvent(prisma, {
      organizationId: node.organizationId,
      type: 'ApprovalRequested',
      processNodeId: node.id,
      actorId: userId,
      payload: { name: node.name, requestId: created.id, revision: (latest?.revision ?? 0) + 1, requestedBy: created.requestedBy?.name ?? null, changeReason: prepared.changeReason }
    });
    response.status(201).json(mapApprovalRequest(created));
  } catch (error) {
    next(error);
  }
});

/** Obsah na schvalenie tak, ako bol odoslany — schvalovatel posudzuje presne toto. */
app.get('/api/approval-requests/:requestId/view', async (request, response, next) => {
  try {
    const item = await requireApprovalRequest(request, String(request.params.requestId));
    const node = await prisma.processNode.findFirst({
      where: { id: item.processNodeId, organizationId: orgScope(request) },
      include: { ...processInclude(), parent: true }
    });
    if (!node || !item.snapshot) throw new HttpError(404, 'Obsah ziadosti sa nenasiel.');
    const latest = await prisma.processVersion.findFirst({ where: { processNodeId: node.id }, orderBy: { revision: 'desc' }, select: { revision: true } });
    const proposed = {
      id: item.id,
      revision: (latest?.revision ?? 0) + 1,
      snapshot: item.snapshot,
      effectiveFrom: item.effectiveFrom ?? today(),
      effectiveTo: null,
      nextReviewAt: item.nextReviewAt,
      changeReason: item.changeReason,
      publishedAt: item.createdAt,
      publishedBy: item.requestedBy
    };
    const view = await versionView(node, proposed, today());
    response.json({ ...view, view: 'approval', approvalRequest: mapApprovalRequest(item) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/processes/:processId/approval-requests', async (request, response, next) => {
  try {
    const node = await requireProcess(request, request.params.processId);
    const items = await prisma.approvalRequest.findMany({
      where: { processNodeId: node.id },
      orderBy: { createdAt: 'desc' },
      include: APPROVAL_INCLUDE
    });
    response.json(items.map(mapApprovalRequest));
  } catch (error) {
    next(error);
  }
});

/** Na moje schvalenie: cakajuce ziadosti firmy, ktore som neodoslal ja (#33 Moja praca). */
app.get('/api/me/approvals', async (request, response, next) => {
  try {
    const { userId, organizationId } = auth(request);
    if (!hasPermission(request, 'approval:approve')) {
      response.json([]);
      return;
    }
    const items = await prisma.approvalRequest.findMany({
      where: { organizationId, status: ApprovalStatus.PENDING, NOT: { requestedById: userId } },
      orderBy: { createdAt: 'asc' },
      include: APPROVAL_INCLUDE
    });
    response.json(items.map(mapApprovalRequest));
  } catch (error) {
    next(error);
  }
});

async function decide(request: express.Request, approve: boolean) {
  const item = await requireApprovalRequest(request, String(request.params.requestId));
  if (item.status !== ApprovalStatus.PENDING) throw new HttpError(409, 'Ziadost uz bola vybavena.');
  const { userId, organizationId } = auth(request);
  // oddelenie povinnosti: kto zmenu navrhol, ju sam neschvali
  if (item.requestedById === userId) throw new HttpError(403, 'Vlastnu ziadost nemozete schvalit ani zamietnut.');
  const comment = cleanText(request.body?.comment, 2000);
  if (!approve && !comment) throw new HttpError(400, 'Uvedte dovod zamietnutia.');

  const now = new Date();
  let versionId: string | null = null;
  if (approve) {
    // ucinnost, ktora medzicasom presla, zacne dnes — nie spatne
    const effectiveFrom = item.effectiveFrom && item.effectiveFrom > today() ? item.effectiveFrom : today();
    // #30 — medzi odoslanim a rozhodnutim mohol rovnaky kod publikovat iny proces
    const proposedCode = (item.snapshot as unknown as ProcessSnapshot)?.code;
    if (proposedCode) {
      await assertCodeFreeForPublication({ id: item.processNodeId, organizationId }, proposedCode, effectiveFrom);
    }
    const version = await createVersion({
      organizationId,
      processNodeId: item.processNodeId,
      snapshot: item.snapshot as unknown as ProcessSnapshot,
      contentHash: item.contentHash ?? '',
      effectiveFrom,
      nextReviewAt: item.nextReviewAt && item.nextReviewAt > effectiveFrom ? item.nextReviewAt : null,
      changeReason: item.changeReason,
      publishedById: item.requestedById,
      approvedById: userId
    });
    versionId = version.id;
  }

  await prisma.$transaction(async (tx) => {
    await tx.approvalStep.create({
      data: {
        approvalRequestId: item.id,
        assigneeId: userId,
        status: approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
        comment,
        decidedAt: now,
        deciderPositions: await positionsHeldBy(organizationId, userId, today())
      }
    });
    await tx.approvalRequest.update({
      where: { id: item.id },
      data: { status: approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED, decidedAt: now, versionId }
    });
    await tx.processChangeLog.create({
      data: {
        processNodeId: item.processNodeId,
        userId,
        changedFields: { schvalovanie: { from: 'caka na schvalenie', to: approve ? 'schvalene a publikovane' : 'zamietnute' } },
        description: comment
      }
    });
    // #38 — ziadatelovi vysledok
    const decider = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    await emitEvent(tx, {
      organizationId,
      type: 'ApprovalDecided',
      processNodeId: item.processNodeId,
      actorId: userId,
      payload: { name: item.processNode?.name ?? item.title, approved: approve, comment, decidedBy: decider?.name ?? null, requestedById: item.requestedById }
    });
  });
  kickDispatcher();
  return requireApprovalRequest(request, item.id);
}

app.post('/api/approval-requests/:requestId/approve', async (request, response, next) => {
  try {
    response.json(mapApprovalRequest(await decide(request, true)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/approval-requests/:requestId/reject', async (request, response, next) => {
  try {
    response.json(mapApprovalRequest(await decide(request, false)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/approval-requests/:requestId/withdraw', async (request, response, next) => {
  try {
    const item = await requireApprovalRequest(request, String(request.params.requestId));
    if (item.status !== ApprovalStatus.PENDING) throw new HttpError(409, 'Ziadost uz bola vybavena.');
    const { userId, role } = auth(request);
    // stiahnut smie ziadatel, alebo vlastnik/admin firmy
    if (item.requestedById !== userId && role !== OrganizationRole.OWNER && role !== OrganizationRole.ADMIN) {
      throw new HttpError(403, 'Ziadost moze stiahnut len ten, kto ju odoslal.');
    }
    await prisma.approvalRequest.update({ where: { id: item.id }, data: { status: ApprovalStatus.WITHDRAWN, decidedAt: new Date() } });
    await prisma.processChangeLog.create({
      data: { processNodeId: item.processNodeId, userId, changedFields: { schvalovanie: { from: 'caka na schvalenie', to: 'stiahnute' } } }
    });
    response.json(mapApprovalRequest(await requireApprovalRequest(request, item.id)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/processes/:processId/versions', async (request, response, next) => {
  try {
    const node = await requireProcess(request, request.params.processId);
    const versions = await prisma.processVersion.findMany({
      where: { processNodeId: node.id },
      orderBy: { revision: 'desc' },
      select: {
        id: true, revision: true, effectiveFrom: true, effectiveTo: true, nextReviewAt: true,
        changeReason: true, publishedAt: true, publishedBy: { select: { name: true } },
        approvedAt: true, approvedBy: { select: { name: true } }
      }
    });
    const now = today();
    response.json(versions.map((version) => mapVersionMeta(version, now)));
  } catch (error) {
    next(error);
  }
});

/** Konkretna publikovana verzia — napr. na porovnanie alebo pre audit. */
app.get('/api/processes/:processId/versions/:revision', async (request, response, next) => {
  try {
    const node = await prisma.processNode.findFirst({
      where: { id: String(request.params.processId), organizationId: orgScope(request) },
      include: processInclude()
    });
    if (!node) throw new HttpError(404, 'Proces sa nenasiel.');
    const version = await prisma.processVersion.findUnique({
      where: { processNodeId_revision: { processNodeId: node.id, revision: Number(request.params.revision) || 0 } },
      include: { publishedBy: { select: { name: true } }, approvedBy: { select: { name: true } } }
    });
    if (!version) throw new HttpError(404, 'Verzia sa nenasla.');
    const at = parseDay(request.query['at'], today(), 'at')!;
    response.json(await versionView(node, version, at));
  } catch (error) {
    next(error);
  }
});

const MAX_ACTIVITIES = 200;

type StepRaciInput = { role: RaciRole; positionId: string | null; personId: string | null };

const fromSnapshotRaci = (item: SnapshotRaci): StepRaciInput =>
  ({ role: RACI_FROM_CODE[item.role], positionId: item.positionId ?? null, personId: item.personId ?? null });

const byRaciInput = (a: StepRaciInput, b: StepRaciInput) =>
  raciSortKey({ ...a, role: RACI_CODE[a.role] }).localeCompare(raciSortKey({ ...b, role: RACI_CODE[b.role] }));

/** #29 — RACI jedneho kroku z tela poziadavky; zoradene, bez duplicit, najviac jedno A. */
function parseStepRaci(value: unknown, index: number): StepRaciInput[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, `Krok ${index + 1}: zodpovednosti musia byť zoznam.`);
  if (value.length > MAX_RACI_PER_STEP) throw new HttpError(400, `Krok ${index + 1}: najviac ${MAX_RACI_PER_STEP} zodpovedností.`);
  const unique = new Map<string, StepRaciInput>();
  for (const item of value as any[]) {
    const role = RACI_FROM_CODE[item?.role as RaciCode];
    if (!role) throw new HttpError(400, `Krok ${index + 1}: neznáma rola zodpovednosti (R, A, C alebo I).`);
    const positionId = typeof item?.positionId === 'string' && item.positionId ? item.positionId : null;
    const personId = typeof item?.personId === 'string' && item.personId ? item.personId : null;
    if (Boolean(positionId) === Boolean(personId)) {
      throw new HttpError(400, `Krok ${index + 1}: zodpovednosť patrí pracovnému miestu, alebo výnimočne osobe — práve jednému.`);
    }
    const entry = { role, positionId, personId };
    unique.set(raciSortKey({ ...entry, role: RACI_CODE[role] }), entry);
  }
  const result = [...unique.values()].sort(byRaciInput);
  if (result.filter((item) => item.role === RaciRole.ACCOUNTABLE).length > 1) {
    throw new HttpError(400, `Krok ${index + 1}: zodpovedný (A) môže byť len jeden — ostatní vykonávajú (R) alebo konzultujú (C).`);
  }
  return result;
}

/** Citatelny zapis RACI krokov do auditu (mena miest a osob v case zmeny). */
async function describeStepRaci(organizationId: string, titles: string[], raci: StepRaciInput[][]): Promise<string[]> {
  const all = raci.flat();
  const [positions, people] = await Promise.all([
    prisma.orgPosition.findMany({ where: { organizationId, id: { in: all.flatMap((item) => item.positionId ?? []) } }, select: { id: true, name: true } }),
    prisma.person.findMany({ where: { organizationId, id: { in: all.flatMap((item) => item.personId ?? []) } }, select: { id: true, name: true } })
  ]);
  const names = new Map([...positions, ...people].map((item) => [item.id, item.name]));
  return titles
    .map((title, index) => ({ title, items: raci[index] ?? [] }))
    .map(({ title, items }, index) => items.length === 0
      ? ''
      : `${index + 1}. ${title}: ${items.map((item) => `${RACI_CODE[item.role]} ${names.get(item.positionId ?? item.personId ?? '') ?? '?'}${item.personId ? ' (osoba)' : ''}`).join(', ')}`)
    .filter(Boolean);
}

/**
 * #28 — kroky navrhu ako cely zoradeny zoznam (jednoduche aj pre presuny).
 * Krok s existujucim `id` sa zachova (stabilne ID pre neskorsie RACI na krok),
 * novy dostane nove ID, chybajuci sa zmaze. Publikovane verzie sa nemenia.
 */
app.put('/api/processes/:processId/activities', async (request, response, next) => {
  try {
    const node = await requireProcess(request, request.params.processId);
    if (node.type === ProcessNodeType.GROUP) throw new HttpError(400, 'Skupina procesov nema kroky.');
    const input = Array.isArray(request.body?.activities) ? request.body.activities : null;
    if (!input) throw new HttpError(400, 'activities musi byt zoznam krokov.');
    if (input.length > MAX_ACTIVITIES) throw new HttpError(400, `Proces moze mat najviac ${MAX_ACTIVITIES} krokov.`);

    const steps: Array<{ id: string | null; title: string; description: string | null; raci: StepRaciInput[] | undefined; systemIds: string[] | undefined }> =
      input.map((item: any, index: number) => {
        const title = cleanText(item?.title, 300);
        if (!title) throw new HttpError(400, `Krok ${index + 1} nema nazov.`);
        if (item?.systemIds !== undefined && !Array.isArray(item.systemIds)) throw new HttpError(400, `Krok ${index + 1}: systémy musia byť zoznam.`);
        return {
          id: typeof item?.id === 'string' ? item.id : null,
          title,
          description: cleanText(item?.description, 5000),
          // #29 — bez `raci` sa zodpovednosti kroku nemenia (starsi klient ich nezmaze)
          raci: item?.raci === undefined ? undefined : parseStepRaci(item.raci, index),
          // #43 — bez `systemIds` sa systemy kroku nemenia
          systemIds: item?.systemIds === undefined
            ? undefined
            : [...new Set((item.systemIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0))].sort().slice(0, MAX_SYSTEM_LINKS)
        };
      });
    // miesta a osoby len z vlastnej firmy (B2)
    const raciInput = steps.flatMap((step) => step.raci ?? []);
    await assertOwnedIds('orgPosition', node.organizationId, raciInput.map((item) => item.positionId));
    await assertOwnedIds('person', node.organizationId, raciInput.map((item) => item.personId));
    // #43 — archivovane miesto nove vazby nedostava; uz pouzite pri krokoch procesu moze ostat
    const usedAtSteps = await prisma.activityResponsibility.findMany({
      where: { activity: { processNodeId: node.id }, positionId: { not: null } },
      select: { positionId: true }
    });
    await assertPositionsLinkable(node.organizationId, raciInput.flatMap((item) => item.positionId ?? []), usedAtSteps.flatMap((item) => item.positionId ?? []));

    const existing = await prisma.processActivity.findMany({
      where: { processNodeId: node.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, title: true, description: true, systemIds: true, responsibilities: { select: { role: true, positionId: true, personId: true } } }
    });
    // #43 — systemy krokov: vlastna firma, vyradeny system len ak ho proces uz pri kroku mal
    await resolveSystemLinks(node.organizationId, steps.flatMap((step) => step.systemIds ?? []), existing.flatMap((activity) => activity.systemIds ?? []));
    const existingById = new Map(existing.map((activity) => [activity.id, activity]));
    // cudzie alebo vymyslene ID sa nezachova — krok dostane nove (B2)
    const kept = new Set<string>(steps.filter((step) => step.id && existingById.has(step.id)).map((step) => step.id as string));
    const raciOf = (step: (typeof steps)[number]) =>
      step.raci ?? (step.id && kept.has(step.id) ? snapshotRaci(existingById.get(step.id)).map(fromSnapshotRaci) : []);

    await prisma.$transaction(async (tx) => {
      await tx.processActivity.deleteMany({ where: { processNodeId: node.id, id: { notIn: [...kept] } } });
      for (const [index, step] of steps.entries()) {
        let activityId: string;
        if (step.id && kept.has(step.id)) {
          await tx.processActivity.update({
            where: { id: step.id },
            data: { sortOrder: index, title: step.title, description: step.description, systemIds: step.systemIds }
          });
          activityId = step.id;
        } else {
          const created = await tx.processActivity.create({
            data: {
              organizationId: node.organizationId,
              processNodeId: node.id,
              sortOrder: index,
              title: step.title,
              description: step.description,
              systemIds: step.systemIds ?? []
            }
          });
          activityId = created.id;
        }
        if (step.raci === undefined) continue;
        await tx.activityResponsibility.deleteMany({ where: { activityId } });
        if (step.raci.length > 0) {
          await tx.activityResponsibility.createMany({
            data: step.raci.map((item) => ({ organizationId: node.organizationId, activityId, ...item }))
          });
        }
      }
    });

    const before = existing.map((activity) => activity.title);
    const after = steps.map((step) => step.title);
    const changedFields: Record<string, { from: unknown; to: unknown }> = {};
    if (JSON.stringify(existing.map((a) => [a.title, a.description ?? null])) !== JSON.stringify(steps.map((s) => [s.title, s.description]))) {
      changedFields['kroky'] = { from: before, to: after };
    }
    // #29 — zmena RACI do auditu citatelne: „1. Kontrola: R Uctovnik, A Veduca kvality“
    const raciBefore = existing.map((activity) => snapshotRaci(activity).map(fromSnapshotRaci));
    const raciAfter = steps.map(raciOf);
    if (JSON.stringify(raciBefore) !== JSON.stringify(raciAfter.map((items) => [...items].sort(byRaciInput)))) {
      changedFields['zodpovednostiKrokov'] = {
        from: await describeStepRaci(node.organizationId, before, raciBefore),
        to: await describeStepRaci(node.organizationId, after, raciAfter)
      };
    }
    // #43 — systemy krokov do auditu: „2. Zaúčtovanie: ERP, Banka“
    const systemsBefore = existing.map((activity) => [...(activity.systemIds ?? [])].sort());
    const systemsAfter = steps.map((step) => step.systemIds ?? (step.id && kept.has(step.id) ? [...(existingById.get(step.id)?.systemIds ?? [])].sort() : []));
    if (JSON.stringify(systemsBefore) !== JSON.stringify(systemsAfter)) {
      const names = new Map((await prisma.itSystem.findMany({
        where: { organizationId: node.organizationId, id: { in: [...systemsBefore.flat(), ...systemsAfter.flat()] } },
        select: { id: true, name: true }
      })).map((system) => [system.id, system.name]));
      const describe = (titles: string[], lists: string[][]) => titles
        .map((title, index) => (lists[index] ?? []).length ? `${index + 1}. ${title}: ${lists[index].map((id) => names.get(id) ?? '?').join(', ')}` : '')
        .filter(Boolean);
      changedFields['systemyKrokov'] = { from: describe(before, systemsBefore), to: describe(after, systemsAfter) };
    }
    if (Object.keys(changedFields).length > 0) {
      await prisma.processChangeLog.create({
        data: { processNodeId: node.id, userId: auth(request).userId, changedFields: changedFields as any }
      });
    }

    const fresh = await prisma.processNode.findUnique({ where: { id: node.id }, include: processInclude() });
    response.json(mapNode(fresh));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/processes/:processId', async (request, response, next) => {
  try {
    const { processId } = request.params;
    const current = await prisma.processNode.findFirst({
      where: { id: processId, organizationId: orgScope(request) },
      include: { positions: true }
    });
    if (!current) {
      response.status(404).json({ message: 'Process not found' });
      return;
    }

    const body = request.body ?? {};

    // odkazy len na objekty vlastnej firmy (B2) a strom procesov bez cyklov
    if (body.parentId) {
      await assertOwnedIds('processNode', current.organizationId, [body.parentId]);
      const nodes = await prisma.processNode.findMany({
        where: { organizationId: current.organizationId },
        select: { id: true, parentId: true }
      });
      assertAcyclic(processId, body.parentId, new Map(nodes.map((node) => [node.id, node.parentId])),
        'Proces nemozno presunut pod seba ani pod svoj podproces.');
    }
    if (Array.isArray(body.relatedProcessIds)) {
      body.relatedProcessIds = await assertOwnedIds('processNode', current.organizationId, body.relatedProcessIds);
    }
    if (Array.isArray(body.positionIds)) {
      body.positionIds = await assertOwnedIds('orgPosition', current.organizationId, body.positionIds);
    }
    // #43 — archivovane miesto nove vazby nedostava (existujuce mozu ostat)
    const linkedPositions = current.positions.map((link) => link.positionId);
    await assertPositionsLinkable(current.organizationId, [
      ...(Array.isArray(body.positionIds) ? body.positionIds as string[] : []),
      ...(typeof body.ownerPositionId === 'string' && body.ownerPositionId ? [body.ownerPositionId] : [])
    ], linkedPositions);
    // #30 — kod je sucast navrhu; jedinecny vo firme
    const code = body.code === undefined ? undefined : normalizeProcessCode(body.code);
    if (code) await assertCodeFree(current.organizationId, processId, code);

    // #40 — riadeny proces: zoznamy textov, nadvaznost len na procesy vlastnej firmy (nie sam na seba)
    const textList = (value: unknown, field: string) => {
      if (value === undefined) return undefined;
      if (!Array.isArray(value)) throw new HttpError(400, `${field} musí byť zoznam.`);
      return [...new Set(value.map((item) => cleanText(item, 300)).filter((item): item is string => Boolean(item)))].slice(0, 30);
    };
    const processLinks = async (value: unknown) => {
      if (value === undefined) return undefined;
      if (!Array.isArray(value)) throw new HttpError(400, 'Nadväzujúce procesy musia byť zoznam.');
      return (await assertOwnedIds('processNode', current.organizationId, value)).filter((id) => id !== processId);
    };
    const longText = (value: unknown) => (value === undefined ? undefined : cleanText(value, 2000) ?? null);
    const controlled = {
      inputs: textList(body.inputs, 'Vstupy'),
      outputs: textList(body.outputs, 'Výstupy'),
      evidenceRequirements: textList(body.evidenceRequirements, 'Záznamy'),
      upstreamProcessIds: await processLinks(body.upstreamProcessIds),
      downstreamProcessIds: await processLinks(body.downstreamProcessIds),
      successMeasure: longText(body.successMeasure),
      resources: longText(body.resources),
      risks: longText(body.risks),
      opportunities: longText(body.opportunities)
    };
    // #43 — IT systemy len vlastnej firmy; vyradeny system nove vazby nedostava
    const systemIds = body.systemIds === undefined
      ? undefined
      : await resolveSystemLinks(current.organizationId, body.systemIds, current.systemIds ?? []);
    // #45 — vlastne polia firmy; povinnost vyplnenia sa kontroluje az pri publikovani
    const custom = body.customFields === undefined ? undefined : await mergeCustomFields(current.organizationId, current.customFields, body.customFields);

    const data = {
      name: body.name ?? undefined,
      code,
      description: body.purpose ?? undefined,
      descriptionText: body.descriptionText ?? undefined,
      trigger: body.trigger === undefined ? undefined : (cleanText(body.trigger, 1000) ?? null),
      outcome: body.outcome === undefined ? undefined : (cleanText(body.outcome, 1000) ?? null),
      // #27 — stav (status) sa ignoruje: vyplyva z publikovanych verzii
      bpmnXml: body.bpmnXml ?? undefined,
      diagramType: body.diagramType ?? undefined,
      flowchartXml: body.flowchartXml !== undefined ? (body.flowchartXml ?? null) : undefined,
      isoLinks: body.iso ? isoLinksFromBody(body.iso) : undefined,
      parentId: body.parentId === undefined ? undefined : body.parentId,
      sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
      relatedProcessIds: Array.isArray(body.relatedProcessIds) ? (body.relatedProcessIds as string[]) : undefined,
      ...controlled,
      systemIds,
      customFields: custom ? (Object.keys(custom.values).length > 0 ? custom.values : Prisma.DbNull) : undefined
    };

    // R7: diff zmenenych poli pre audit log
    // hodnoty su JSON (retazce, polia, null) — ukladaju sa do stlpca Json
    const changedFields: Record<string, { from: any; to: any }> = {};
    const track = (field: string, from: any, to: any) => {
      if (to === undefined) return;
      // null a prazdny retazec povazuj za rovnake (ziadna realna zmena)
      if (JSON.stringify(from ?? '') === JSON.stringify(to ?? '')) return;
      changedFields[field] = { from, to };
    };
    track('name', current.name, data.name);
    track('code', current.code, data.code);
    track('purpose', current.description, data.description);
    track('descriptionText', current.descriptionText, data.descriptionText);
    track('trigger', current.trigger, data.trigger);
    track('outcome', current.outcome, data.outcome);
    track('parentId', current.parentId, data.parentId);
    track('relatedProcessIds', current.relatedProcessIds, data.relatedProcessIds);
    track('isoLinks', current.isoLinks, data.isoLinks);
    for (const [field, value] of Object.entries(controlled)) track(field, (current as any)[field], value);
    if (custom && custom.changes.to.length > 0) changedFields['vlastnePolia'] = custom.changes;
    if (systemIds && JSON.stringify([...(current.systemIds ?? [])].sort()) !== JSON.stringify(systemIds)) {
      // do auditu nazvy systemov v case zmeny
      changedFields['systemy'] = {
        from: await describeSystems(current.organizationId, current.systemIds ?? []),
        to: await describeSystems(current.organizationId, systemIds)
      };
    }
    if (data.bpmnXml !== undefined && data.bpmnXml !== current.bpmnXml) {
      changedFields['bpmnXml'] = { from: '(diagram)', to: '(diagram zmeneny)' };
    }
    if ((data as any).diagramType !== undefined && (data as any).diagramType !== (current as any).diagramType) {
      changedFields['diagramType'] = { from: (current as any).diagramType, to: (data as any).diagramType };
    }
    if ((data as any).flowchartXml !== undefined && (data as any).flowchartXml !== (current as any).flowchartXml) {
      changedFields['flowchartXml'] = { from: '(flowchart)', to: '(flowchart zmeneny)' };
    }

    try {
      await prisma.processNode.update({ where: { id: processId }, data });
    } catch (error: any) {
      // dvaja naraz s rovnakym kodom — druhy narazi na unikatny index
      if (error?.code === 'P2002') throw new HttpError(409, `Kód ${code} už používa iný proces.`);
      throw error;
    }

    // R1/R3, #15: vykonavatelia (positionIds) a vlastnik (ownerPositionId) podla miest
    const performerIds = current.positions
      .filter((item) => item.role === ResponsibilityRole.PERFORMER)
      .map((item) => item.positionId)
      .sort();
    if (Array.isArray(body.positionIds)) {
      const nextIds = [...new Set(body.positionIds as string[])].sort();
      if (JSON.stringify(performerIds) !== JSON.stringify(nextIds)) {
        changedFields['positions'] = { from: await describePositions(performerIds), to: await describePositions(nextIds) };
        await prisma.processPosition.deleteMany({ where: { processNodeId: processId, role: ResponsibilityRole.PERFORMER } });
        if (nextIds.length > 0) {
          await prisma.processPosition.createMany({
            data: nextIds.map((positionId) => ({ processNodeId: processId, positionId, role: ResponsibilityRole.PERFORMER }))
          });
        }
      }
    }

    if (body.ownerPositionId !== undefined) {
      const [nextOwner = null] = await assertOwnedIds('orgPosition', current.organizationId, [body.ownerPositionId]);
      const currentOwner = current.positions.find((item) => item.role === ResponsibilityRole.OWNER)?.positionId ?? null;
      if (nextOwner !== currentOwner) {
        // do auditu aj meno cloveka, ktory miesto v tej chvili zastaval —
        // po zmene obsadenia zostane v historii povodny vlastnik
        changedFields['ownerPosition'] = {
          from: (await describePositions(currentOwner ? [currentOwner] : []))[0] ?? null,
          to: (await describePositions(nextOwner ? [nextOwner] : []))[0] ?? null
        };
        await prisma.processPosition.deleteMany({ where: { processNodeId: processId, role: ResponsibilityRole.OWNER } });
        if (nextOwner) {
          await prisma.processPosition.create({
            data: { processNodeId: processId, positionId: nextOwner, role: ResponsibilityRole.OWNER }
          });
        }
      }
    }

    if (Object.keys(changedFields).length > 0 || body.changeDescription) {
      await prisma.processChangeLog.create({
        data: {
          processNodeId: processId,
          // autor z relacie, nie z hlavicky od klienta (B1) — inak by sa dal podvrhnut
          userId: auth(request).userId,
          changedFields,
          description: body.changeDescription || null
        }
      });
    }

    // R5: prepocitaj ISO sugescie pri zmene textov
    if (changedFields['name'] || changedFields['purpose'] || changedFields['descriptionText']) {
      await computeIsoSuggestions(processId).catch(() => undefined);
      // R8: automaticky preklad (fire-and-forget)
      void autoTranslateProcess(current.organizationId, processId);
    }

    const fresh = await prisma.processNode.findUnique({ where: { id: processId }, include: processInclude() });
    response.json(mapNode(fresh));
  } catch (error) {
    next(error);
  }
});

// R3: detail procesu s rozsirenymi vazbami
app.get('/api/processes/:processId', async (request, response, next) => {
  try {
    const node = await prisma.processNode.findFirst({
      where: { id: request.params.processId, organizationId: orgScope(request) },
      include: { ...processInclude(), parent: true }
    });
    if (!node) {
      response.status(404).json({ message: 'Process not found' });
      return;
    }
    const parentAndChildren = {
      parentName: (node as any).parent?.name ?? null,
      childProcesses: (node.children ?? []).map((child: any) => ({ id: child.id, name: child.name }))
    };

    // #27 — platna verzia v dany den (predvolene dnes) namiesto rozpracovaneho navrhu
    if (request.query['view'] === 'effective') {
      const at = parseDay(request.query['at'], today(), 'at')!;
      const versions = await prisma.processVersion.findMany({
        where: { processNodeId: node.id },
        include: { publishedBy: { select: { name: true } }, approvedBy: { select: { name: true } } }
      });
      const version = pickEffective(versions, at);
      if (!version) throw new HttpError(404, 'Proces zatial nema ucinnu verziu.');
      response.json({ ...(await versionView(node, version, at)), ...parentAndChildren });
      return;
    }

    const related = node.relatedProcessIds.length
      ? await prisma.processNode.findMany({
          where: { id: { in: node.relatedProcessIds }, organizationId: node.organizationId },
          select: { id: true, name: true }
        })
      : [];
    response.json({
      ...mapNode(node),
      ...parentAndChildren,
      view: 'draft',
      relatedProcesses: related
    });
  } catch (error) {
    next(error);
  }
});

// R7: historia zmien procesu
app.get('/api/processes/:processId/history', async (request, response, next) => {
  try {
    await requireProcess(request, request.params.processId);
    const logs = await prisma.processChangeLog.findMany({
      where: { processNodeId: request.params.processId },
      orderBy: { createdAt: 'desc' },
      include: { user: true }
    });
    response.json(logs.map((log) => ({
      id: log.id,
      date: log.createdAt.toISOString(),
      userName: log.user?.name ?? 'Neznamy',
      changedFields: log.changedFields,
      description: log.description
    })));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/processes/:processId', async (request, response, next) => {
  try {
    const { processId } = request.params;
    const node = await requireProcess(request, processId);

    // #10 — DB zmaze prilohy kaskadou, subory na disku treba zmazat rucne:
    // najprv zistit, ktore patria procesu a celemu jeho podstromu
    const nodes = await prisma.processNode.findMany({
      where: { organizationId: node.organizationId },
      select: { id: true, parentId: true }
    });
    const subtree = new Set([processId]);
    for (let grew = true; grew;) {
      grew = false;
      for (const item of nodes) {
        if (item.parentId && subtree.has(item.parentId) && !subtree.has(item.id)) {
          subtree.add(item.id);
          grew = true;
        }
      }
    }
    // #27 — publikovane verzie su zaznam o tom, co v firme platilo; mazanim by zmizol
    const published = await prisma.processVersion.count({ where: { processNodeId: { in: [...subtree] } } });
    if (published > 0) {
      throw new HttpError(409, 'Proces alebo jeho podproces ma publikovane verzie — nemozno ho zmazat.');
    }

    const files = await prisma.attachment.findMany({
      where: { processNodeId: { in: [...subtree] } },
      select: { storagePath: true }
    });

    await prisma.processNode.delete({ where: { id: processId } });
    for (const file of files) {
      if (isFileKey(file.storagePath)) await removeStored(file.storagePath).catch(() => undefined);
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// #8 — spotreba uloziska organizacie
app.get('/api/organizations/:organizationId/storage', async (request, response, next) => {
  try {
    response.json(await storageUsage(orgScope(request)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/documents', async (request, response, next) => {
  try {
    const organization = await ensureOrganization(orgScope(request));
    response.json(await listCurrentDocuments({ organizationId: organization.id }));
  } catch (error) {
    next(error);
  }
});

app.get('/api/processes/:processId/documents', async (request, response, next) => {
  try {
    const node = await requireProcess(request, request.params.processId);
    response.json(await listCurrentDocuments({ processNodeId: node.id, organizationId: node.organizationId }));
  } catch (error) {
    next(error);
  }
});

/**
 * Nahratie dokumentu (#10). Telo poziadavky je priamo obsah suboru
 * (application/octet-stream), nazov a typ su v hlavickach X-File-Name
 * (URI-kodovany) a X-File-Type. Subor tecie rovno na disk — 100 MB subor
 * sa nedrzi v pamati ani v databaze.
 *
 * Starsi format (JSON s data URL) sa este prijima, ale tiez sa uklada na disk.
 */
/**
 * Prijme subor z tela poziadavky rovno na disk (#10); kvota (#9) sa overuje
 * pred zapisom aj so skutocnou velkostou. Pri chybe po zapise subor zmaze.
 */
async function receiveUpload(request: express.Request, organizationId: string, attachmentId: string) {
  const key = fileKey(organizationId, attachmentId);
  const tooLarge = () =>
    new HttpError(413, `Subor je prilis velky. Maximalna velkost je ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  let written = false;
  try {
    let fileName: string;
    let mimeType: string;
    let sizeBytes: number;
    if (request.is('application/json')) {
      const parsed = parseDataUrl(String(request.body?.dataUrl ?? ''));
      if (!parsed) throw new HttpError(400, 'Chyba obsah suboru.');
      fileName = cleanFileName(request.body?.fileName);
      mimeType = cleanMimeType(request.body?.mimeType ?? parsed.mimeType);
      sizeBytes = parsed.data.length;
      if (sizeBytes > MAX_UPLOAD_BYTES) throw tooLarge();
      await assertStorageAvailable(organizationId, sizeBytes);
      await storeBuffer(key, parsed.data);
    } else {
      fileName = cleanFileName(decodeHeader(request.get('x-file-name')));
      mimeType = cleanMimeType(request.get('x-file-type'));
      // deklarovana velkost sluzi na skore odmietnutie; zavazna je skutocne zapisana
      const declared = Number(request.get('content-length'));
      if (declared > MAX_UPLOAD_BYTES) throw tooLarge();
      await assertStorageAvailable(organizationId, Number.isFinite(declared) ? declared : 0);
      sizeBytes = await storeStream(key, request, MAX_UPLOAD_BYTES, tooLarge);
    }
    written = true;
    // znova so skutocnou velkostou — medzitym mohlo prebehnut ine nahravanie
    await assertStorageAvailable(organizationId, sizeBytes);
    return { key, fileName, mimeType, sizeBytes };
  } catch (error) {
    if (written) await removeStored(key).catch(() => undefined);
    throw error;
  }
}

app.post('/api/processes/:processId/documents', async (request, response, next) => {
  let writtenKey: string | null = null;
  try {
    const processNode = await requireProcess(request, request.params.processId);
    const organizationId = processNode.organizationId;
    const attachmentId = randomUUID();
    const file = await receiveUpload(request, organizationId, attachmentId);
    writtenKey = file.key;

    // #31 — novy subor = novy riadeny dokument s verziou 1, ucinny od dnes
    const attachment = await prisma.$transaction(async (tx) => {
      const document = await tx.controlledDocument.create({
        data: { organizationId, processNodeId: processNode.id, title: file.fileName }
      });
      return tx.attachment.create({
        data: {
          id: attachmentId,
          organizationId,
          processNodeId: processNode.id,
          uploadedById: auth(request).userId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storagePath: file.key,
          documentId: document.id,
          version: 1,
          effectiveFrom: today()
        },
        include: ATTACHMENT_INCLUDE
      });
    });
    writtenKey = null;
    response.status(201).json(mapAttachment(attachment));
  } catch (error) {
    // subor bez zaznamu v DB by zaberal miesto a nikto by ho nevidel
    if (writtenKey) await removeStored(writtenKey).catch(() => undefined);
    next(error);
  }
});

/** #31 — dokument (riadeny) podla ktorejkolvek jeho verzie; stare prilohy bez dokumentu su samostatne. */
async function requireDocumentOf(request: express.Request, attachmentId: string) {
  const attachment = await requireDocument(request, attachmentId);
  if (!attachment.documentId) throw new HttpError(409, 'Priloha nie je riadeny dokument.');
  const document = await prisma.controlledDocument.findFirst({
    where: { id: attachment.documentId, organizationId: attachment.organizationId },
    include: {
      ownerPosition: { select: { id: true, name: true } },
      versions: { orderBy: { version: 'desc' }, include: ATTACHMENT_INCLUDE, omit: { storagePath: true } }
    }
  });
  if (!document) throw new HttpError(404, 'Dokument sa nenasiel.');
  return document;
}

/**
 * Nova verzia dokumentu. Telo = subor ako pri nahrati; X-Effective-From (den,
 * nie spatne) a X-Change-Note (URI-kodovane). Publikovane verzie procesov
 * ostavaju pri verzii, ktoru mali — navrh procesu dostane novu verziu.
 */
app.post('/api/documents/:documentId/versions', async (request, response, next) => {
  let writtenKey: string | null = null;
  try {
    const document = await requireDocumentOf(request, String(request.params.documentId));
    if (document.status === DocumentStatus.ARCHIVED) throw new HttpError(409, 'Archivovany dokument uz nove verzie nedostava.');
    const now = today();
    const effectiveFrom = parseDay(decodeHeader(request.get('x-effective-from')) || undefined, now, 'effectiveFrom')!;
    if (effectiveFrom < now) throw new HttpError(400, 'Ucinnost verzie nemoze zacat v minulosti.');
    const latest = document.versions[0];
    if (latest?.effectiveFrom && effectiveFrom < latest.effectiveFrom) {
      throw new HttpError(400, `Ucinnost musi zacat najskor ${day(latest.effectiveFrom)} (vtedy zacina v${latest.version}).`);
    }
    const changeNote = cleanText(decodeHeader(request.get('x-change-note')), 1000);

    const attachmentId = randomUUID();
    const file = await receiveUpload(request, document.organizationId, attachmentId);
    writtenKey = file.key;
    const attachment = await prisma.attachment.create({
      data: {
        id: attachmentId,
        organizationId: document.organizationId,
        processNodeId: document.processNodeId,
        uploadedById: auth(request).userId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        storagePath: file.key,
        documentId: document.id,
        version: (latest?.version ?? 0) + 1,
        effectiveFrom,
        changeNote
      },
      include: ATTACHMENT_INCLUDE
    });
    writtenKey = null;
    // #38 — platna verzia procesu mohla odkazovat na nahradenu verziu
    if (effectiveFrom <= now) scanDocumentVersions().catch((error) => logError('dokumenty', error));
    response.status(201).json(mapAttachment(attachment, { count: document.versions.length + 1, next: null }));
  } catch (error) {
    if (writtenKey) await removeStored(writtenKey).catch(() => undefined);
    next(error);
  }
});

/** Verzie dokumentu so stavom a tym, ktore publikovane verzie procesov na ne odkazuju. */
app.get('/api/documents/:documentId/versions', async (request, response, next) => {
  try {
    const document = await requireDocumentOf(request, String(request.params.documentId));
    const now = today();
    const current = currentDocumentVersions(document.versions, now)[0];
    const versionIds = document.versions.map((item) => item.id);
    const usedIn = versionIds.length
      ? await prisma.$queryRaw<Array<{ attachmentId: string; revision: number; name: string }>>`
          SELECT d.id AS "attachmentId", v.revision, v.snapshot->>'name' AS name
          FROM "ProcessVersion" v, jsonb_array_elements_text(v.snapshot->'documentIds') AS d(id)
          WHERE v."organizationId" = ${document.organizationId} AND d.id = ANY(${versionIds})`
      : [];
    response.json({
      id: document.id,
      title: document.title,
      status: String(document.status).toLowerCase(),
      ownerPosition: document.ownerPosition ?? null,
      versions: document.versions.map((item) => ({
        ...mapAttachment(item),
        state: item.id === current?.id ? 'current' : item.effectiveFrom && item.effectiveFrom > now ? 'scheduled' : 'superseded',
        usedIn: usedIn.filter((row) => row.attachmentId === item.id).map((row) => ({ revision: row.revision, processName: row.name }))
      }))
    });
  } catch (error) {
    next(error);
  }
});

function decodeHeader(value: string | undefined): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanFileName(value: unknown): string {
  const name = String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 255);
  return name || 'dokument';
}

function cleanMimeType(value: unknown): string {
  const mime = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(mime) ? mime : 'application/octet-stream';
}

// premenovanie dokumentu + priradenie pracovnym poziciam
app.patch('/api/documents/:documentId', async (request, response, next) => {
  try {
    const { documentId } = request.params;
    const existing = await requireDocument(request, documentId);

    const fileName = typeof request.body?.name === 'string' ? request.body.name.trim() : undefined;
    if (fileName !== undefined && !fileName) throw new HttpError(400, 'Nazov dokumentu nesmie byt prazdny.');

    if (fileName !== undefined) {
      await prisma.attachment.update({ where: { id: documentId }, data: { fileName } });
    }

    // #31 — vlastnik (pracovne miesto) a stav riadeneho dokumentu
    if (existing.documentId && (request.body?.ownerPositionId !== undefined || request.body?.status !== undefined)) {
      const [ownerPositionId = null] = request.body?.ownerPositionId === undefined
        ? [undefined]
        : await assertOwnedIds('orgPosition', existing.organizationId, [request.body.ownerPositionId]);
      const status = request.body?.status === undefined
        ? undefined
        : ({ active: DocumentStatus.ACTIVE, archived: DocumentStatus.ARCHIVED } as Record<string, DocumentStatus>)[String(request.body.status)];
      if (request.body?.status !== undefined && !status) throw new HttpError(400, 'Neznamy stav dokumentu.');
      await prisma.controlledDocument.update({
        where: { id: existing.documentId },
        data: { ...(ownerPositionId !== undefined ? { ownerPositionId } : {}), ...(status ? { status } : {}) }
      });
    }

    if (Array.isArray(request.body?.positionIds)) {
      const nextIds = await assertOwnedIds('orgPosition', existing.organizationId, request.body.positionIds);
      await prisma.attachmentPosition.deleteMany({ where: { attachmentId: documentId } });
      if (nextIds.length > 0) {
        await prisma.attachmentPosition.createMany({
          data: nextIds.map((positionId) => ({ attachmentId: documentId, positionId })),
          skipDuplicates: true
        });
      }
    }

    const fresh = await prisma.attachment.findUnique({
      where: { id: documentId },
      include: ATTACHMENT_INCLUDE
    });
    response.json(mapAttachment(fresh));
  } catch (error) {
    next(error);
  }
});

// stiahnutie dokumentu — subor z disku, starsie prilohy z data URL v storagePath
app.get('/api/documents/:documentId/download', async (request, response, next) => {
  try {
    const attachment = await requireDocument(request, request.params.documentId);
    const stored = attachment.storagePath ?? '';

    let size: number;
    let legacy: Buffer | null = null;
    let mimeType = attachment.mimeType;

    if (isFileKey(stored)) {
      const onDisk = await storedSize(stored);
      if (onDisk === null) throw new HttpError(409, 'Subor dokumentu chyba v ulozisku.');
      size = onDisk;
    } else {
      const parsed = parseDataUrl(stored);
      if (!parsed) throw new HttpError(409, 'Dokument nema ulozeny obsah.');
      legacy = parsed.data;
      size = legacy.length;
      mimeType ||= parsed.mimeType;
    }

    // RFC 5987 — aby fungovala aj diakritika v nazve suboru
    const fileName = attachment.fileName || 'dokument';
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

    // ?inline=1 zobrazi PDF priamo (nahlad); ine typy sa vzdy stiahnu, aby sa
    // nahraty HTML/SVG nikdy nevykonal v kontexte aplikacie
    const inline = Boolean(request.query['inline']) && /^application\/pdf\b/.test(mimeType ?? '');

    response.setHeader('Content-Type', mimeType || 'application/octet-stream');
    response.setHeader('Content-Length', String(size));
    response.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );

    if (legacy) {
      response.send(legacy);
      return;
    }
    await pipeline(openStored(stored), response);
  } catch (error) {
    // ak uz tiekli data, chybu nemozno poslat ako JSON — spojenie sa len ukonci
    if (response.headersSent) {
      response.destroy();
      return;
    }
    next(error);
  }
});

app.delete('/api/documents/:documentId', async (request, response, next) => {
  try {
    const attachment = await requireDocument(request, request.params.documentId);
    // #27 — publikovana verzia na dokument odkazuje; zmazanie by jej odkaz rozbilo
    const usedIn = await prisma.processVersion.findFirst({
      where: { organizationId: attachment.organizationId, snapshot: { path: ['documentIds'], array_contains: [attachment.id] } },
      select: { revision: true }
    });
    if (usedIn) {
      throw new HttpError(409, `Dokument je sucastou publikovanej verzie v${usedIn.revision} procesu — nemozno ho zmazat.`);
    }
    await prisma.attachment.delete({ where: { id: attachment.id } });
    // #31 — dokument bez jedinej verzie nema zmysel; platnou sa stane predchadzajuca verzia
    if (attachment.documentId && (await prisma.attachment.count({ where: { documentId: attachment.documentId } })) === 0) {
      await prisma.controlledDocument.delete({ where: { id: attachment.documentId } }).catch(() => undefined);
    }
    // az po zmazani zaznamu — opacne poradie by nechalo zaznam bez suboru
    if (isFileKey(attachment.storagePath)) await removeStored(attachment.storagePath);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/processes/:processId/revisions', async (request, response, next) => {
  try {
    const { processId } = request.params;
    const processNode = await requireProcess(request, processId);
    if (!processNode.bpmnXml) {
      response.status(404).json({ message: 'Process with BPMN XML not found' });
      return;
    }
    const revision = await prisma.processRevision.create({
      data: {
        processNodeId: processId,
        authorId: auth(request).userId,
        name: request.body.name || `Verzia ${new Date().toISOString().slice(0, 10)}`,
        note: request.body.note ?? null,
        bpmnXml: request.body.bpmnXml ?? processNode.bpmnXml,
        diagramSvg: request.body.diagramSvg ?? null,
        documentation: request.body.documentation ?? undefined
      }
    });
    response.status(201).json({
      id: revision.id,
      name: revision.name,
      date: revision.createdAt.toISOString().slice(0, 10),
      bpmnXml: revision.bpmnXml,
      diagramSvg: revision.diagramSvg
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/processes/:processId/camunda7/deploy', async (request, response, next) => {
  try {
    await requireProcess(request, request.params.processId);
    response.json(await deployProcessToCamunda(request.params.processId, request.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/camunda7/deploy', async (request, response, next) => {
  try {
    await requireProcess(request, request.body.processId);
    response.json(await deployProcessToCamunda(request.body.processId, request.body));
  } catch (error) {
    next(error);
  }
});

async function deployProcessToCamunda(processId: string, body: any) {
  const processNode = await prisma.processNode.findUnique({
    where: { id: processId },
    include: { organization: true }
  });
  if (!processNode || processNode.type !== ProcessNodeType.PROCESS) {
    throw new HttpError(404, 'Process not found');
  }

  const bpmnXml = body.bpmnXml ?? processNode.bpmnXml;
  if (!bpmnXml) {
    throw new HttpError(400, 'Process has no BPMN XML to deploy');
  }

  const baseUrl = process.env['CAMUNDA7_BASE_URL'] || processNode.organization.camundaBaseUrl;
  if (!baseUrl) {
    throw new HttpError(400, 'CAMUNDA7_BASE_URL is not configured');
  }

  const deploymentName = body.deploymentName || processNode.name;
  const resourceName = body.resourceName || `${processNode.name.replace(/[^a-z0-9_-]+/gi, '_')}.bpmn`;
  const deployment = await deployToCamunda7({
    baseUrl,
    deploymentName,
    resourceName,
    bpmnXml,
    deployChangedOnly: body.deployChangedOnly !== false
  });
  const deployedDefinition = Object.values((deployment.deployedProcessDefinitions ?? {}) as Record<string, any>)[0];
  const processKey = deployedDefinition?.key ?? processNode.camundaProcessKey ?? processNode.id;

  await prisma.processNode.update({
    where: { id: processId },
    data: {
      bpmnXml,
      camundaProcessKey: processKey
    }
  });

  await prisma.camundaDeployment.create({
    data: {
      organizationId: processNode.organizationId,
      processNodeId: processId,
      deploymentId: deployment.id,
      processKey,
      response: deployment
    }
  });

  return deployment;
}

async function deployToCamunda7(options: {
  baseUrl: string;
  deploymentName: string;
  resourceName: string;
  bpmnXml: string;
  deployChangedOnly: boolean;
}) {
  const formData = new FormData();
  formData.set('deployment-name', options.deploymentName);
  formData.set('deploy-changed-only', String(options.deployChangedOnly));
  formData.set('enable-duplicate-filtering', 'true');
  formData.set('deployment-source', 'process-platform-angular');
  formData.set('data', new Blob([options.bpmnXml], { type: 'application/xml' }), options.resourceName);

  const headers: HeadersInit = {};
  const username = process.env['CAMUNDA7_USERNAME'];
  const password = process.env['CAMUNDA7_PASSWORD'];
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  // 502 — chyba vzdialeneho systemu zakaznika; sprava je pre neho uzitocna
  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/deployment/create`, {
    method: 'POST',
    headers,
    body: formData
  }).catch((error) => {
    throw new HttpError(502, `Camunda 7 nie je dostupna: ${error instanceof Error ? error.message : error}`);
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, `Camunda 7 odmietla nasadenie: ${response.status} ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

// --- Auth, organizacie a pozvanky ---

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// --- Relacie (#1) ---

/** Platnost relacie. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** V databaze drzime iba hash — surovy token vidi len klient. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(userId: string, organizationId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      organizationId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  });
  return token;
}

type AuthContext = { userId: string; organizationId: string; sessionId: string; role: OrganizationRole };

async function resolveSession(request: express.Request): Promise<AuthContext | null> {
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;

  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(header.slice(7)) } });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // posuvanie aktivity — bez cakania, nech neblokuje poziadavku
  void prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);

  // rola vo firme (B7) — ak clenstvo medzitym zaniklo, relacia uz neplati
  const membership = await prisma.organizationUser.findUnique({
    where: { organizationId_userId: { organizationId: session.organizationId, userId: session.userId } },
    select: { role: true }
  });
  if (!membership) return null;

  return { userId: session.userId, organizationId: session.organizationId, sessionId: session.id, role: membership.role };
}

/** Prihlaseny kontext poziadavky. Nastavuje ho requireAuth. */
function auth(request: express.Request): AuthContext {
  const context = (request as any).auth as AuthContext | undefined;
  if (!context) throw new HttpError(401, 'Vyzaduje sa prihlasenie.');
  return context;
}

/**
 * Organizacia sa berie VZDY z relacie (#3). Ak URL obsahuje ine id,
 * je to pokus o pristup do cudzej firmy — koncime 404, aby sme
 * neprezradili, ci taka organizacia existuje.
 */
function orgScope(request: express.Request): string {
  const context = auth(request);
  const fromUrl = request.params['organizationId'];
  if (fromUrl && fromUrl !== context.organizationId) {
    throw new HttpError(404, 'Nenajdene.');
  }
  return context.organizationId;
}

/**
 * Straze objektovej urovne (#4). Kazdy objekt sa hlada VYHRADNE v organizacii
 * z relacie. Cudzi objekt konci na 404 — nie 403, aby sa neprezradilo,
 * ze take id existuje.
 */

async function requireProcess(request: express.Request, processId: string) {
  const node = await prisma.processNode.findFirst({
    where: { id: processId, organizationId: orgScope(request) }
  });
  if (!node) throw new HttpError(404, 'Proces sa nenasiel.');
  return node;
}

async function requireDocument(request: express.Request, documentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: documentId, organizationId: orgScope(request) }
  });
  if (!attachment) throw new HttpError(404, 'Dokument sa nenasiel.');
  return attachment;
}

async function requirePosition(request: express.Request, positionId: string) {
  const position = await prisma.orgPosition.findFirst({
    where: { id: positionId, organizationId: orgScope(request) }
  });
  if (!position) throw new HttpError(404, 'Pozicia sa nenasla.');
  return position;
}

/**
 * Overi, ze vsetky ODKAZOVANE objekty patria organizacii z relacie (B2).
 * Bez toho by sa dal cudzi objekt pripojit cez jeho ID (nadradeny proces,
 * suvisiaci proces, pozicia, zlozka) a jeho nazov by sa potom vratil vo vypise.
 */
async function assertOwnedIds(
  model: 'processNode' | 'orgPosition' | 'orgUnit' | 'jobProfile' | 'person' | 'itSystem',
  organizationId: string,
  ids: unknown[]
): Promise<string[]> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return unique;
  const count = await (prisma[model] as any).count({ where: { id: { in: unique }, organizationId } });
  if (count !== unique.length) throw new HttpError(404, 'Odkazovany objekt sa nenasiel.');
  return unique;
}

/**
 * Strom bez cyklov (#12): nastavenie rodica `parentId` uzlu `nodeId` nesmie
 * urobit uzol predkom seba sama. parentOf = mapa id -> id rodica v ramci firmy.
 */
function assertAcyclic(nodeId: string, parentId: string, parentOf: Map<string, string | null>, message: string): void {
  let current: string | null = parentId;
  for (let steps = 0; current && steps <= parentOf.size; steps++) {
    if (current === nodeId) throw new HttpError(400, message);
    current = parentOf.get(current) ?? null;
  }
}

async function requireUnit(request: express.Request, unitId: string) {
  const unit = await prisma.orgUnit.findFirst({
    where: { id: unitId, organizationId: orgScope(request) }
  });
  if (!unit) throw new HttpError(404, 'Zlozka sa nenasla.');
  return unit;
}

// --- Meranie uloziska a kvoty (#8, #9) ---

/**
 * Spotreba uloziska organizacie.
 *
 * Pocita sa REALNA velkost nahratych suborov (Attachment.sizeBytes = zapisane bajty),
 * nie velkost ulozenia — starsie prilohy v DB su base64, ktory je o ~33 % vacsi,
 * a zakaznik nema platit za sposob ulozenia.
 *
 * Do kvoty sa ZAPOCITAVAJU: vsetky prilohy organizacie (procesne aj volne).
 * NEZAPOCITAVAJU sa: BPMN diagramy a ulozene verzie procesov — su to kratke
 * textove polia radovo v kilobajtoch, ulozene priamo v zazname procesu.
 * Kos neexistuje: mazanie je okamzite a spotrebu hned znizi.
 */
async function storageUsage(organizationId: string): Promise<{
  usedBytes: number;
  quotaBytes: number;
  documentCount: number;
}> {
  const [aggregate, organization] = await Promise.all([
    prisma.attachment.aggregate({
      where: { organizationId },
      _sum: { sizeBytes: true },
      _count: true
    }),
    prisma.organization.findUnique({ where: { id: organizationId } })
  ]);

  return {
    usedBytes: aggregate._sum.sizeBytes ?? 0,
    quotaBytes: (organization?.storageQuotaMb ?? 1024) * 1024 * 1024,
    documentCount: aggregate._count ?? 0
  };
}

/** Odmietne ulozenie, ak by subor prekrocil kvotu (#9). Kontrola BEZ zapisu. */
async function assertStorageAvailable(organizationId: string, incomingBytes: number): Promise<void> {
  const { usedBytes, quotaBytes } = await storageUsage(organizationId);
  if (usedBytes + incomingBytes > quotaBytes) {
    const volne = Math.max(0, quotaBytes - usedBytes);
    throw new HttpError(
      413,
      `Prekrocena kapacita uloziska. Volnych ${(volne / 1024 / 1024).toFixed(1)} MB ` +
      `z ${(quotaBytes / 1024 / 1024).toFixed(0)} MB, subor ma ${(incomingBytes / 1024 / 1024).toFixed(1)} MB.`
    );
  }
}

// Frontend roly (RoleId) <-> Prisma OrganizationRole
const ROLE_TO_DB: Record<string, OrganizationRole> = {
  owner: OrganizationRole.OWNER,
  admin: OrganizationRole.ADMIN,
  quality: OrganizationRole.MANAGER,
  approver: OrganizationRole.MODELER,
  iso: OrganizationRole.AUDITOR
};

const ROLE_FROM_DB: Record<OrganizationRole, string> = {
  [OrganizationRole.OWNER]: 'owner',
  [OrganizationRole.ADMIN]: 'admin',
  [OrganizationRole.MANAGER]: 'quality',
  [OrganizationRole.MODELER]: 'approver',
  [OrganizationRole.AUDITOR]: 'iso',
  [OrganizationRole.VIEWER]: 'approver'
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organizacia';
}

/**
 * Kazdy clen firmy ma osobu v adresari (#13). Ak uz v adresari je osoba s tym
 * istym emailom bez uctu (zaevidovana skor), ucet sa prepoji s nou — jej
 * obsadenia miest a historia ostanu.
 */
async function linkPerson(tx: any, organizationId: string, user: { id: string; name: string; email: string }) {
  const linked = await tx.person.findFirst({ where: { organizationId, userId: user.id } });
  if (linked) return linked;
  const byEmail = await tx.person.findFirst({
    where: { organizationId, userId: null, email: { equals: user.email, mode: 'insensitive' } }
  });
  if (byEmail) return tx.person.update({ where: { id: byEmail.id }, data: { userId: user.id, active: true } });
  return tx.person.create({ data: { organizationId, userId: user.id, name: user.name, email: user.email } });
}

function mapMember(membership: any) {
  return {
    id: membership.user.id,
    organizationId: membership.organizationId,
    name: membership.user.name,
    email: membership.user.email,
    roleId: ROLE_FROM_DB[membership.role as OrganizationRole] ?? 'approver',
    active: true,
    status: 'active',
    // pozicie = aktivne obsadenia osoby prepojenej s uctom (#13, #14)
    positions: (membership.user.persons?.[0]?.assignments ?? []).map((assignment: any) => ({
      id: assignment.position.id,
      name: assignment.position.name
    }))
  };
}

function mapOrganization(organization: any, ownerUserId: string) {
  return {
    id: organization.id,
    name: organization.name,
    ownerUserId,
    createdAt: organization.createdAt.toISOString().slice(0, 10),
    // #37 — verzie procesov sa zverejnuju len schvalenim
    requireApproval: Boolean(organization.requireApproval),
    // #40 — profil Kvalita a audit (kontrolne otazky, pripravenost evidencie)
    qualityProfile: Boolean(organization.qualityProfile)
  };
}

function mapInvitation(invitation: any) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    roleId: ROLE_FROM_DB[invitation.role as OrganizationRole] ?? 'approver',
    status: invitation.status.toLowerCase(),
    token: invitation.token,
    createdAt: invitation.createdAt.toISOString().slice(0, 10),
    expiresAt: invitation.expiresAt.toISOString().slice(0, 10)
  };
}

app.post('/api/register', async (request, response, next) => {
  try {
    const { organizationName, ownerName, email, password } = request.body ?? {};
    if (!organizationName || !ownerName || !email || !password) {
      throw new HttpError(400, 'organizationName, ownerName, email a password su povinne');
    }
    assertUserPassword(password);
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new HttpError(409, 'Pouzivatel s tymto emailom uz existuje. Prihlas sa.');
    }

    const slugBase = slugify(organizationName);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: ownerName,
          passwordHash: hashPassword(password)
        }
      });
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          slug: `${slugBase}-${Date.now()}`
        }
      });
      await tx.organizationUser.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: OrganizationRole.OWNER,
          isOwner: true
        }
      });
      await linkPerson(tx, organization.id, user);
      return { user, organization };
    });

    const token = await createSession(result.user.id, result.organization.id);
    // #20 — overovaci email; registraciu neblokuje, ak sa nepodari zaradit do fronty
    await sendVerificationEmail(result.user).catch((error) => logError('email', error, response.locals['requestId']));

    response.status(201).json({
      token,
      user: {
        id: result.user.id,
        organizationId: result.organization.id,
        name: result.user.name,
        email: result.user.email,
        roleId: 'owner',
        emailVerified: false,
        active: true,
        status: 'active'
      },
      organization: mapOrganization(result.organization, result.user.id)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/login', rateLimitLogin, async (request, response, next) => {
  try {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      throw new HttpError(400, 'email a password su povinne');
    }
    const user = await prisma.user.findUnique({
      where: { email: String(email).toLowerCase() },
      include: {
        organizations: {
          orderBy: { createdAt: 'asc' },
          include: { organization: true }
        }
      }
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Nespravny email alebo heslo.');
    }
    // #20 — ked uz budu emaily dorucovane, da sa prihlasenie bez overenia zakazat
    if (process.env['REQUIRE_EMAIL_VERIFICATION'] === 'true' && !user.emailVerifiedAt) {
      throw new HttpError(403, 'Najprv potvrdte svoj e-mail — odkaz sme poslali pri registracii.');
    }
    const membership = user.organizations[0];
    if (!membership) {
      throw new HttpError(403, 'Pouzivatel nie je clenom ziadnej organizacie.');
    }
    const owner = await prisma.organizationUser.findFirst({
      where: { organizationId: membership.organizationId, isOwner: true }
    });
    const token = await createSession(user.id, membership.organizationId);

    response.json({
      token,
      user: {
        id: user.id,
        organizationId: membership.organizationId,
        name: user.name,
        email: user.email,
        roleId: ROLE_FROM_DB[membership.role] ?? 'approver',
        emailVerified: Boolean(user.emailVerifiedAt),
        active: true,
        status: 'active'
      },
      organization: mapOrganization(membership.organization, owner?.userId ?? user.id)
    });
  } catch (error) {
    next(error);
  }
});

// #5 — odhlasenie zneplatni relaciu na serveri
app.post('/api/logout', async (request, response, next) => {
  try {
    await prisma.session.delete({ where: { id: auth(request).sessionId } }).catch(() => undefined);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// --- #20 overenie emailu a obnova hesla ---

/** Minimalna dlzka hesla pouzivatela (registracia, pozvanka, obnova). */
const MIN_USER_PASSWORD = 10; // rovnako ako v registracnom formulari

function assertUserPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_USER_PASSWORD) {
    throw new HttpError(400, `Heslo musi mat aspon ${MIN_USER_PASSWORD} znakov.`);
  }
  return password;
}

const AUTH_TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  [AuthTokenType.EMAIL_VERIFY]: 48 * 60 * 60 * 1000,
  [AuthTokenType.PASSWORD_RESET]: 60 * 60 * 1000
};

/**
 * Vyda jednorazovy token. Predchadzajuce nepouzite tokeny rovnakeho typu sa
 * zneplatnia — plati vzdy len najnovsi odkaz. V DB je len hash.
 */
async function issueAuthToken(userId: string, type: AuthTokenType): Promise<string> {
  await prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomBytes(32).toString('base64url');
  await prisma.authToken.create({
    data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + AUTH_TOKEN_TTL_MS[type]) }
  });
  return token;
}

/** Pouzije token (len raz — aj pri dvoch sucasnych poziadavkach). Vrati userId. */
async function consumeAuthToken(token: unknown, type: AuthTokenType): Promise<string> {
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'Odkaz je neplatny.');
  const stored = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!stored || stored.type !== type || stored.usedAt) {
    throw new HttpError(400, 'Odkaz je neplatny alebo uz bol pouzity.');
  }
  if (stored.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'Platnost odkazu vyprsala. Vyziadajte si novy.');
  const claimed = await prisma.authToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(400, 'Odkaz uz bol pouzity.');
  return stored.userId;
}

async function sendVerificationEmail(user: { id: string; name: string; email: string }): Promise<void> {
  const token = await issueAuthToken(user.id, AuthTokenType.EMAIL_VERIFY);
  await queueEmail(user.email, 'email-verify', { name: user.name, link: `${APP_URL}/overenie-emailu?token=${token}` });
}

app.post('/api/auth/verify-email', async (request, response, next) => {
  try {
    const userId = await consumeAuthToken(request.body?.token, AuthTokenType.EMAIL_VERIFY);
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/resend-verification', async (request, response, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: auth(request).userId } });
    if (!user) throw new HttpError(404, 'Pouzivatel sa nenasiel.');
    if (user.emailVerifiedAt) {
      response.json({ ok: true, alreadyVerified: true });
      return;
    }
    await sendVerificationEmail(user);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Ziadost o obnovu hesla. Odpoved je VZDY rovnaka — inak by sa dalo zistit,
 * ci email v systeme existuje.
 */
app.post('/api/auth/forgot-password', rateLimitLogin, async (request, response, next) => {
  try {
    const email = String(request.body?.email ?? '').trim().toLowerCase();
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (user) {
      const token = await issueAuthToken(user.id, AuthTokenType.PASSWORD_RESET);
      await queueEmail(user.email, 'password-reset', { name: user.name, link: `${APP_URL}/obnova-hesla?token=${token}` });
    }
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/reset-password', rateLimitLogin, async (request, response, next) => {
  try {
    const password = assertUserPassword(request.body?.password);
    const userId = await consumeAuthToken(request.body?.token, AuthTokenType.PASSWORD_RESET);
    await prisma.user.update({
      where: { id: userId },
      // odkaz prisiel na email — tym je vlastnictvo emailu overene
      data: { passwordHash: hashPassword(password), emailVerifiedAt: new Date() }
    });
    // odhlasit vsade: ak niekto heslo poznal, jeho relacia tu konci
    await prisma.session.deleteMany({ where: { userId } });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/organizations/:organizationId', async (request, response, next) => {
  try {
    const organization = await prisma.organization.update({
      where: { id: orgScope(request) },
      data: {
        name: request.body.name ?? undefined,
        requireApproval: typeof request.body.requireApproval === 'boolean' ? request.body.requireApproval : undefined,
        qualityProfile: typeof request.body.qualityProfile === 'boolean' ? request.body.qualityProfile : undefined
      }
    });
    const owner = await prisma.organizationUser.findFirst({
      where: { organizationId: organization.id, isOwner: true }
    });
    response.json(mapOrganization(organization, owner?.userId ?? ''));
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/users', async (request, response, next) => {
  try {
    const memberships = await prisma.organizationUser.findMany({
      where: { organizationId: orgScope(request) },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          include: {
            persons: {
              where: { organizationId: orgScope(request) },
              include: { assignments: { where: activeOn(today()), include: { position: { select: { id: true, name: true } } } } }
            }
          }
        }
      }
    });
    response.json(memberships.map(mapMember));
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/invitations', async (request, response, next) => {
  try {
    const invitations = await prisma.invitation.findMany({
      where: { organizationId: orgScope(request) },
      orderBy: { createdAt: 'desc' }
    });
    response.json(invitations.map(mapInvitation));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/invitations', async (request, response, next) => {
  try {
    const { email, roleId } = request.body ?? {};
    if (!email) {
      throw new HttpError(400, 'email je povinny');
    }
    // rolu vlastnika moze pridelit len vlastnik — admin by si inak cez pozvanku
    // vytvoril ucet s vyssimi pravami, nez ma sam
    if (roleId === 'owner' && auth(request).role !== OrganizationRole.OWNER) {
      throw new HttpError(403, 'Rolu vlastnika moze pridelit len vlastnik firmy.');
    }
    const organization = await prisma.organization.findUnique({ where: { id: orgScope(request) } });
    if (!organization) {
      throw new HttpError(404, 'Organizacia neexistuje');
    }
    // R11: email uz je clenom organizacie
    const existingMember = await prisma.organizationUser.findFirst({
      where: {
        organizationId: organization.id,
        user: { email: String(email).toLowerCase() }
      }
    });
    if (existingMember) {
      throw new HttpError(409, 'Pouzivatel s tymto emailom uz je clenom organizacie.');
    }
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: organization.id,
        email: String(email).toLowerCase(),
        token: randomBytes(24).toString('hex'),
        role: ROLE_TO_DB[roleId] ?? OrganizationRole.VIEWER,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      }
    });
    response.status(201).json(mapInvitation(invitation));
  } catch (error) {
    next(error);
  }
});

app.get('/api/invitations/:token', async (request, response, next) => {
  try {
    const invitation = await prisma.invitation.findUnique({
      where: { token: request.params.token },
      include: { organization: true }
    });
    if (!invitation) {
      throw new HttpError(404, 'Pozvanka neexistuje');
    }
    response.json({
      ...mapInvitation(invitation),
      organizationName: invitation.organization.name,
      expired: invitation.expiresAt.getTime() < Date.now()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/invitations/:token/accept', rateLimitLogin, async (request, response, next) => {
  try {
    const { name, password } = request.body ?? {};
    if (!name || !password) {
      throw new HttpError(400, 'name a password su povinne');
    }
    const invitation = await prisma.invitation.findUnique({
      where: { token: String(request.params.token) },
      include: { organization: true }
    });
    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new HttpError(404, 'Pozvanka neexistuje alebo uz bola pouzita.');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.EXPIRED } });
      throw new HttpError(410, 'Pozvanka expirovala.');
    }

    // existujuci ucet sa pripaja LEN so svojim heslom — inak by drzitel odkazu
    // na pozvanku ziskal relaciu cudzieho uctu bez hesla
    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
    if (existingUser && !verifyPassword(String(password), existingUser.passwordHash)) {
      throw new HttpError(401, 'Ucet s tymto emailom uz existuje. Zadajte jeho heslo.');
    }
    if (!existingUser) {
      assertUserPassword(password);
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = existingUser ?? await tx.user.create({
        data: {
          email: invitation.email,
          name,
          passwordHash: hashPassword(password)
        }
      });
      const membership = await tx.organizationUser.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
        update: { role: invitation.role },
        create: {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role
        }
      });
      await linkPerson(tx, invitation.organizationId, user);
      await tx.invitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.ACCEPTED } });
      return { user, membership };
    });

    const owner = await prisma.organizationUser.findFirst({
      where: { organizationId: invitation.organizationId, isOwner: true }
    });
    // #1 — bez tokenu by novy kolega po prijati pozvanky dostal hned 401
    const token = await createSession(result.user.id, invitation.organizationId);
    if (!result.user.emailVerifiedAt) {
      await sendVerificationEmail(result.user).catch((error) => logError('email', error, response.locals['requestId']));
    }
    response.json({
      token,
      user: {
        id: result.user.id,
        organizationId: invitation.organizationId,
        name: result.user.name,
        email: result.user.email,
        roleId: ROLE_FROM_DB[result.membership.role] ?? 'approver',
        emailVerified: Boolean(result.user.emailVerifiedAt),
        active: true,
        status: 'active'
      },
      organization: mapOrganization(invitation.organization, owner?.userId ?? '')
    });
  } catch (error) {
    next(error);
  }
});

// --- R11: realtime validacia registracie ---

app.get('/api/check/email', async (request, response, next) => {
  try {
    const value = String(request.query['value'] ?? '').toLowerCase().trim();
    if (!value) {
      response.json({ available: false });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: value } });
    response.json({ available: !user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/check/org-name', async (request, response, next) => {
  try {
    const value = String(request.query['value'] ?? '').trim();
    if (!value) {
      response.json({ available: false });
      return;
    }
    const organization = await prisma.organization.findFirst({
      where: { name: { equals: value, mode: 'insensitive' } }
    });
    response.json({ available: !organization });
  } catch (error) {
    next(error);
  }
});

// --- R1: pracovne pozicie ---

function mapOrgPosition(position: any) {
  return {
    id: position.id,
    organizationId: position.organizationId,
    unitId: position.unitId ?? null,
    unitName: position.unit?.name ?? null,
    reportsToId: position.reportsToId ?? null,
    reportsToName: position.reportsTo?.name ?? null,
    jobProfileId: position.jobProfileId ?? null,
    jobProfileName: position.jobProfile?.name ?? null,
    name: position.name,
    description: position.description ?? '',
    createdAt: position.createdAt.toISOString().slice(0, 10),
    // #14 — kto miesto dnes zastava; prazdne = neobsadene miesto
    holders: (position.assignments ?? []).map((assignment: any) => ({
      assignmentId: assignment.id,
      personId: assignment.personId,
      name: assignment.person?.name ?? '',
      validFrom: day(assignment.validFrom),
      validTo: day(assignment.validTo)
    })),
    vacant: (position.assignments ?? []).length === 0,
    // #43 — archivovane miesto sa neponuka na nove vazby
    archived: Boolean(position.archivedAt),
    archivedAt: position.archivedAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: BUSINESS_TIMEZONE }).format(position.archivedAt) : null
  };
}

function mapOrgUnit(unit: any) {
  return {
    id: unit.id,
    organizationId: unit.organizationId,
    parentId: unit.parentId ?? null,
    name: unit.name,
    description: unit.description ?? '',
    sortOrder: unit.sortOrder ?? 0,
    positionCount: unit._count?.positions ?? (unit.positions?.length ?? 0)
  };
}

// funkcia, nie konstanta — "dnes" sa musi vyhodnotit pri kazdej poziadavke
function positionInclude() {
  return {
    assignments: { where: activeOn(today()), include: { person: { select: { name: true } } } },
    unit: { select: { name: true } },
    reportsTo: { select: { name: true } },
    jobProfile: { select: { name: true } }
  };
}

const UNIT_INCLUDE = { _count: { select: { positions: true } } };

/**
 * Nadradena zlozka (#12): musi patrit firme a nesmie vzniknut cyklus.
 * undefined = bez zmeny, null = korenova zlozka.
 */
async function resolveUnitParent(organizationId: string, unitId: string | null, parentId: unknown) {
  if (parentId === undefined) return undefined;
  if (!parentId) return null;
  const [id] = await assertOwnedIds('orgUnit', organizationId, [parentId]);
  if (unitId) {
    const units = await prisma.orgUnit.findMany({ where: { organizationId }, select: { id: true, parentId: true } });
    assertAcyclic(unitId, id, new Map(units.map((unit) => [unit.id, unit.parentId])),
      'Zlozka nemoze byt podriadena sama sebe ani svojej podriadenej zlozke.');
  }
  return id;
}

/** Nadriadene miesto (#12) — rovnake pravidla ako pri zlozkach. */
async function resolveReportsTo(organizationId: string, positionId: string | null, reportsToId: unknown) {
  if (reportsToId === undefined) return undefined;
  if (!reportsToId) return null;
  const [id] = await assertOwnedIds('orgPosition', organizationId, [reportsToId]);
  if (positionId) {
    const positions = await prisma.orgPosition.findMany({ where: { organizationId }, select: { id: true, reportsToId: true } });
    assertAcyclic(positionId, id, new Map(positions.map((position) => [position.id, position.reportsToId])),
      'Miesto nemoze byt nadriadene samo sebe ani svojmu podriadenemu.');
  }
  return id;
}

/** Zaradenie miesta do zlozky — len zlozka vlastnej firmy. */
async function resolvePositionUnit(organizationId: string, unitId: unknown) {
  if (unitId === undefined) return undefined;
  if (!unitId) return null;
  const [id] = await assertOwnedIds('orgUnit', organizationId, [unitId]);
  return id;
}

// --- organizacne zlozky (utvary) ---

app.get('/api/organizations/:organizationId/units', async (request, response, next) => {
  try {
    const units = await prisma.orgUnit.findMany({
      where: { organizationId: orgScope(request) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: UNIT_INCLUDE
    });
    response.json(units.map(mapOrgUnit));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/units', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const { name, description, parentId } = request.body ?? {};
    if (!name?.trim()) throw new HttpError(400, 'name je povinny');
    const existing = await prisma.orgUnit.findFirst({
      where: { organizationId, name: { equals: name.trim(), mode: 'insensitive' } }
    });
    if (existing) throw new HttpError(409, 'Zlozka s tymto nazvom uz existuje.');
    const unit = await prisma.orgUnit.create({
      data: {
        organizationId,
        name: name.trim(),
        description: description?.trim() || null,
        parentId: (await resolveUnitParent(organizationId, null, parentId)) ?? null
      },
      include: UNIT_INCLUDE
    });
    response.status(201).json(mapOrgUnit(unit));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/units/:unitId', async (request, response, next) => {
  try {
    const current = await requireUnit(request, request.params.unitId);
    const unit = await prisma.orgUnit.update({
      where: { id: current.id },
      data: {
        name: request.body.name?.trim() || undefined,
        description: request.body.description === undefined ? undefined : (request.body.description?.trim() || null),
        sortOrder: request.body.sortOrder === undefined ? undefined : Number(request.body.sortOrder),
        parentId: await resolveUnitParent(current.organizationId, current.id, request.body.parentId)
      },
      include: UNIT_INCLUDE
    });
    response.json(mapOrgUnit(unit));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/units/:unitId', async (request, response, next) => {
  try {
    const unit = await requireUnit(request, request.params.unitId);
    // podriadene zlozky sa posunu o uroven vyssie, strom sa nerozpadne;
    // pozicie ostavaju, len stratia zaradenie (onDelete: SetNull)
    // interaktivna transakcia: dotazy idu po jednom na jednom spojeni
    // (davkova forma posiela cez driver adapter viac dotazov naraz)
    await prisma.$transaction(async (tx) => {
      await tx.orgUnit.updateMany({ where: { parentId: unit.id }, data: { parentId: unit.parentId } });
      await tx.orgUnit.delete({ where: { id: unit.id } });
    });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/positions', async (request, response, next) => {
  try {
    const positions = await prisma.orgPosition.findMany({
      where: { organizationId: orgScope(request) },
      orderBy: { name: 'asc' },
      include: positionInclude()
    });
    response.json(positions.map(mapOrgPosition));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/positions', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const { name, description, unitId, reportsToId } = request.body ?? {};
    if (!name) throw new HttpError(400, 'name je povinny');
    const existing = await prisma.orgPosition.findFirst({
      where: { organizationId, name: { equals: name, mode: 'insensitive' } }
    });
    if (existing) throw new HttpError(409, 'Pozicia s tymto nazvom uz existuje.');
    const position = await prisma.orgPosition.create({
      data: {
        organizationId,
        name,
        description: description || null,
        unitId: (await resolvePositionUnit(organizationId, unitId)) ?? null,
        reportsToId: (await resolveReportsTo(organizationId, null, reportsToId)) ?? null,
        jobProfileId: (await assertOwnedIds('jobProfile', organizationId, [request.body?.jobProfileId]))[0] ?? null
      },
      include: positionInclude()
    });
    response.status(201).json(mapOrgPosition(position));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/positions/:positionId', async (request, response, next) => {
  try {
    const current = await requirePosition(request, request.params.positionId);
    const position = await prisma.orgPosition.update({
      where: { id: current.id },
      data: {
        name: request.body.name ?? undefined,
        description: request.body.description === undefined ? undefined : (request.body.description || null),
        unitId: await resolvePositionUnit(current.organizationId, request.body.unitId),
        reportsToId: await resolveReportsTo(current.organizationId, current.id, request.body.reportsToId),
        jobProfileId: request.body.jobProfileId === undefined
          ? undefined
          : ((await assertOwnedIds('jobProfile', current.organizationId, [request.body.jobProfileId]))[0] ?? null)
      },
      include: positionInclude()
    });
    response.json(mapOrgPosition(position));
  } catch (error) {
    next(error);
  }
});

// --- #43 GRAPH-01 dopad zmeny miesta, archivacia namiesto mazania ---

/**
 * Co od miesta zavisi: procesy (vlastnik, vykonavatel, RACI krokov) v navrhu,
 * platne a naplanovane verzie, ktore ho maju v snapshote, ludia, ktori ho dnes
 * zastavaju, a dokumenty, ktorych je vlastnikom.
 */
async function positionImpact(organizationId: string, positionId: string) {
  const now = today();
  const [links, steps, holders, documents, versions] = await Promise.all([
    prisma.processPosition.findMany({ where: { positionId }, select: { role: true, processNode: { select: { id: true, name: true, code: true } } } }),
    prisma.activityResponsibility.findMany({
      where: { positionId },
      select: { role: true, activity: { select: { title: true, sortOrder: true, processNode: { select: { id: true, name: true, code: true } } } } }
    }),
    prisma.positionAssignment.findMany({ where: { positionId, ...activeOn(now) }, select: { id: true, validFrom: true, person: { select: { name: true } } } }),
    prisma.controlledDocument.findMany({ where: { ownerPositionId: positionId }, select: { id: true, title: true } }),
    prisma.$queryRaw<Array<{ processNodeId: string; revision: number; name: string; effectiveFrom: Date }>>`
      SELECT v."processNodeId", v.revision, v.snapshot->>'name' AS name, v."effectiveFrom"
      FROM "ProcessVersion" v
      WHERE v."organizationId" = ${organizationId}
        AND (v."effectiveTo" IS NULL OR v."effectiveTo" >= ${now})
        AND (
          COALESCE(v.snapshot->'responsibilities', '[]'::jsonb) @> ${JSON.stringify([{ positionId }])}::jsonb
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v.snapshot->'activities', '[]'::jsonb)) a
                     WHERE COALESCE(a->'raci', '[]'::jsonb) @> ${JSON.stringify([{ positionId }])}::jsonb)
        )
      ORDER BY name, v.revision`
  ]);
  const processes = new Map<string, { id: string; name: string; code: string; roles: string[]; ownerLost: boolean }>();
  const entry = (node: { id: string; name: string; code: string | null }) => {
    const item = processes.get(node.id) ?? { id: node.id, name: node.name, code: node.code ?? '', roles: [], ownerLost: false };
    processes.set(node.id, item);
    return item;
  };
  for (const link of links) {
    const item = entry(link.processNode);
    item.roles.push(link.role === ResponsibilityRole.OWNER ? 'vlastník' : 'vykonávateľ');
    if (link.role === ResponsibilityRole.OWNER) item.ownerLost = true;
  }
  for (const step of steps) {
    entry(step.activity.processNode).roles.push(`krok ${step.activity.sortOrder + 1} „${step.activity.title}“ (${RACI_CODE[step.role]})`);
  }
  return {
    holders: holders.map((holder) => ({ assignmentId: holder.id, name: holder.person.name, validFrom: day(holder.validFrom) })),
    processes: [...processes.values()].sort((a, b) => a.name.localeCompare(b.name, 'sk')),
    // po archivacii bude tieto procesy treba dat novemu vlastnikovi
    ownerless: [...processes.values()].filter((item) => item.ownerLost).map((item) => item.name),
    versions: versions.map((version) => ({ processId: version.processNodeId, name: version.name, revision: version.revision, scheduled: version.effectiveFrom > now })),
    documents
  };
}

app.get('/api/positions/:positionId/impact', async (request, response, next) => {
  try {
    const position = await requirePosition(request, request.params.positionId);
    response.json({ position: { id: position.id, name: position.name, archived: Boolean(position.archivedAt) }, ...(await positionImpact(position.organizationId, position.id)) });
  } catch (error) {
    next(error);
  }
});

/**
 * Archivacia miesta (scenar 8): az po potvrdeni dopadu. Obsadenie sa ukonci
 * vcerajskom (od dnes miesto nikto nezastava), vazby a historia ostavaju — vlastnik procesu sa
 * ticho nestrati, proces sa ukaze ako neobsadeny a editori dostanu upozornenie.
 */
app.post('/api/positions/:positionId/archive', async (request, response, next) => {
  try {
    const position = await requirePosition(request, request.params.positionId);
    if (position.archivedAt) throw new HttpError(409, 'Miesto uz je archivovane.');
    if (request.body?.confirm !== true) {
      throw new HttpError(400, 'Najprv si pozrite dopad archivacie (GET /positions/:id/impact) a potvrdte ho.');
    }
    const impact = await positionImpact(position.organizationId, position.id);
    const now = today();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await prisma.$transaction(async (tx) => {
      // od dnes miesto nikto nezastava: obsadenie sa ukonci vcerajskom;
      // obsadenie so zaciatkom dnes alebo neskor by nikdy nenastalo — zmaze sa
      await tx.positionAssignment.deleteMany({ where: { positionId: position.id, validFrom: { gte: now } } });
      await tx.positionAssignment.updateMany({
        where: { positionId: position.id, OR: [{ validTo: null }, { validTo: { gte: now } }] },
        data: { validTo: yesterday }
      });
      await tx.orgPosition.update({ where: { id: position.id }, data: { archivedAt: new Date() } });
      await emitEvent(tx, {
        organizationId: position.organizationId,
        type: 'PositionArchived',
        actorId: auth(request).userId,
        payload: { positionName: position.name, processCount: impact.processes.length, ownerless: impact.ownerless }
      });
    });
    kickDispatcher();
    response.json({ position: { id: position.id, name: position.name, archived: true }, ...impact });
  } catch (error) {
    next(error);
  }
});

app.post('/api/positions/:positionId/restore', async (request, response, next) => {
  try {
    const position = await requirePosition(request, request.params.positionId);
    await prisma.orgPosition.update({ where: { id: position.id }, data: { archivedAt: null } });
    response.json({ id: position.id, archived: false });
  } catch (error) {
    next(error);
  }
});

/** Nove vazby len na aktivne miesta; uz existujuce vazby na archivovane miesto mozu ostat. */
async function assertPositionsLinkable(organizationId: string, positionIds: string[], alreadyLinked: string[] = []) {
  const fresh = positionIds.filter((id) => !alreadyLinked.includes(id));
  if (fresh.length === 0) return;
  const archived = await prisma.orgPosition.findFirst({ where: { organizationId, id: { in: fresh }, archivedAt: { not: null } }, select: { name: true } });
  if (archived) throw new HttpError(400, `Miesto „${archived.name}“ je archivované — vyberte iné.`);
}

app.delete('/api/positions/:positionId', async (request, response, next) => {
  try {
    const position = await requirePosition(request, request.params.positionId);
    // #43 — pouzite miesto sa nemaze (vlastnik procesu by ticho zmizol, verzie by stratili nazov)
    const impact = await positionImpact(position.organizationId, position.id);
    const history = await prisma.positionAssignment.count({ where: { positionId: position.id } });
    if (impact.processes.length > 0 || impact.versions.length > 0 || impact.documents.length > 0 || history > 0) {
      throw new HttpError(409, `Miesto „${position.name}“ je použité (procesy: ${impact.processes.length}, obsadenia: ${history}) — archivujte ho, dopad uvidíte pred potvrdením.`);
    }
    // podriadene miesta prejdu pod nadriadeneho mazaneho miesta
    await prisma.$transaction(async (tx) => {
      await tx.orgPosition.updateMany({ where: { reportsToId: position.id }, data: { reportsToId: position.reportsToId } });
      await tx.orgPosition.delete({ where: { id: position.id } });
    });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- #45 CFG-01 vlastne polia procesu ---

type CustomFieldValue = string | number | boolean;
const FIELD_TYPES = ['text', 'longText', 'number', 'date', 'select', 'checkbox'] as const;
type FieldType = (typeof FIELD_TYPES)[number];
const MAX_PROCESS_FIELDS = 40;
const MAX_FIELD_OPTIONS = 50;

/** Hodnoty vlastnych poli z DB (Json) — len objekt s jednoduchymi hodnotami. */
function customFieldValues(value: unknown): Record<string, CustomFieldValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, CustomFieldValue] => ['string', 'number', 'boolean'].includes(typeof entry[1])));
}

/** Kluce zoradene — rovnaky obsah dava rovnaky odtlacok verzie. */
function sortedFieldValues(values: Record<string, CustomFieldValue>): Record<string, CustomFieldValue> {
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
}

function hasFieldValue(field: { type: string }, value: unknown): boolean {
  if (field.type === 'checkbox') return value === true;
  return value !== undefined && value !== null && value !== '';
}

/** Hodnota pola podla typu; null = pole bez hodnoty. */
function parseFieldValue(field: { label: string; type: string; options: string[] }, raw: unknown): CustomFieldValue | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const fail = (message: string): never => { throw new HttpError(400, `${field.label}: ${message}`); };
  switch (field.type as FieldType) {
    case 'text':
      return cleanText(raw, 500);
    case 'longText':
      return cleanText(raw, 5000);
    case 'number': {
      const number = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim());
      if (!Number.isFinite(number)) fail('zadajte číslo.');
      return number;
    }
    case 'date': {
      const text = String(raw).trim();
      const parsed = new Date(`${text}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail('zadajte dátum (RRRR-MM-DD).');
      return text;
    }
    case 'select': {
      const text = String(raw).trim();
      if (!field.options.includes(text)) fail(`vyberte jednu z možností (${field.options.join(', ')}).`);
      return text;
    }
    case 'checkbox':
      if (typeof raw !== 'boolean') fail('hodnota musí byť áno/nie.');
      // nezaskrtnute = bez hodnoty (povinne zaskrtnutie = potvrdenie)
      return raw ? true : null;
    default:
      return fail('neznámy typ poľa.');
  }
}

function describeFieldValue(field: { type: string }, value: CustomFieldValue | undefined): string {
  if (value === undefined) return '—';
  if (field.type === 'checkbox') return value === true ? 'áno' : '—';
  return String(value);
}

/**
 * Zmena vlastnych poli z PATCH procesu: meni sa len poslane pole, null alebo
 * prazdna hodnota ho vymaze. Pole inej firmy neexistuje (404); pole, ktore firma
 * uz nepouziva, sa da len vymazat.
 */
async function mergeCustomFields(organizationId: string, current: unknown, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'customFields musí byť objekt { pole: hodnota }.');
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_PROCESS_FIELDS) throw new HttpError(400, 'Priveľa polí naraz.');
  const fields = await prisma.processFieldDefinition.findMany({ where: { organizationId, id: { in: entries.map(([id]) => id) } } });
  const byId = new Map(fields.map((field) => [field.id, field]));
  const before = customFieldValues(current);
  const next = { ...before };
  const changes: { from: string[]; to: string[] } = { from: [], to: [] };
  for (const [id, raw] of entries) {
    const field = byId.get(id);
    if (!field) throw new HttpError(404, 'Pole sa nenašlo.');
    const value = parseFieldValue(field, raw);
    if (value === null) delete next[id];
    else {
      if (field.archivedAt && next[id] !== value) throw new HttpError(400, `Pole „${field.label}“ už firma nepoužíva — hodnotu možno len vymazať.`);
      next[id] = value;
    }
    if (before[id] !== next[id]) {
      changes.from.push(`${field.label}: ${describeFieldValue(field, before[id])}`);
      changes.to.push(`${field.label}: ${describeFieldValue(field, next[id])}`);
    }
  }
  return { values: sortedFieldValues(next), changes };
}

function mapProcessField(field: any, usage = 0) {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    options: field.options ?? [],
    required: Boolean(field.required),
    helpText: field.helpText ?? '',
    sortOrder: field.sortOrder,
    archived: Boolean(field.archivedAt),
    /** kolko procesov (navrh) ma pole vyplnene */
    usage
  };
}

async function requireProcessField(request: express.Request, fieldId: string) {
  const field = await prisma.processFieldDefinition.findFirst({ where: { id: fieldId, organizationId: orgScope(request) } });
  if (!field) throw new HttpError(404, 'Pole sa nenašlo.');
  return field;
}

function fieldOptions(value: unknown, type: string): string[] {
  if (type !== 'select') return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'Pole s výberom potrebuje zoznam možností.');
  const options = [...new Set(value.map((item) => cleanText(item, 120)).filter((item): item is string => Boolean(item)))];
  if (options.length === 0) throw new HttpError(400, 'Pole s výberom potrebuje aspoň jednu možnosť.');
  if (options.length > MAX_FIELD_OPTIONS) throw new HttpError(400, `Najviac ${MAX_FIELD_OPTIONS} možností.`);
  return options;
}

/** Kolko procesov ma pole vyplnene — v navrhu; pri mazani aj vo verziach. */
async function processFieldUsage(organizationId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ key: string; count: bigint }>>`
    SELECT f.key, count(*) AS count FROM "ProcessNode" n, jsonb_object_keys(n."customFields") f(key)
    WHERE n."organizationId" = ${organizationId} AND jsonb_typeof(n."customFields") = 'object'
    GROUP BY f.key`;
  return new Map(rows.map((row) => [row.key, Number(row.count)]));
}

async function fieldUsedInVersions(organizationId: string, fieldId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT v.id FROM "ProcessVersion" v
    WHERE v."organizationId" = ${organizationId} AND jsonb_typeof(v.snapshot->'customFields') = 'object'
      AND v.snapshot->'customFields' ? ${fieldId}
    LIMIT 1`;
  return rows.length > 0;
}

app.get('/api/organizations/:organizationId/process-fields', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const [fields, usage] = await Promise.all([
      prisma.processFieldDefinition.findMany({ where: { organizationId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      processFieldUsage(organizationId)
    ]);
    response.json(fields.map((field) => mapProcessField(field, usage.get(field.id) ?? 0)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/process-fields', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const body = request.body ?? {};
    const label = cleanText(body.label, 120);
    if (!label) throw new HttpError(400, 'Zadajte názov poľa.');
    const type = String(body.type ?? '');
    if (!(FIELD_TYPES as readonly string[]).includes(type)) throw new HttpError(400, `Typ poľa: ${FIELD_TYPES.join(', ')}.`);
    const count = await prisma.processFieldDefinition.count({ where: { organizationId, archivedAt: null } });
    if (count >= MAX_PROCESS_FIELDS) throw new HttpError(400, `Firma môže mať najviac ${MAX_PROCESS_FIELDS} vlastných polí.`);
    const clash = await prisma.processFieldDefinition.findFirst({ where: { organizationId, archivedAt: null, label: { equals: label, mode: 'insensitive' } } });
    if (clash) throw new HttpError(409, `Pole „${label}“ už existuje.`);
    const last = await prisma.processFieldDefinition.findFirst({ where: { organizationId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const field = await prisma.processFieldDefinition.create({
      data: {
        organizationId,
        label,
        type,
        options: fieldOptions(body.options, type),
        required: body.required === true,
        helpText: cleanText(body.helpText, 300),
        sortOrder: (last?.sortOrder ?? -1) + 1
      }
    });
    response.status(201).json(mapProcessField(field));
  } catch (error) {
    next(error);
  }
});

app.put('/api/organizations/:organizationId/process-fields/order', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const ids = Array.isArray(request.body?.ids) ? request.body.ids : null;
    if (!ids) throw new HttpError(400, 'ids musí byť zoznam polí v novom poradí.');
    const owned = await prisma.processFieldDefinition.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } });
    if (owned.length !== new Set(ids).size) throw new HttpError(404, 'Pole sa nenašlo.');
    await prisma.$transaction(async (tx) => {
      for (const [index, id] of (ids as string[]).entries()) await tx.processFieldDefinition.update({ where: { id }, data: { sortOrder: index } });
    });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.patch('/api/process-fields/:fieldId', async (request, response, next) => {
  try {
    const field = await requireProcessField(request, request.params.fieldId);
    const body = request.body ?? {};
    // typ sa nemeni — existujuce hodnoty by prestali davat zmysel
    if (body.type !== undefined && body.type !== field.type) throw new HttpError(400, 'Typ poľa sa nedá zmeniť — založte nové pole.');
    const label = body.label === undefined ? undefined : cleanText(body.label, 120);
    if (body.label !== undefined && !label) throw new HttpError(400, 'Zadajte názov poľa.');
    if (label) {
      const clash = await prisma.processFieldDefinition.findFirst({
        where: { organizationId: field.organizationId, archivedAt: null, id: { not: field.id }, label: { equals: label, mode: 'insensitive' } }
      });
      if (clash) throw new HttpError(409, `Pole „${label}“ už existuje.`);
    }
    const updated = await prisma.processFieldDefinition.update({
      where: { id: field.id },
      data: {
        label: label ?? undefined,
        options: body.options === undefined ? undefined : fieldOptions(body.options, field.type),
        required: typeof body.required === 'boolean' ? body.required : undefined,
        helpText: body.helpText === undefined ? undefined : cleanText(body.helpText, 300),
        archivedAt: typeof body.archived === 'boolean' ? (body.archived ? (field.archivedAt ?? new Date()) : null) : undefined
      }
    });
    response.json(mapProcessField(updated, (await processFieldUsage(field.organizationId)).get(field.id) ?? 0));
  } catch (error) {
    next(error);
  }
});

/** Pole s hodnotami (v navrhu alebo vo verzii) sa nemaze — archivuje sa a hodnoty ostanu. */
app.delete('/api/process-fields/:fieldId', async (request, response, next) => {
  try {
    const field = await requireProcessField(request, request.params.fieldId);
    const used = ((await processFieldUsage(field.organizationId)).get(field.id) ?? 0) > 0 || await fieldUsedInVersions(field.organizationId, field.id);
    if (used) {
      const archived = await prisma.processFieldDefinition.update({ where: { id: field.id }, data: { archivedAt: field.archivedAt ?? new Date() } });
      response.json({ ...mapProcessField(archived), message: 'Pole má hodnoty — je archivované, hodnoty v procesoch a verziách ostali.' });
      return;
    }
    await prisma.processFieldDefinition.delete({ where: { id: field.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- #42 AI-01 / #41 IMP-01 — AI asistent, navrh procesu z textu, import dokumentov ---

const AI_HOURLY_LIMIT = Number(process.env['AI_HOURLY_LIMIT'] ?? 30);
const aiUsage = new Map<string, { count: number; resetAt: number }>();
const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;

function aiKeyFor(organization: { aiApiKeyEnc: string | null }): string {
  return (organization.aiApiKeyEnc ? decryptSecret(organization.aiApiKeyEnc) : null) ?? PLATFORM_AI_KEY;
}

function aiSettings(organization: { aiEnabled: boolean; aiApiKeyEnc: string | null }) {
  const key = aiKeyFor(organization);
  return {
    enabled: organization.aiEnabled,
    hasOrgKey: Boolean(organization.aiApiKeyEnc),
    platformKey: Boolean(PLATFORM_AI_KEY),
    /** AI sa dá použiť: firma ju zapla a je kľúč (vlastný alebo prevádzkovateľa) */
    available: organization.aiEnabled && Boolean(key),
    provider: AI_PROVIDER_LABEL,
    model: AI_MODEL
  };
}

/** Kľúč AI pre požiadavku — len ak ju firma zapla; limit volaní za hodinu. */
async function aiKeyForRequest(request: express.Request): Promise<string> {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: orgScope(request) }, select: { aiEnabled: true, aiApiKeyEnc: true } });
  if (!organization.aiEnabled) throw new HttpError(403, 'AI asistent nie je vo firme zapnutý (Nastavenia → Integrácie).');
  const key = aiKeyFor(organization);
  if (!key) throw new HttpError(503, 'AI nie je nakonfigurovaná — chýba kľúč poskytovateľa.');
  const now = Date.now();
  const usage = aiUsage.get(orgScope(request));
  if (usage && usage.resetAt > now) {
    if (usage.count >= AI_HOURLY_LIMIT) throw new HttpError(429, 'Limit AI požiadaviek na hodinu je vyčerpaný — skúste neskôr alebo pokračujte bez AI.');
    usage.count++;
  } else aiUsage.set(orgScope(request), { count: 1, resetAt: now + 60 * 60 * 1000 });
  return key;
}

function aiFailure(error: unknown): never {
  if (error instanceof AiError) throw new HttpError(error.status, error.message);
  throw error;
}

app.get('/api/organizations/:organizationId/settings/ai', async (request, response, next) => {
  try {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: orgScope(request) }, select: { aiEnabled: true, aiApiKeyEnc: true } });
    response.json(aiSettings(organization));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/settings/ai', async (request, response, next) => {
  try {
    const body = request.body ?? {};
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey)) throw new HttpError(400, 'Kľúč nevyzerá ako kľúč Anthropic (sk-ant-…).');
    const organization = await prisma.organization.update({
      where: { id: orgScope(request) },
      data: {
        aiEnabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        aiApiKeyEnc: body.removeKey === true ? null : apiKey ? encryptSecret(apiKey) : undefined
      },
      select: { aiEnabled: true, aiApiKeyEnc: true }
    });
    response.json(aiSettings(organization));
  } catch (error) {
    next(error);
  }
});

/** Pre všetkých členov firmy — či ponúknuť voľbu „s AI“. */
app.get('/api/ai/status', async (request, response, next) => {
  try {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: orgScope(request) }, select: { aiEnabled: true, aiApiKeyEnc: true } });
    const settings = aiSettings(organization);
    response.json({ available: settings.available, enabled: settings.enabled, provider: settings.provider, model: settings.model });
  } catch (error) {
    next(error);
  }
});

/** Pracovné miesta a útvary firmy podľa názvu bez diakritiky — zlúčenie s kandidátmi. */
async function orgIndex(organizationId: string) {
  const [positions, units, processes] = await Promise.all([
    prisma.orgPosition.findMany({ where: { organizationId }, select: { id: true, name: true, archivedAt: true } }),
    prisma.orgUnit.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.processNode.findMany({ where: { organizationId, type: ProcessNodeType.PROCESS }, select: { id: true, name: true } })
  ]);
  return {
    positions: new Map(positions.map((item) => [foldName(item.name), item])),
    units: new Map(units.map((item) => [foldName(item.name), item])),
    processes: new Map(processes.map((item) => [foldName(item.name), item])),
    positionNames: positions.filter((item) => !item.archivedAt).map((item) => item.name)
  };
}

function roleMatches(draft: ProcessDraft, positions: Map<string, { id: string; name: string; archivedAt: Date | null }>) {
  return draft.roles.map((role) => {
    const match = positions.get(foldName(role));
    return { role, positionId: match && !match.archivedAt ? match.id : null, positionName: match?.name ?? null };
  });
}

/** Návrh procesu z textu — AI (ak ju firma zapla a človek ju zvolil) alebo podľa pravidiel. Nič sa neukladá. */
app.post('/api/process-drafts/from-text', async (request, response, next) => {
  try {
    const text = typeof request.body?.text === 'string' ? request.body.text.trim() : '';
    if (text.length < 10) throw new HttpError(400, 'Opíšte postup aspoň jednou vetou.');
    if (text.length > 20000) throw new HttpError(400, 'Text je príliš dlhý (najviac 20 000 znakov) — rozdeľte ho na viac procesov.');
    const index = await orgIndex(orgScope(request));
    let draft: ProcessDraft;
    let method: 'ai' | 'rules' = 'rules';
    if (request.body?.useAi === true) {
      const apiKey = await aiKeyForRequest(request);
      const raw = await callAiTool({ apiKey, system: processDraftPrompt(index.positionNames), content: [{ type: 'text', text }], tool: PROCESS_DRAFT_TOOL }).catch(aiFailure);
      draft = sanitizeDraft(raw);
      method = 'ai';
    } else {
      draft = parseProcessText(text, { knownRoles: index.positionNames });
    }
    response.json({ method, draft, steps: draftSteps(draft), roleMatches: roleMatches(draft, index.positions) });
  } catch (error) {
    next(error);
  }
});

async function readRawBody(request: express.Request, limit: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, `Súbor je väčší ako ${Math.round(limit / 1024 / 1024)} MB.`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, `Súbor je väčší ako ${Math.round(limit / 1024 / 1024)} MB.`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function aiContentFor(doc: ExtractedDocument, buffer: Buffer): AiContent[] {
  const intro: AiContent = { type: 'text', text: `Dokument: ${doc.fileName}` };
  if (doc.format === 'pdf') return [intro, { type: 'document', mediaType: 'application/pdf', data: buffer.toString('base64') }];
  if (doc.format === 'image') {
    if (buffer.length > MAX_AI_IMAGE_BYTES) throw new HttpError(413, 'Obrázok je pre AI príliš veľký (najviac 5 MB).');
    return [intro, { type: 'image', mediaType: doc.mimeType, data: buffer.toString('base64') }];
  }
  return [intro, { type: 'text', text: blocksToText(doc.blocks) }];
}

/**
 * Rozbor jedného súboru (scenár 6): kandidáti s citáciou zdroja a zhoda
 * s tým, čo firma už má. Súbor sa neukladá ani nelogujú jeho údaje.
 */
app.post('/api/import/analyze', async (request, response, next) => {
  try {
    const fileName = cleanFileName(decodeHeader(request.header('x-file-name')));
    const buffer = await readRawBody(request, MAX_IMPORT_FILE_BYTES);
    if (buffer.length === 0) throw new HttpError(400, 'Súbor je prázdny.');
    let doc: ExtractedDocument;
    try {
      doc = await extractDocument(fileName, buffer);
    } catch (error) {
      if (error instanceof ExtractError || error instanceof ZipError) throw new HttpError(400, error.message);
      throw error;
    }
    const index = await orgIndex(orgScope(request));
    const useAi = request.query['ai'] === '1';
    let candidates: ImportCandidates;
    let method: 'ai' | 'rules' = 'rules';
    if (useAi) {
      const apiKey = await aiKeyForRequest(request);
      const raw = await callAiTool({ apiKey, system: importPrompt(index.positionNames), content: aiContentFor(doc, buffer), tool: IMPORT_TOOL, maxTokens: 16000 }).catch(aiFailure);
      candidates = candidatesFromAi(raw, doc.fileName);
      method = 'ai';
    } else {
      candidates = candidatesFromDocument(doc, index.positionNames);
    }
    const existing = (map: Map<string, { id: string; name: string }>, key: string) => {
      const match = map.get(key);
      return match ? { id: match.id, name: match.name } : null;
    };
    response.json({
      file: doc.fileName,
      format: doc.format,
      method,
      units: candidates.units.map((item) => ({ ...item, existing: existing(index.units, item.key) })),
      positions: candidates.positions.map((item) => ({ ...item, existing: existing(index.positions, item.key) })),
      processes: candidates.processes.map((item) => ({
        ...item,
        steps: draftSteps(item.draft),
        existing: existing(index.processes, foldName(item.draft.name)),
        roleMatches: roleMatches(item.draft, index.positions)
      })),
      warnings: [...(method === 'rules' ? doc.warnings : []), ...candidates.warnings.filter((warning) => method === 'ai' || !doc.warnings.includes(warning))]
    });
  } catch (error) {
    next(error);
  }
});

type ApplyInput = {
  units: Array<{ key: string; name: string; parentKey: string | null }>;
  positions: Array<{ key: string; name: string; unitKey: string | null; reportsToKey: string | null; holder: string | null }>;
  processes: Array<{ draft: ProcessDraft; ownerRole: string | null; source: Citation | null }>;
};

function parseApplyInput(body: any): ApplyInput {
  const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const key = (value: unknown) => (text(value) ? foldName(text(value)) : null);
  const list = (value: unknown, max: number, label: string) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new HttpError(400, `${label} musí byť zoznam.`);
    if (value.length > max) throw new HttpError(400, `Naraz najviac ${max} (${label}).`);
    return value;
  };
  // rovnaký názov (bez diakritiky) = to isté — duplicity z viacerých súborov sa zlúčia
  const dedupe = <T extends { key: string }>(items: T[]) => [...new Map(items.map((item) => [item.key, item])).values()];
  return {
    units: dedupe(list(body?.units, 200, 'útvary').filter((item: any) => text(item?.name)).map((item: any) => ({
      key: foldName(text(item.name)), name: text(item.name), parentKey: key(item.parentKey ?? item.parent)
    }))),
    positions: dedupe(list(body?.positions, 500, 'pracovné miesta').filter((item: any) => text(item?.name)).map((item: any) => ({
      key: foldName(text(item.name)), name: text(item.name), unitKey: key(item.unitKey ?? item.unit), reportsToKey: key(item.reportsToKey ?? item.reportsTo), holder: text(item.holder, 120) || null
    }))),
    processes: list(body?.processes, 50, 'procesy').map((item: any) => ({
      draft: sanitizeDraft(item?.draft),
      ownerRole: text(item?.ownerRole, 120) || null,
      source: item?.source ? { file: text(item.source.file, 200), location: text(item.source.location, 120), quote: text(item.source.quote, 200) } : null
    }))
  };
}

/**
 * Potvrdenie importu alebo návrhu z textu: vytvorí útvary, miesta (existujúce sa
 * zlúčia podľa názvu), voliteľne osoby s obsadením a procesy ako NÁVRHY —
 * nič sa nepublikuje. Organizačnú štruktúru mení len správa firmy.
 */
app.post('/api/import/apply', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const { userId } = auth(request);
    const input = parseApplyInput(request.body ?? {});
    const createPeople = request.body?.createPeople === true;
    const createMissingRoles = request.body?.createMissingRoles === true;
    const canOrg = hasPermission(request, 'organization:write');
    const canProcess = hasPermission(request, 'process:write');
    if (input.processes.length > 0 && !canProcess) throw new HttpError(403, 'Procesy môže vytvárať len editor procesov.');
    if (input.processes.length === 0 && input.units.length === 0 && input.positions.length === 0) throw new HttpError(400, 'Nie je vybraté nič na vytvorenie.');

    const index = await orgIndex(organizationId);
    const newUnits = input.units.filter((unit) => !index.units.has(unit.key));
    const newPositions = input.positions.filter((position) => !index.positions.has(position.key));
    if ((newUnits.length > 0 || newPositions.length > 0 || createPeople || createMissingRoles) && !canOrg) {
      throw new HttpError(403, 'Útvary, pracovné miesta a osoby môže vytvárať len vlastník alebo administrátor firmy.');
    }
    const day0 = today();
    const summary = { units: { created: 0, merged: input.units.length - newUnits.length }, positions: { created: 0, merged: input.positions.length - newPositions.length }, people: 0, processes: [] as Array<{ id: string; name: string }> };

    await prisma.$transaction(async (tx) => {
      // --- útvary: rodič skôr ako dieťa, cyklus sa preruší ---
      const unitId = new Map<string, string>([...index.units].map(([key, unit]) => [key, unit.id]));
      const pendingUnits = [...newUnits];
      for (let guard = 0; pendingUnits.length > 0 && guard < 500; guard++) {
        const ready = pendingUnits.findIndex((unit) => !unit.parentKey || unit.parentKey === unit.key || unitId.has(unit.parentKey) || !pendingUnits.some((other) => other.key === unit.parentKey));
        const unit = pendingUnits.splice(ready >= 0 ? ready : 0, 1)[0];
        const created = await tx.orgUnit.create({
          data: { organizationId, name: unit.name, parentId: unit.parentKey && unit.parentKey !== unit.key ? unitId.get(unit.parentKey) ?? null : null }
        });
        unitId.set(unit.key, created.id);
        summary.units.created++;
      }

      // --- pracovné miesta (existujúce sa nemenia) ---
      const positionId = new Map<string, string>([...index.positions].filter(([, position]) => !position.archivedAt).map(([key, position]) => [key, position.id]));
      for (const position of newPositions) {
        const created = await tx.orgPosition.create({
          data: { organizationId, name: position.name, unitId: position.unitKey ? unitId.get(position.unitKey) ?? null : null }
        });
        positionId.set(position.key, created.id);
        summary.positions.created++;
      }
      const reportsTo = new Map<string, string>();
      for (const position of newPositions) {
        const target = position.reportsToKey ? positionId.get(position.reportsToKey) : undefined;
        const own = positionId.get(position.key)!;
        if (!target || target === own) continue;
        // bez cyklu: nadriadený nesmie byť (nepriamo) podriadený tomuto miestu
        let cursor: string | undefined = target;
        let cycle = false;
        for (let steps = 0; cursor && steps < 600; steps++) {
          if (cursor === own) { cycle = true; break; }
          cursor = reportsTo.get(cursor);
        }
        if (cycle) continue;
        reportsTo.set(own, target);
        await tx.orgPosition.update({ where: { id: own }, data: { reportsToId: target } });
      }

      // --- osoby a obsadenie (len na výslovnú voľbu) ---
      if (createPeople) {
        const people = await tx.person.findMany({ where: { organizationId, active: true }, select: { id: true, name: true } });
        const personByName = new Map(people.map((person) => [foldName(person.name), person.id]));
        for (const position of input.positions) {
          const holder = position.holder;
          const target = positionId.get(position.key);
          if (!holder || !target) continue;
          let personId = personByName.get(foldName(holder));
          if (!personId) {
            personId = (await tx.person.create({ data: { organizationId, name: holder } })).id;
            personByName.set(foldName(holder), personId);
            summary.people++;
          }
          const held = await tx.positionAssignment.findFirst({ where: { positionId: target, personId, ...activeOn(day0) } });
          if (!held) await tx.positionAssignment.create({ data: { organizationId, positionId: target, personId, validFrom: day0 } });
        }
      }

      // --- procesy ako návrhy ---
      const last = await tx.processNode.findFirst({ where: { organizationId, parentId: null }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
      let sortOrder = (last?.sortOrder ?? 0) + 10;
      for (const item of input.processes) {
        const draft = item.draft;
        const resolveRole = async (role: string | null | undefined): Promise<string | null> => {
          if (!role) return null;
          const found = positionId.get(foldName(role));
          if (found) return found;
          if (!createMissingRoles) return null;
          const created = await tx.orgPosition.create({ data: { organizationId, name: role.slice(0, 200) } });
          positionId.set(foldName(role), created.id);
          summary.positions.created++;
          return created.id;
        };
        const node = await tx.processNode.create({
          data: {
            organizationId,
            type: ProcessNodeType.PROCESS,
            name: draft.name,
            description: draft.purpose || null,
            trigger: draft.trigger || null,
            outcome: draft.outcome || null,
            bpmnXml: draftToBpmnXml(draft),
            diagramType: 'BPMN',
            sortOrder
          }
        });
        sortOrder += 10;
        for (const [order, step] of draftSteps(draft).slice(0, MAX_ACTIVITIES).entries()) {
          const role = await resolveRole(step.role);
          const activity = await tx.processActivity.create({
            data: { organizationId, processNodeId: node.id, sortOrder: order, title: step.title.slice(0, 300), description: step.description ? step.description.slice(0, 5000) : null }
          });
          if (role) await tx.activityResponsibility.create({ data: { organizationId, activityId: activity.id, role: RaciRole.RESPONSIBLE, positionId: role } });
        }
        const owner = await resolveRole(item.ownerRole);
        if (owner) await tx.processPosition.create({ data: { processNodeId: node.id, positionId: owner, role: ResponsibilityRole.OWNER } });
        await tx.processChangeLog.create({
          data: {
            processNodeId: node.id,
            userId,
            changedFields: { povod: { from: null, to: item.source ? `${item.source.file} — ${item.source.location}` : 'návrh z textu' } },
            description: item.source ? 'Návrh z importu dokumentu — skontrolujte pred publikovaním' : 'Návrh z textu — skontrolujte pred publikovaním'
          }
        });
        summary.processes.push({ id: node.id, name: node.name });
      }
    }, { timeout: 60_000 });
    response.status(201).json(summary);
  } catch (error) {
    next(error);
  }
});

// --- #43 GRAPH-01 IT systemy a dopad ich zmeny ---

const MAX_SYSTEM_LINKS = 30;

/** Systemy procesu alebo kroku: len vlastna firma; vyradeny system len ak uz bol pripojeny. */
async function resolveSystemLinks(organizationId: string, value: unknown, alreadyLinked: string[]): Promise<string[]> {
  if (!Array.isArray(value)) throw new HttpError(400, 'Systémy musia byť zoznam.');
  const ids = (await assertOwnedIds('itSystem', organizationId, value)).sort();
  if (ids.length > MAX_SYSTEM_LINKS) throw new HttpError(400, `Najviac ${MAX_SYSTEM_LINKS} systémov.`);
  const fresh = ids.filter((id) => !alreadyLinked.includes(id));
  if (fresh.length > 0) {
    const retired = await prisma.itSystem.findFirst({ where: { organizationId, id: { in: fresh }, archivedAt: { not: null } }, select: { name: true } });
    if (retired) throw new HttpError(400, `Systém „${retired.name}“ je vyradený — vyberte iný.`);
  }
  return ids;
}

async function describeSystems(organizationId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const systems = await prisma.itSystem.findMany({ where: { organizationId, id: { in: ids } }, select: { name: true } });
  return systems.map((system) => system.name).sort((a, b) => a.localeCompare(b, 'sk'));
}

async function requireSystem(request: express.Request, systemId: string) {
  const system = await prisma.itSystem.findFirst({ where: { id: systemId, organizationId: orgScope(request) } });
  if (!system) throw new HttpError(404, 'Systém sa nenašiel.');
  return system;
}

const SYSTEM_INCLUDE = () => ({
  ownerPosition: { select: { id: true, name: true, archivedAt: true, assignments: { where: activeOn(today()), select: { person: { select: { name: true } } } } } }
});

function mapItSystem(system: any, usage?: { processes: number; steps: number }) {
  const holders = (system.ownerPosition?.assignments ?? []).map((item: any) => item.person?.name).filter(Boolean);
  return {
    id: system.id,
    name: system.name,
    code: system.code ?? '',
    description: system.description ?? '',
    vendor: system.vendor ?? '',
    url: system.url ?? '',
    ownerPositionId: system.ownerPositionId ?? null,
    ownerPosition: system.ownerPosition
      ? { id: system.ownerPosition.id, name: system.ownerPosition.name, holders, vacant: holders.length === 0, archived: Boolean(system.ownerPosition.archivedAt) }
      : null,
    archived: Boolean(system.archivedAt),
    archivedAt: system.archivedAt ? businessDay.format(system.archivedAt) : null,
    processCount: usage?.processes ?? 0,
    stepCount: usage?.steps ?? 0
  };
}

/** Odkaz na system — len http(s), aby sa v odkaze nedal podstrcit javascript: a pod. */
function cleanUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const text = cleanText(value, 500);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
    return url.toString();
  } catch {
    throw new HttpError(400, 'Odkaz musí začínať http:// alebo https://');
  }
}

async function systemFields(organizationId: string, body: any, current?: { ownerPositionId: string | null }) {
  const name = body.name === undefined ? undefined : cleanText(body.name, 200);
  if (body.name !== undefined && !name) throw new HttpError(400, 'Názov systému je povinný.');
  let ownerPositionId: string | null | undefined;
  if (body.ownerPositionId !== undefined) {
    [ownerPositionId = null] = await assertOwnedIds('orgPosition', organizationId, [body.ownerPositionId]);
    if (ownerPositionId) await assertPositionsLinkable(organizationId, [ownerPositionId], current?.ownerPositionId ? [current.ownerPositionId] : []);
  }
  return {
    name: name ?? undefined,
    code: body.code === undefined ? undefined : (cleanText(body.code, 30)?.toUpperCase() ?? null),
    description: body.description === undefined ? undefined : cleanText(body.description, 2000),
    vendor: body.vendor === undefined ? undefined : cleanText(body.vendor, 200),
    url: cleanUrl(body.url),
    ownerPositionId
  };
}

async function assertSystemNameFree(organizationId: string, name: string, systemId?: string) {
  const clash = await prisma.itSystem.findFirst({
    where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(systemId ? { id: { not: systemId } } : {}) },
    select: { id: true }
  });
  if (clash) throw new HttpError(409, `Systém „${name}“ už v zozname je.`);
}

/** Kolko procesov a krokov (navrh) system pouziva — pre zoznam systemov. */
async function systemUsage(organizationId: string) {
  const [processes, steps] = await Promise.all([
    prisma.processNode.findMany({ where: { organizationId, NOT: { systemIds: { isEmpty: true } } }, select: { id: true, systemIds: true } }),
    prisma.processActivity.findMany({ where: { organizationId, NOT: { systemIds: { isEmpty: true } } }, select: { processNodeId: true, systemIds: true } })
  ]);
  const usage = new Map<string, { processIds: Set<string>; steps: number }>();
  const entry = (id: string) => {
    const item = usage.get(id) ?? { processIds: new Set<string>(), steps: 0 };
    usage.set(id, item);
    return item;
  };
  for (const process of processes) for (const id of process.systemIds) entry(id).processIds.add(process.id);
  for (const step of steps) {
    for (const id of step.systemIds) {
      const item = entry(id);
      item.processIds.add(step.processNodeId);
      item.steps += 1;
    }
  }
  return new Map([...usage].map(([id, item]) => [id, { processes: item.processIds.size, steps: item.steps }]));
}

/**
 * Dopad zmeny alebo vyradenia systemu: procesy a kroky navrhu, platne
 * a naplanovane verzie (ludia podla nich pracuju) a vlastnik systemu.
 */
async function systemImpact(organizationId: string, systemId: string, onlyCurrent = true) {
  const now = today();
  const contains = JSON.stringify([systemId]);
  const [processes, steps, versions] = await Promise.all([
    prisma.processNode.findMany({ where: { organizationId, systemIds: { has: systemId } }, select: { id: true, name: true, code: true } }),
    prisma.processActivity.findMany({
      where: { organizationId, systemIds: { has: systemId } },
      select: { title: true, sortOrder: true, processNode: { select: { id: true, name: true, code: true } } }
    }),
    prisma.$queryRaw<Array<{ processNodeId: string; revision: number; name: string; effectiveFrom: Date; effectiveTo: Date | null }>>`
      SELECT v."processNodeId", v.revision, v.snapshot->>'name' AS name, v."effectiveFrom", v."effectiveTo"
      FROM "ProcessVersion" v
      WHERE v."organizationId" = ${organizationId}
        AND (${!onlyCurrent} OR v."effectiveTo" IS NULL OR v."effectiveTo" >= ${now})
        AND (
          COALESCE(v.snapshot->'systemIds', '[]'::jsonb) @> ${contains}::jsonb
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v.snapshot->'activities', '[]'::jsonb)) a
                     WHERE COALESCE(a->'systemIds', '[]'::jsonb) @> ${contains}::jsonb)
        )
      ORDER BY name, v.revision`
  ]);
  const byProcess = new Map<string, { id: string; name: string; code: string; wholeProcess: boolean; steps: string[] }>();
  const entry = (node: { id: string; name: string; code: string | null }) => {
    const item = byProcess.get(node.id) ?? { id: node.id, name: node.name, code: node.code ?? '', wholeProcess: false, steps: [] };
    byProcess.set(node.id, item);
    return item;
  };
  for (const node of processes) entry(node).wholeProcess = true;
  for (const step of steps.sort((a, b) => a.sortOrder - b.sortOrder)) entry(step.processNode).steps.push(`${step.sortOrder + 1}. ${step.title}`);
  return {
    processes: [...byProcess.values()].sort((a, b) => a.name.localeCompare(b.name, 'sk')),
    versions: versions.map((version) => ({ processId: version.processNodeId, name: version.name, revision: version.revision, scheduled: version.effectiveFrom > now }))
  };
}

app.get('/api/organizations/:organizationId/systems', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const [systems, usage] = await Promise.all([
      prisma.itSystem.findMany({ where: { organizationId }, include: SYSTEM_INCLUDE(), orderBy: { name: 'asc' } }),
      systemUsage(organizationId)
    ]);
    response.json(systems.map((system) => mapItSystem(system, usage.get(system.id))));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/systems', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const fields = await systemFields(organizationId, request.body ?? {});
    if (!fields.name) throw new HttpError(400, 'Názov systému je povinný.');
    await assertSystemNameFree(organizationId, fields.name);
    const system = await prisma.itSystem.create({
      data: { organizationId, ...fields, name: fields.name, ownerPositionId: fields.ownerPositionId ?? null },
      include: SYSTEM_INCLUDE()
    });
    response.status(201).json(mapItSystem(system));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/systems/:systemId', async (request, response, next) => {
  try {
    const current = await requireSystem(request, request.params.systemId);
    const fields = await systemFields(current.organizationId, request.body ?? {}, current);
    if (fields.name) await assertSystemNameFree(current.organizationId, fields.name, current.id);
    const system = await prisma.itSystem.update({ where: { id: current.id }, data: fields, include: SYSTEM_INCLUDE() });
    response.json(mapItSystem(system, (await systemUsage(current.organizationId)).get(system.id)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/systems/:systemId/impact', async (request, response, next) => {
  try {
    const system = await prisma.itSystem.findFirst({ where: { id: request.params.systemId, organizationId: orgScope(request) }, include: SYSTEM_INCLUDE() });
    if (!system) throw new HttpError(404, 'Systém sa nenašiel.');
    response.json({ system: mapItSystem(system), ...(await systemImpact(system.organizationId, system.id)) });
  } catch (error) {
    next(error);
  }
});

/**
 * Vyradenie systemu (napr. nahradenie novym ERP): az po potvrdeni dopadu.
 * Vazby a verzie ostavaju — procesy sa ukazu v Prehlade, kym ich niekto neupravi.
 */
app.post('/api/systems/:systemId/archive', async (request, response, next) => {
  try {
    const system = await requireSystem(request, request.params.systemId);
    if (system.archivedAt) throw new HttpError(409, 'Systém už je vyradený.');
    if (request.body?.confirm !== true) {
      throw new HttpError(400, 'Najprv si pozrite dopad vyradenia (GET /systems/:id/impact) a potvrďte ho.');
    }
    const impact = await systemImpact(system.organizationId, system.id);
    await prisma.$transaction(async (tx) => {
      await tx.itSystem.update({ where: { id: system.id }, data: { archivedAt: new Date() } });
      await emitEvent(tx, {
        organizationId: system.organizationId,
        type: 'SystemArchived',
        actorId: auth(request).userId,
        payload: { systemName: system.name, processCount: impact.processes.length, processes: impact.processes.slice(0, 10).map((item) => item.name) }
      });
    });
    kickDispatcher();
    const fresh = await prisma.itSystem.findUniqueOrThrow({ where: { id: system.id }, include: SYSTEM_INCLUDE() });
    response.json({ system: mapItSystem(fresh), ...impact });
  } catch (error) {
    next(error);
  }
});

app.post('/api/systems/:systemId/restore', async (request, response, next) => {
  try {
    const system = await requireSystem(request, request.params.systemId);
    const fresh = await prisma.itSystem.update({ where: { id: system.id }, data: { archivedAt: null }, include: SYSTEM_INCLUDE() });
    response.json(mapItSystem(fresh));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/systems/:systemId', async (request, response, next) => {
  try {
    const system = await requireSystem(request, request.params.systemId);
    // pouzity system sa nemaze — aj stara verzia procesu by stratila jeho nazov
    const impact = await systemImpact(system.organizationId, system.id, false);
    if (impact.processes.length > 0 || impact.versions.length > 0) {
      throw new HttpError(409, `Systém „${system.name}“ je použitý (procesy: ${impact.processes.length}, verzie: ${impact.versions.length}) — vyraďte ho, dopad uvidíte pred potvrdením.`);
    }
    await prisma.itSystem.delete({ where: { id: system.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- #13 adresar osob a #14 obsadenie miest s obdobim platnosti ---

/**
 * Dnesny den ako datum bez casu — obsadenia su po dnoch. Den sa urcuje podla
 * casoveho pasma firmy, nie servera (kontajner bezi v UTC: medzi polnocou
 * a 2:00 by v Bratislave bol este vcerajsok).
 */
const BUSINESS_TIMEZONE = process.env['APP_TIMEZONE'] ?? 'Europe/Bratislava';
const businessDay = new Intl.DateTimeFormat('sv-SE', { timeZone: BUSINESS_TIMEZONE });

function today(): Date {
  return new Date(`${businessDay.format(new Date())}T00:00:00Z`);
}

/** 'YYYY-MM-DD' -> Date; prazdna hodnota -> fallback. */
function parseDay(value: unknown, fallback: Date | null, field: string): Date | null {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${field} musi byt datum v tvare RRRR-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${field} nie je platny datum.`);
  return date;
}

const day = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

/** Obsadenie platne v dany den: zacalo najneskor v ten den a neskoncilo skor. */
function activeOn(date: Date) {
  return { validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] };
}

function isActive(assignment: { validFrom: Date; validTo: Date | null }, date = today()): boolean {
  return assignment.validFrom <= date && (!assignment.validTo || assignment.validTo >= date);
}

async function requirePerson(request: express.Request, personId: string) {
  const person = await prisma.person.findFirst({ where: { id: personId, organizationId: orgScope(request) } });
  if (!person) throw new HttpError(404, 'Osoba sa nenasla.');
  return person;
}

async function requireAssignment(request: express.Request, assignmentId: string) {
  const assignment = await prisma.positionAssignment.findFirst({
    where: { id: assignmentId, organizationId: orgScope(request) }
  });
  if (!assignment) throw new HttpError(404, 'Obsadenie sa nenaslo.');
  return assignment;
}

const PERSON_INCLUDE = {
  assignments: {
    orderBy: { validFrom: 'desc' as const },
    include: { position: { select: { id: true, name: true, unit: { select: { name: true } } } } }
  }
};

function mapPerson(person: any) {
  const now = today();
  return {
    id: person.id,
    name: person.name,
    email: person.email ?? '',
    phone: person.phone ?? '',
    note: person.note ?? '',
    active: person.active,
    // osoba bez uctu je len v adresari — neprihlasuje sa a nepocita sa ako plateny pouzivatel
    hasAccount: Boolean(person.userId),
    userId: person.userId ?? null,
    assignments: (person.assignments ?? []).map((assignment: any) => ({
      id: assignment.id,
      positionId: assignment.positionId,
      positionName: assignment.position?.name ?? '',
      unitName: assignment.position?.unit?.name ?? null,
      validFrom: day(assignment.validFrom),
      validTo: day(assignment.validTo),
      current: isActive(assignment, now)
    }))
  };
}

function cleanText(value: unknown, max = 200): string | null {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return text || null;
}

/**
 * „Moja práca“ (#33 UX-01a): procesy podla miest, ktore prihlaseny DNES (alebo
 * v den `at`) zastava — nie podla pevne zapisaneho cloveka. Po zmene obsadenia
 * sa proces presunie k novemu drzitelovi. Pri viacerych miestach sa zlucia
 * a pri kazdom procese je zdroj zodpovednosti.
 */
app.get('/api/me/work', async (request, response, next) => {
  try {
    const { userId, organizationId } = auth(request);
    const at = parseDay(request.query['at'], today(), 'at')!;
    const person = await prisma.person.findFirst({ where: { organizationId, userId }, select: { id: true, name: true } });
    if (!person) {
      response.json({ at: day(at), person: null, positions: [], processes: [] });
      return;
    }

    const assignments = await prisma.positionAssignment.findMany({
      where: { personId: person.id, organizationId, ...activeOn(at) },
      include: { position: { select: { id: true, name: true } } },
      orderBy: { validFrom: 'asc' }
    });
    const positionIds = assignments.map((assignment) => assignment.positionId);
    const processSelect = {
      select: {
        id: true, name: true, code: true,
        versions: { select: { id: true, revision: true, effectiveFrom: true, effectiveTo: true, nextReviewAt: true } }
      }
    };
    const processLinks = positionIds.length
      ? await prisma.processPosition.findMany({
          where: { positionId: { in: positionIds }, processNode: { organizationId, type: ProcessNodeType.PROCESS } },
          include: { processNode: processSelect }
        })
      : [];
    // #29 — aj zodpovednost pri kroku: cez moje miesto, alebo vynimocne priamo na mna
    const stepLinks = await prisma.activityResponsibility.findMany({
      where: {
        organizationId,
        OR: [...(positionIds.length ? [{ positionId: { in: positionIds } }] : []), { personId: person.id }],
        activity: { processNode: { organizationId, type: ProcessNodeType.PROCESS } }
      },
      select: { role: true, positionId: true, activity: { select: { title: true, processNode: processSelect } } }
    });
    type WorkLink = {
      processNodeId: string;
      processNode: (typeof processLinks)[number]['processNode'];
      role: string;
      positionId: string | null;
      step?: string;
      raci?: RaciCode;
    };
    const links: WorkLink[] = [
      ...processLinks.map((link) => ({ processNodeId: link.processNodeId, processNode: link.processNode, role: String(link.role), positionId: link.positionId })),
      ...stepLinks.map((link) => ({
        processNodeId: link.activity.processNode.id,
        processNode: link.activity.processNode,
        role: 'STEP',
        positionId: link.positionId,
        step: link.activity.title,
        raci: RACI_CODE[link.role]
      }))
    ];

    // nazov z platnej verzie (to, co plati), inak z navrhu
    const effectiveByProcess = new Map<string, any>();
    for (const link of links) {
      if (effectiveByProcess.has(link.processNodeId)) continue;
      effectiveByProcess.set(link.processNodeId, pickEffective(link.processNode.versions, at));
    }
    const versionIds = [...effectiveByProcess.values()].filter(Boolean).map((version: any) => version.id);
    const names = versionIds.length
      ? await prisma.$queryRaw<Array<{ id: string; name: string; code: string | null }>>`SELECT id, snapshot->>'name' AS name, snapshot->>'code' AS code FROM "ProcessVersion" WHERE id = ANY(${versionIds})`
      : [];
    const versionName = new Map(names.map((row) => [row.id, row.name]));
    const versionCode = new Map(names.map((row) => [row.id, row.code]));
    const positionName = new Map(assignments.map((assignment) => [assignment.positionId, assignment.position.name]));
    const soon = new Date(at.getTime() + 30 * 24 * 60 * 60 * 1000);

    const byProcess = new Map<string, any>();
    for (const link of links) {
      const effective = effectiveByProcess.get(link.processNodeId);
      const entry = byProcess.get(link.processNodeId) ?? {
        id: link.processNodeId,
        name: (effective && versionName.get(effective.id)) || link.processNode.name,
        code: (effective ? versionCode.get(effective.id) : link.processNode.code) ?? '',
        effective: effective
          ? { revision: effective.revision, effectiveFrom: day(effective.effectiveFrom), nextReviewAt: day(effective.nextReviewAt) }
          : null,
        review: !effective?.nextReviewAt ? null : effective.nextReviewAt < at ? 'overdue' : effective.nextReviewAt <= soon ? 'soon' : null,
        roles: [] as Array<{ role: string; positionId: string | null; positionName: string; step?: string; raci?: RaciCode }>
      };
      entry.roles.push({
        role: link.role,
        positionId: link.positionId,
        // bez miesta = zodpovednost priradena priamo osobe (vynimka)
        positionName: link.positionId ? positionName.get(link.positionId) ?? '' : '',
        ...(link.step ? { step: link.step, raci: link.raci } : {})
      });
      byProcess.set(link.processNodeId, entry);
    }

    response.json({
      at: day(at),
      person,
      positions: assignments.map((assignment) => ({
        id: assignment.positionId,
        name: assignment.position.name,
        validFrom: day(assignment.validFrom),
        validTo: day(assignment.validTo)
      })),
      processes: [...byProcess.values()].sort((a, b) => a.name.localeCompare(b.name, 'sk'))
    });
  } catch (error) {
    next(error);
  }
});

// --- #38 GOV-02 domenove udalosti a upozornenia ---

type EventClient = Pick<typeof prisma, 'domainEvent'>;
type DomainEventInput = {
  organizationId: string;
  type: 'ProcessPublished' | 'ReviewDue' | 'PositionAssignmentChanged' | 'ApprovalRequested' | 'ApprovalDecided' | 'FeedbackSubmitted' | 'FeedbackDecided' | 'DocumentSuperseded' | 'PositionArchived' | 'SystemArchived';
  processNodeId?: string | null;
  actorId?: string | null;
  payload: Record<string, unknown>;
  dedupeKey?: string;
};

/** Zapis udalosti — v tej istej transakcii ako zmena, aby sa nestratila ani nezdvojila. */
async function emitEvent(client: EventClient, input: DomainEventInput): Promise<void> {
  await client.domainEvent.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      processNodeId: input.processNodeId ?? null,
      actorId: input.actorId ?? null,
      payload: input.payload as any,
      dedupeKey: input.dedupeKey ?? null
    }
  });
  // v transakcii by dispecer udalost este nevidel — volajuci ho spusti po commite
  if (client === prisma) kickDispatcher();
}

/** Pouzivatelia firmy, ktori v dany den zastavaju niektore z miest. */
async function usersOnPositions(organizationId: string, positionIds: string[], at = today()): Promise<string[]> {
  if (positionIds.length === 0) return [];
  const rows = await prisma.positionAssignment.findMany({
    where: { organizationId, positionId: { in: positionIds }, ...activeOn(at), person: { userId: { not: null } } },
    select: { person: { select: { userId: true } } }
  });
  return rows.flatMap((row) => row.person.userId ?? []);
}

/** Kto je procesom dotknuty: vlastnik, vykonavatelia a RACI krokov (miesta aj priame osoby). */
async function processStakeholders(organizationId: string, processNodeId: string): Promise<string[]> {
  const [links, steps] = await Promise.all([
    prisma.processPosition.findMany({ where: { processNodeId }, select: { positionId: true } }),
    prisma.activityResponsibility.findMany({
      where: { activity: { processNodeId } },
      select: { positionId: true, person: { select: { userId: true } } }
    })
  ]);
  const positionIds = [...links.map((link) => link.positionId), ...steps.flatMap((step) => step.positionId ?? [])];
  return [...await usersOnPositions(organizationId, positionIds), ...steps.flatMap((step) => step.person?.userId ?? [])];
}

async function processOwners(organizationId: string, processNodeId: string): Promise<string[]> {
  const links = await prisma.processPosition.findMany({ where: { processNodeId, role: ResponsibilityRole.OWNER }, select: { positionId: true } });
  return usersOnPositions(organizationId, links.map((link) => link.positionId));
}

/** Clenovia firmy s danym opravnenim (podla roly). */
async function usersWithPermission(organizationId: string, permission: Permission): Promise<string[]> {
  const roles = (Object.keys(ROLE_PERMISSIONS) as OrganizationRole[]).filter((role) => ROLE_PERMISSIONS[role].includes(permission));
  const members = await prisma.organizationUser.findMany({ where: { organizationId, role: { in: roles } }, select: { userId: true } });
  return members.map((member) => member.userId);
}

type NotificationDraft = { title: string; body?: string | null; link?: string | null; recipients: string[] };

/** Z udalosti vyrobi upozornenia — komu a co. Autor zmeny upozornenie o nej nedostane. */
async function notificationsFor(event: { organizationId: string; type: string; processNodeId: string | null; actorId: string | null; payload: any }): Promise<NotificationDraft | null> {
  const p = event.payload ?? {};
  const processLink = event.processNodeId ? `/app/processes/${event.processNodeId}` : null;
  const orgId = event.organizationId;
  switch (event.type) {
    case 'ProcessPublished':
      return {
        title: `Nová verzia procesu „${p.name}“`,
        body: `v${p.revision} platí od ${p.effectiveFrom}.${p.changeReason ? ` Zmena: ${p.changeReason}` : ''}`,
        link: processLink,
        recipients: await processStakeholders(orgId, event.processNodeId!)
      };
    case 'ReviewDue': {
      const owners = await processOwners(orgId, event.processNodeId!);
      return {
        title: p.overdue ? `Revízia procesu „${p.name}“ je po termíne` : `Blíži sa revízia procesu „${p.name}“`,
        body: `Termín ${p.nextReviewAt} (v${p.revision}).`,
        link: processLink,
        // bez vlastnika sa o reviziu postaraju editori
        recipients: owners.length > 0 ? owners : await usersWithPermission(orgId, 'process:write')
      };
    }
    case 'ApprovalRequested':
      return {
        title: `Návrh na schválenie: „${p.name}“`,
        body: `${p.requestedBy ?? 'Kolega'} odoslal(a) návrh v${p.revision}${p.changeReason ? ` — ${p.changeReason}` : ''}.`,
        link: `${processLink}?approval=${p.requestId}`,
        recipients: await usersWithPermission(orgId, 'approval:approve')
      };
    case 'ApprovalDecided':
      return {
        title: `Návrh „${p.name}“ bol ${p.approved ? 'schválený' : 'zamietnutý'}`,
        body: `${p.decidedBy ?? '—'}${p.comment ? `: ${p.comment}` : ''}`,
        link: processLink,
        recipients: p.requestedById ? [p.requestedById] : []
      };
    case 'FeedbackSubmitted': {
      const owners = await processOwners(orgId, event.processNodeId!);
      return {
        title: `${p.kind === 'error' ? 'Nahlásená chyba' : 'Návrh zlepšenia'} k „${p.name}“`,
        body: String(p.text ?? '').slice(0, 200),
        link: processLink,
        recipients: owners.length > 0 ? owners : await usersWithPermission(orgId, 'process:write')
      };
    }
    case 'FeedbackDecided':
      return {
        title: `Váš podnet k „${p.name}“: ${({ accepted: 'prijatý', rejected: 'zamietnutý', done: 'vybavený' } as Record<string, string>)[p.status] ?? p.status}`,
        body: p.note ?? null,
        link: processLink,
        recipients: p.authorId ? [p.authorId] : []
      };
    case 'DocumentSuperseded': {
      const owners = await processOwners(orgId, event.processNodeId!);
      return {
        title: `Nová verzia dokumentu „${p.documentName}“`,
        body: `Platí v${p.version}, no platná verzia v${p.revision} procesu „${p.processName}“ odkazuje na v${p.oldVersion}. Novú verziu prevezmete publikovaním procesu.`,
        link: processLink,
        recipients: owners.length > 0 ? owners : await usersWithPermission(orgId, 'process:write')
      };
    }
    case 'PositionArchived':
      return {
        title: `Miesto „${p.positionName}“ bolo archivované`,
        body: p.processCount
          ? `Dotknuté procesy: ${p.processCount}${(p.ownerless ?? []).length ? `; bez vlastníka: ${p.ownerless.join(', ')}` : ''}. Určte nové miesto.`
          : 'Žiadny proces od neho nezávisel.',
        link: '/app/prehlad?kategoria=vacant',
        recipients: await usersWithPermission(orgId, 'process:write')
      };
    case 'SystemArchived':
      return {
        title: `Systém „${p.systemName}“ bol vyradený`,
        body: p.processCount
          ? `Používa ho procesov: ${p.processCount} (${(p.processes ?? []).join(', ')}${p.processCount > (p.processes ?? []).length ? ', …' : ''}). Upravte postup.`
          : 'Žiadny proces ho nepoužíval.',
        link: '/app/prehlad?kategoria=retiredSystems',
        recipients: await usersWithPermission(orgId, 'process:write')
      };
    case 'PositionAssignmentChanged':
      return {
        title: p.validTo ? `Pôsobenie na mieste „${p.positionName}“: ${p.validFrom} – ${p.validTo}` : `Zastávate miesto „${p.positionName}“ od ${p.validFrom}`,
        body: 'Procesy tohto miesta nájdete v časti Moja práca.',
        link: '/app/moja-praca',
        recipients: p.userId ? [p.userId] : []
      };
    default:
      return null;
  }
}

let dispatching = false;
let dispatchAgain = false;

/**
 * Dispecer outboxu: neodoslane udalosti → upozornenia. Udalost si najprv
 * „zaberie“ (processedAt), takze ju ani viac behov naraz nespracuje dvakrat.
 */
async function dispatchEvents(): Promise<void> {
  if (dispatching) {
    dispatchAgain = true;
    return;
  }
  dispatching = true;
  try {
    do {
      dispatchAgain = false;
      const events = await prisma.domainEvent.findMany({ where: { processedAt: null }, orderBy: { createdAt: 'asc' }, take: 50 });
      for (const event of events) {
        const claimed = await prisma.domainEvent.updateMany({ where: { id: event.id, processedAt: null }, data: { processedAt: new Date() } });
        if (claimed.count === 0) continue;
        try {
          const draft = await notificationsFor(event);
          if (!draft) continue;
          // len clenovia tejto firmy, bez autora zmeny, kazdy raz
          const members = new Set((await prisma.organizationUser.findMany({ where: { organizationId: event.organizationId }, select: { userId: true } })).map((m) => m.userId));
          const recipients = [...new Set(draft.recipients)].filter((userId) => members.has(userId) && userId !== event.actorId);
          if (recipients.length === 0) continue;
          await prisma.notification.createMany({
            data: recipients.map((userId) => ({
              organizationId: event.organizationId,
              userId,
              eventId: event.id,
              type: event.type,
              title: draft.title.slice(0, 300),
              body: draft.body ? draft.body.slice(0, 1000) : null,
              link: draft.link ?? null
            })),
            skipDuplicates: true
          });
        } catch (error) {
          logError('udalosti', error);
        }
      }
      if (events.length === 50) dispatchAgain = true;
    } while (dispatchAgain);
  } finally {
    dispatching = false;
  }
}

function kickDispatcher(): void {
  setImmediate(() => dispatchEvents().catch((error) => logError('udalosti', error)));
}

/**
 * ReviewDue — platne verzie s terminom revizie do 30 dni alebo po termine.
 * Kluc udalosti (verzia + „blizi sa“/„po termine“) zabrani opakovanym upozorneniam.
 */
async function scanReviewDue(): Promise<void> {
  const now = today();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const versions = await prisma.processVersion.findMany({
    where: { nextReviewAt: { not: null, lte: soon }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
    select: { id: true, organizationId: true, processNodeId: true, revision: true, nextReviewAt: true, snapshot: true }
  });
  // len verzia, ktora dnes naozaj plati (nie nahradena v ten isty den vyssou reviziou)
  const siblings = await prisma.processVersion.findMany({
    where: { processNodeId: { in: [...new Set(versions.map((version) => version.processNodeId))] } },
    select: { id: true, processNodeId: true, revision: true, effectiveFrom: true, effectiveTo: true }
  });
  const effectiveIds = new Set(
    [...new Set(siblings.map((item) => item.processNodeId))]
      .map((processNodeId) => pickEffective(siblings.filter((item) => item.processNodeId === processNodeId), now)?.id)
      .filter(Boolean)
  );
  for (const version of versions) {
    if (!effectiveIds.has(version.id)) continue;
    const overdue = version.nextReviewAt! < now;
    const dedupeKey = `ReviewDue:${version.id}:${overdue ? 'po-termine' : 'blizi-sa'}`;
    const exists = await prisma.domainEvent.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (exists) continue;
    await emitEvent(prisma, {
      organizationId: version.organizationId,
      type: 'ReviewDue',
      processNodeId: version.processNodeId,
      payload: { name: (version.snapshot as unknown as ProcessSnapshot).name, revision: version.revision, nextReviewAt: day(version.nextReviewAt), overdue },
      dedupeKey
    }).catch((error) => {
      // subeh dvoch prehladani — druhe narazi na unikatny kluc, to je v poriadku
      if ((error as { code?: string })?.code !== 'P2002') throw error;
    });
  }
}

/**
 * DocumentSuperseded (#31/#38) — nova verzia dokumentu zacala platit, no platna
 * verzia procesu odkazuje na starsiu. Hlada sa v poslednych 60 dnoch; kluc
 * udalosti (verzia dokumentu) zabrani opakovaniu.
 */
async function scanDocumentVersions(): Promise<void> {
  const now = today();
  const since = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const fresh = await prisma.attachment.findMany({
    where: { documentId: { not: null }, version: { gt: 1 }, effectiveFrom: { lte: now, gte: since } },
    select: { id: true, organizationId: true, documentId: true, version: true, fileName: true, uploadedById: true, document: { select: { processNodeId: true } } }
  });
  for (const item of fresh) {
    const dedupeKey = `DocumentSuperseded:${item.id}`;
    const processNodeId = item.document?.processNodeId;
    if (!processNodeId || (await prisma.domainEvent.findUnique({ where: { dedupeKey }, select: { id: true } }))) continue;
    const versions = await prisma.attachment.findMany({ where: { documentId: item.documentId }, select: DOCUMENT_VERSION_SELECT });
    // plati tato verzia naozaj (nenahradila ju hned dalsia)?
    if (currentDocumentVersions(versions, now)[0]?.id !== item.id) continue;
    const processVersions = await prisma.processVersion.findMany({
      where: { processNodeId },
      select: { id: true, revision: true, effectiveFrom: true, effectiveTo: true, snapshot: true }
    });
    const effective = pickEffective(processVersions, now);
    const snapshot = effective?.snapshot as unknown as ProcessSnapshot | undefined;
    const old = versions.find((version) => version.version < item.version && (snapshot?.documentIds ?? []).includes(version.id));
    if (!effective || !snapshot || !old) continue;
    await emitEvent(prisma, {
      organizationId: item.organizationId,
      type: 'DocumentSuperseded',
      processNodeId,
      actorId: item.uploadedById,
      payload: { documentName: item.fileName, version: item.version, oldVersion: old.version, processName: snapshot.name, revision: effective.revision },
      dedupeKey
    }).catch((error) => {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
    });
  }
}

app.get('/api/me/notifications', async (request, response, next) => {
  try {
    const { organizationId, userId } = auth(request);
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { organizationId, userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.notification.count({ where: { organizationId, userId, readAt: null } })
    ]);
    response.json({
      unread,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        link: item.link,
        read: Boolean(item.readAt),
        createdAt: item.createdAt.toISOString()
      }))
    });
  } catch (error) {
    next(error);
  }
});

/** Oznacit ako precitane — len vlastne upozornenia (ids), alebo vsetky. */
app.post('/api/me/notifications/read', async (request, response, next) => {
  try {
    const { organizationId, userId } = auth(request);
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((id: unknown) => typeof id === 'string').slice(0, 200) : null;
    if (!ids && request.body?.all !== true) throw new HttpError(400, 'Uvedte ids alebo all.');
    const result = await prisma.notification.updateMany({
      where: { organizationId, userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() }
    });
    response.json({ marked: result.count });
  } catch (error) {
    next(error);
  }
});

// --- #36 UX-01d podnety k procesu ---

const FEEDBACK_KIND: Record<string, FeedbackKind> = { error: FeedbackKind.ERROR, improvement: FeedbackKind.IMPROVEMENT };
const FEEDBACK_DECISION: Record<string, FeedbackStatus> = {
  accepted: FeedbackStatus.ACCEPTED,
  rejected: FeedbackStatus.REJECTED,
  done: FeedbackStatus.DONE
};
const MAX_OPEN_FEEDBACK_PER_AUTHOR = 20;

/** Miesta vlastnika procesu, ktore prihlaseny dnes zastava. */
async function ownsProcessToday(organizationId: string, userId: string, processNodeId: string): Promise<boolean> {
  const count = await prisma.positionAssignment.count({
    where: {
      organizationId,
      ...activeOn(today()),
      person: { userId },
      position: { processes: { some: { processNodeId, role: ResponsibilityRole.OWNER } } }
    }
  });
  return count > 0;
}

/** O podnete rozhoduje vlastnik procesu (podla miesta) alebo editor procesov. */
async function canDecideFeedback(request: express.Request, processNodeId: string): Promise<boolean> {
  if (hasPermission(request, 'process:write')) return true;
  const { organizationId, userId } = auth(request);
  return ownsProcessToday(organizationId, userId, processNodeId);
}

function mapFeedback(item: any, userId: string) {
  return {
    id: item.id,
    processId: item.processNodeId,
    processName: item.processNode?.name ?? undefined,
    kind: item.kind === FeedbackKind.ERROR ? 'error' : 'improvement',
    text: item.text,
    status: String(item.status).toLowerCase(),
    author: item.author?.name ?? null,
    mine: item.authorId === userId,
    createdAt: item.createdAt.toISOString(),
    revision: item.version?.revision ?? null,
    stepTitle: item.stepTitle ?? null,
    decisionNote: item.decisionNote ?? null,
    decidedBy: item.decidedBy?.name ?? null,
    decidedAt: item.decidedAt ? item.decidedAt.toISOString() : null
  };
}

const FEEDBACK_INCLUDE = {
  author: { select: { name: true } },
  decidedBy: { select: { name: true } },
  version: { select: { revision: true } },
  processNode: { select: { name: true } }
};

app.post('/api/processes/:processId/feedback', async (request, response, next) => {
  try {
    const node = await requireProcess(request, request.params.processId);
    if (node.type === ProcessNodeType.GROUP) throw new HttpError(400, 'Podnet sa tyka procesu, nie skupiny.');
    const { organizationId, userId } = auth(request);
    const kind = FEEDBACK_KIND[String(request.body?.kind)];
    if (!kind) throw new HttpError(400, 'Zvoľte, či ide o chybu alebo návrh zlepšenia.');
    const text = cleanText(request.body?.text, 2000);
    if (!text) throw new HttpError(400, 'Napíšte, čo je zle alebo čo navrhujete.');
    // ochrana pred zahltenim — nevybavene podnety jedneho autora
    const open = await prisma.processFeedback.count({ where: { organizationId, authorId: userId, status: FeedbackStatus.OPEN } });
    if (open >= MAX_OPEN_FEEDBACK_PER_AUTHOR) throw new HttpError(429, 'Máte veľa nevybavených podnetov — počkajte, kým ich vlastníci posúdia.');

    // krok len z tohto procesu; verzia = ta, ktoru autor cital (inak platna)
    const activityId = typeof request.body?.activityId === 'string' && request.body.activityId ? request.body.activityId : null;
    const activity = activityId
      ? await prisma.processActivity.findFirst({ where: { id: activityId, processNodeId: node.id }, select: { id: true, title: true } })
      : null;
    if (activityId && !activity) throw new HttpError(404, 'Krok sa nenasiel.');
    const versions = await prisma.processVersion.findMany({
      where: { processNodeId: node.id },
      select: { id: true, revision: true, effectiveFrom: true, effectiveTo: true }
    });
    const revision = Number(request.body?.revision);
    const version = Number.isInteger(revision) && revision > 0
      ? versions.find((item) => item.revision === revision)
      : pickEffective(versions, today());
    if (Number.isInteger(revision) && revision > 0 && !version) throw new HttpError(404, 'Verzia sa nenasla.');

    const created = await prisma.processFeedback.create({
      data: {
        organizationId,
        processNodeId: node.id,
        versionId: version?.id ?? null,
        activityId: activity?.id ?? null,
        stepTitle: activity?.title ?? null,
        kind,
        text,
        authorId: userId
      },
      include: FEEDBACK_INCLUDE
    });
    // #38 — vlastnikovi procesu (bez vlastnika editorom)
    await emitEvent(prisma, {
      organizationId,
      type: 'FeedbackSubmitted',
      processNodeId: node.id,
      actorId: userId,
      payload: { name: node.name, kind: kind === FeedbackKind.ERROR ? 'error' : 'improvement', text, feedbackId: created.id }
    });
    response.status(201).json(mapFeedback(created, userId));
  } catch (error) {
    next(error);
  }
});

/** Vlastnik a editori vidia vsetky podnety k procesu, ostatni len svoje. */
app.get('/api/processes/:processId/feedback', async (request, response, next) => {
  try {
    const node = await requireProcess(request, request.params.processId);
    const { userId } = auth(request);
    const canDecide = await canDecideFeedback(request, node.id);
    const items = await prisma.processFeedback.findMany({
      where: { processNodeId: node.id, ...(canDecide ? {} : { authorId: userId }) },
      include: FEEDBACK_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });
    response.json({ canDecide, items: items.map((item) => mapFeedback(item, userId)) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/feedback/:feedbackId/decide', async (request, response, next) => {
  try {
    const { organizationId, userId } = auth(request);
    const item = await prisma.processFeedback.findFirst({ where: { id: String(request.params.feedbackId), organizationId } });
    if (!item) throw new HttpError(404, 'Podnet sa nenasiel.');
    if (!(await canDecideFeedback(request, item.processNodeId))) {
      throw new HttpError(403, 'O podnete rozhoduje vlastník procesu alebo editor.');
    }
    const status = FEEDBACK_DECISION[String(request.body?.status)];
    if (!status) throw new HttpError(400, 'Neznámy stav podnetu.');
    // vybaveny alebo zamietnuty podnet sa uz neotvara — autor dostal odpoved
    if (item.status === FeedbackStatus.REJECTED || item.status === FeedbackStatus.DONE) throw new HttpError(409, 'Podnet je už vybavený.');
    if (status === FeedbackStatus.ACCEPTED && item.status !== FeedbackStatus.OPEN) throw new HttpError(409, 'Podnet je už prijatý.');
    const note = cleanText(request.body?.note, 2000);
    if (status === FeedbackStatus.REJECTED && !note) throw new HttpError(400, 'Napíšte autorovi, prečo podnet zamietate.');
    const updated = await prisma.processFeedback.update({
      where: { id: item.id },
      data: { status, decisionNote: note ?? item.decisionNote, decidedById: userId, decidedAt: new Date() },
      include: FEEDBACK_INCLUDE
    });
    // #38 — autorovi vysledok jeho podnetu
    await emitEvent(prisma, {
      organizationId,
      type: 'FeedbackDecided',
      processNodeId: item.processNodeId,
      actorId: userId,
      payload: { name: updated.processNode?.name ?? '', status: String(status).toLowerCase(), note: updated.decisionNote, authorId: item.authorId }
    });
    response.json(mapFeedback(updated, userId));
  } catch (error) {
    next(error);
  }
});

/** Moja praca: nevybavene podnety k procesom, ktorych miesto vlastnika dnes zastavam. */
app.get('/api/me/feedback', async (request, response, next) => {
  try {
    const { organizationId, userId } = auth(request);
    const items = await prisma.processFeedback.findMany({
      where: {
        organizationId,
        status: { in: [FeedbackStatus.OPEN, FeedbackStatus.ACCEPTED] },
        processNode: {
          positions: {
            some: {
              role: ResponsibilityRole.OWNER,
              position: { assignments: { some: { ...activeOn(today()), person: { userId } } } }
            }
          }
        }
      },
      include: FEEDBACK_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    response.json(items.map((item) => mapFeedback(item, userId)));
  } catch (error) {
    next(error);
  }
});

// --- #35 UX-01c globalne vyhladavanie ---

// full-text: DB funkcia pb_search_vector (migracia search_function) — bez diakritiky, oddelovace kodov ako medzery

/** Skladanie po znakoch (dlzka ostava) — aby sa poloha zhody dala preniest do povodneho textu. */
function foldChars(text: string): string {
  return [...text].map((char) => char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().charAt(0) || char).join('');
}

/** Slova z dopytu: len pismena a cislice (nic, co by tsquery vykladal ako operator). */
function searchTokens(query: string): string[] {
  return [...new Set(foldChars(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 8);
}

/** Uryvok okolo prvej zhody — text bez HTML, poloha zhody v uryvku. */
function searchSnippet(body: string, tokens: string[]): { text: string; start: number; length: number } {
  const plain = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const folded = foldChars(plain);
  let index = -1;
  let length = 0;
  for (const token of tokens) {
    const found = folded.search(new RegExp(`(^|[^\\p{L}\\p{N}])${token}`, 'u'));
    if (found >= 0 && (index < 0 || found < index)) {
      index = found + (folded[found] === token[0] ? 0 : 1);
      length = token.length;
    }
  }
  if (index < 0) return { text: plain.slice(0, 160), start: 0, length: 0 };
  const from = Math.max(0, index - 60);
  const to = Math.min(plain.length, index + length + 100);
  const prefix = from > 0 ? '…' : '';
  return { text: `${prefix}${plain.slice(from, to)}${to < plain.length ? '…' : ''}`, start: index - from + prefix.length, length };
}

/**
 * Hlada v procesoch (navrh, platne a naplanovane verzie, archiv nahradenych
 * verzii), pracovnych miestach a nazvoch dokumentov — vzdy len vo firme
 * prihlaseneho, rovnako ako ostatne cesty API (scenar 7).
 */
app.get('/api/search', async (request, response, next) => {
  try {
    const { organizationId } = auth(request);
    const raw = String(request.query['q'] ?? '').slice(0, 200);
    const tokens = searchTokens(raw);
    if (tokens.join('').length < 2) {
      response.json({ query: raw, processes: [], positions: [], documents: [], systems: [] });
      return;
    }
    const tsquery = tokens.map((token) => `${token}:*`).join(' & ');

    const drafts = await prisma.$queryRaw<Array<{ id: string; name: string; code: string | null; body: string; rank: number }>>`
      SELECT n.id, n.name, n.code, d.body, ts_rank(pb_search_vector(d.body), to_tsquery('simple', ${tsquery})) AS rank
      FROM "ProcessNode" n
      CROSS JOIN LATERAL (
        SELECT concat_ws(' ', n.name, n.code, n.description, n.trigger, n.outcome, n."descriptionText",
          (SELECT string_agg(concat_ws(' ', a.title, a.description), ' ') FROM "ProcessActivity" a WHERE a."processNodeId" = n.id),
          -- #45 — hodnoty vlastnych poli (bez ID poli)
          (SELECT string_agg(f.value, ' ') FROM jsonb_each_text(CASE WHEN jsonb_typeof(n."customFields") = 'object' THEN n."customFields" ELSE '{}'::jsonb END) f)) AS body
      ) d
      WHERE n."organizationId" = ${organizationId} AND n.type = 'PROCESS'
        AND pb_search_vector(d.body) @@ to_tsquery('simple', ${tsquery})
      ORDER BY rank DESC
      LIMIT 50`;

    const versions = await prisma.$queryRaw<Array<{ id: string; revision: number; name: string; code: string | null; body: string; rank: number }>>`
      SELECT v."processNodeId" AS id, v.revision, v.snapshot->>'name' AS name, v.snapshot->>'code' AS code, d.body,
        ts_rank(pb_search_vector(d.body), to_tsquery('simple', ${tsquery})) AS rank
      FROM "ProcessVersion" v
      CROSS JOIN LATERAL (
        SELECT concat_ws(' ', v.snapshot->>'name', v.snapshot->>'code', v.snapshot->>'purpose', v.snapshot->>'trigger', v.snapshot->>'outcome', v.snapshot->>'descriptionText',
          (SELECT string_agg(concat_ws(' ', e->>'title', e->>'description'), ' ') FROM jsonb_array_elements(COALESCE(v.snapshot->'activities', '[]'::jsonb)) e),
          (SELECT string_agg(f.value, ' ') FROM jsonb_each_text(CASE WHEN jsonb_typeof(v.snapshot->'customFields') = 'object' THEN v.snapshot->'customFields' ELSE '{}'::jsonb END) f)) AS body
      ) d
      WHERE v."organizationId" = ${organizationId}
        AND pb_search_vector(d.body) @@ to_tsquery('simple', ${tsquery})
      ORDER BY rank DESC
      LIMIT 100`;

    const positions = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT p.id, p.name FROM "OrgPosition" p
      WHERE p."organizationId" = ${organizationId}
        AND pb_search_vector(p.name) @@ to_tsquery('simple', ${tsquery})
      ORDER BY p.name LIMIT 20`;

    // #43 — IT systemy podla nazvu, skratky a dodavatela
    const systems = await prisma.$queryRaw<Array<{ id: string; name: string; code: string | null; archived: boolean }>>`
      SELECT s.id, s.name, s.code, s."archivedAt" IS NOT NULL AS archived FROM "ItSystem" s
      WHERE s."organizationId" = ${organizationId}
        AND pb_search_vector(concat_ws(' ', s.name, s.code, s.vendor)) @@ to_tsquery('simple', ${tsquery})
      ORDER BY s.name LIMIT 20`;

    const documents = await prisma.$queryRaw<Array<{ id: string; fileName: string; processId: string | null; processName: string | null }>>`
      SELECT a.id, a."fileName", a."processNodeId" AS "processId", n.name AS "processName"
      FROM "Attachment" a LEFT JOIN "ProcessNode" n ON n.id = a."processNodeId" AND n."organizationId" = a."organizationId"
      WHERE a."organizationId" = ${organizationId}
        AND pb_search_vector(a."fileName") @@ to_tsquery('simple', ${tsquery})
      ORDER BY a."fileName" LIMIT 20`;

    // verzie zaradit: platna / naplanovana = publikovane, ostatne = archiv
    const now = today();
    const processIds = [...new Set([...drafts.map((row) => row.id), ...versions.map((row) => row.id)])];
    const allVersions = await prisma.processVersion.findMany({
      where: { processNodeId: { in: processIds }, organizationId },
      select: { id: true, processNodeId: true, revision: true, effectiveFrom: true, effectiveTo: true }
    });
    const stateOf = (processId: string, revision: number): 'effective' | 'scheduled' | 'archive' => {
      const own = allVersions.filter((item) => item.processNodeId === processId);
      const version = own.find((item) => item.revision === revision);
      if (!version) return 'archive';
      if (version.effectiveFrom > now) return 'scheduled';
      return pickEffective(own, now)?.revision === revision ? 'effective' : 'archive';
    };

    type Match = { kind: 'published' | 'draft' | 'archive'; revision: number | null; state?: 'effective' | 'scheduled'; snippet: ReturnType<typeof searchSnippet>; rank: number };
    const byProcess = new Map<string, { id: string; name: string; code: string; matches: Match[]; rank: number }>();
    const add = (id: string, name: string, code: string | null, match: Match) => {
      const entry = byProcess.get(id) ?? { id, name, code: code ?? '', matches: [], rank: 0 };
      entry.matches.push(match);
      entry.rank = Math.max(entry.rank, match.rank);
      byProcess.set(id, entry);
    };
    for (const row of versions) {
      const state = stateOf(row.id, row.revision);
      add(row.id, row.name, row.code, {
        kind: state === 'archive' ? 'archive' : 'published',
        revision: row.revision,
        ...(state === 'archive' ? {} : { state }),
        snippet: searchSnippet(row.body, tokens),
        rank: Number(row.rank)
      });
    }
    for (const row of drafts) {
      const snippet = searchSnippet(row.body, tokens);
      const entry = byProcess.get(row.id);
      // navrh zhodny s publikovanou verziou netreba ukazovat dvakrat
      if (entry?.matches.some((match) => match.kind === 'published' && match.snippet.text === snippet.text)) continue;
      add(row.id, entry?.name ?? row.name, entry?.code ?? row.code, { kind: 'draft', revision: null, snippet, rank: Number(row.rank) });
    }
    const order = { published: 0, draft: 1, archive: 2 };
    const processes = [...byProcess.values()]
      .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, 'sk'))
      .map(({ rank: _rank, ...entry }) => ({
        ...entry,
        matches: entry.matches
          .sort((a, b) => order[a.kind] - order[b.kind] || (b.revision ?? 0) - (a.revision ?? 0))
          .slice(0, 4)
          .map(({ rank: _r, ...match }) => match)
      }));

    response.json({ query: raw, processes, positions, documents, systems });
  } catch (error) {
    next(error);
  }
});

// --- #40 QUAL-01 pripravenost evidencie (profil Kvalita a audit) ---

type ReadinessState = 'done' | 'attention' | 'na' | 'unverified';
type ReadinessEntry = {
  key: string;
  label: string;
  state: ReadinessState;
  detail: string;
  /** z coho sa posudzovalo (platna verzia / navrh / zaznamy) */
  source: string;
  /** kde sa to napravi */
  fix: 'publish' | 'relations' | 'steps' | 'control' | 'quality' | 'evidence';
  exception?: { id: string; reason: string; markedBy: string | null; approvedBy: string | null; pending: boolean };
};

/** Kvalitu posudzuje, kto upravuje procesy, alebo ISO auditor — bezny zamestnanec kontrolne otazky nevidi. */
function canAssessQuality(request: express.Request): boolean {
  return hasPermission(request, 'process:write') || hasPermission(request, 'iso:write');
}

/**
 * Pripravenost evidencie ako zoznam stavov: hotove / potrebuje pozornost /
 * neaplikovatelne s dovodom (a schvalenim) / neoverene. Nikdy percento ani
 * „zhoda s normou“. Posudzuje sa platna verzia (to, co sa dnes robi), bez nej
 * navrh; existujuci postup neznamena, ze sa vykonal — to dokladaju zaznamy.
 */
async function qualityReadiness(node: any): Promise<{ source: string; items: ReadinessEntry[] }> {
  const now = today();
  const versions = await prisma.processVersion.findMany({
    where: { processNodeId: node.id },
    select: { id: true, revision: true, effectiveFrom: true, effectiveTo: true, nextReviewAt: true, snapshot: true }
  });
  const effective = pickEffective(versions, now);
  const snapshot = effective?.snapshot as unknown as ProcessSnapshot | undefined;
  const source = effective ? `platná v${effective.revision}` : 'návrh (zatiaľ nepublikovaný)';
  const draft = {
    inputs: node.inputs ?? [],
    outputs: node.outputs ?? [],
    outcome: node.outcome ?? '',
    successMeasure: node.successMeasure ?? '',
    risks: node.risks ?? '',
    evidenceRequirements: node.evidenceRequirements ?? [],
    hasAccountable: (node.activities ?? []).some((activity: any) => (activity.responsibilities ?? []).some((item: any) => item.role === RaciRole.ACCOUNTABLE))
  };
  const content = snapshot
    ? {
        inputs: snapshot.inputs ?? [],
        outputs: snapshot.outputs ?? [],
        outcome: snapshot.outcome ?? '',
        successMeasure: snapshot.successMeasure ?? '',
        risks: snapshot.risks ?? '',
        evidenceRequirements: snapshot.evidenceRequirements ?? [],
        hasAccountable: (snapshot.activities ?? []).some((activity) => (activity.raci ?? []).some((item) => item.role === 'A'))
      }
    : draft;

  const items: ReadinessEntry[] = [];
  const check = (key: string, label: string, ok: boolean, draftOk: boolean, fix: ReadinessEntry['fix'], okDetail: string, missing: string) => {
    items.push({
      key, label, fix, source,
      state: ok ? 'done' : 'attention',
      detail: ok ? okDetail : draftOk && snapshot ? 'Doplnené v návrhu — začne platiť po publikovaní.' : missing
    });
  };

  check('procedure', 'Platný postup', Boolean(effective), false, 'publish',
    effective ? `v${effective.revision} platí od ${day(effective.effectiveFrom)}` : '',
    'Proces nemá platnú verziu — publikujte ho.');
  const owner = (node.positions ?? []).find((link: any) => link.role === ResponsibilityRole.OWNER);
  const ownerHeld = Boolean(owner) && (owner.position?.assignments ?? []).length > 0;
  check('owner', 'Vlastník procesu (obsadené miesto)', ownerHeld, false, 'relations',
    ownerHeld ? `${owner.position.name} — ${owner.position.assignments.map((a: any) => a.person?.name).join(', ')}` : '',
    !owner ? 'Proces nemá vlastníka.' : owner.position?.archivedAt ? `Miesto ${owner.position.name} je archivované — určte nové.` : `Miesto ${owner.position?.name ?? ''} nikto nezastáva.`);
  check('accountable', 'Zodpovedný (A) aspoň pri jednom kroku', content.hasAccountable, draft.hasAccountable, 'steps',
    'Určené v RACI krokov.', 'Pri krokoch nie je nikto zodpovedný (A).');
  check('inputs', 'Vstupy procesu', content.inputs.length > 0, draft.inputs.length > 0, 'control',
    content.inputs.join(', '), 'Doplňte, čo proces potrebuje na začatie (napr. faktúra, objednávka).');
  check('outputs', 'Výstupy a výsledok', content.outputs.length > 0 || Boolean(content.outcome.trim()), draft.outputs.length > 0 || Boolean(draft.outcome.trim()), 'control',
    [...content.outputs, content.outcome].filter(Boolean).join(', '), 'Doplňte, čo proces prinesie.');
  check('measure', 'Meradlo úspechu', Boolean(content.successMeasure.trim()), Boolean(draft.successMeasure.trim()), 'quality',
    content.successMeasure, 'Doplňte, podľa čoho viete, že proces funguje (napr. faktúry uhradené do splatnosti).');
  check('risks', 'Riziká a ako im predchádzate', Boolean(content.risks.trim()), Boolean(draft.risks.trim()), 'quality',
    'Popísané.', 'Doplňte: čo sa môže pokaziť a čo robíte, aby sa to nestalo?');

  // termin revizie je sucast publikovanej verzie
  const review = effective?.nextReviewAt ?? null;
  items.push({
    key: 'review', label: 'Termín revízie', fix: 'publish', source,
    state: review && review >= now ? 'done' : 'attention',
    detail: !effective ? 'Určí sa pri publikovaní.' : !review ? 'Platná verzia nemá termín revízie — zadáte ho pri ďalšom publikovaní.'
      : review < now ? `Revízia po termíne (${day(review)}).` : `Do ${day(review)}.`
  });

  check('evidenceDefined', 'Čo sa uchováva ako záznam o vykonaní', content.evidenceRequirements.length > 0, draft.evidenceRequirements.length > 0, 'quality',
    content.evidenceRequirements.join(', '), 'Doplňte, aký záznam dokladá, že sa proces vykonal (napr. podpísaný protokol kontroly).');

  // zaznamy o vykonani: postup existuje ≠ vykonal sa
  const requirements: string[] = content.evidenceRequirements;
  const records = requirements.length
    ? await prisma.evidenceRecord.findMany({
        where: { processNodeId: node.id, requirement: { in: requirements } },
        orderBy: { performedOn: 'desc' },
        select: { requirement: true, performedOn: true, createdBy: { select: { name: true } } }
      })
    : [];
  const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  for (const requirement of requirements) {
    const latest = records.find((record) => record.requirement === requirement);
    items.push({
      key: `evidence:${requirement}`, label: `Záznam: ${requirement}`, fix: 'evidence', source: 'záznamy o vykonaní',
      state: !latest ? 'attention' : latest.performedOn < yearAgo ? 'unverified' : 'done',
      detail: !latest
        ? 'Chýba — postup existuje, no záznam o vykonaní nie.'
        : latest.performedOn < yearAgo
          ? `Posledný záznam ${day(latest.performedOn)} je starší ako 12 mesiacov — overte, či sa vykonáva.`
          : `Posledný záznam ${day(latest.performedOn)}${latest.createdBy?.name ? ` (${latest.createdBy.name})` : ''}.`
    });
  }

  // neaplikovatelne: len s dovodom a schvalenim inym clovekom
  const exceptions = await prisma.readinessException.findMany({
    where: { processNodeId: node.id },
    include: { markedBy: { select: { name: true } }, approvedBy: { select: { name: true } } }
  });
  for (const item of items) {
    const exception = exceptions.find((entry) => entry.itemKey === item.key);
    if (!exception) continue;
    item.exception = { id: exception.id, reason: exception.reason, markedBy: exception.markedBy?.name ?? null, approvedBy: exception.approvedBy?.name ?? null, pending: !exception.approvedAt };
    if (exception.approvedAt && item.state !== 'done') {
      item.state = 'na';
      item.detail = `Neaplikovateľné: ${exception.reason}`;
    }
  }
  return { source, items };
}

async function requireQualityProcess(request: express.Request, processId: string) {
  const node = await prisma.processNode.findFirst({
    where: { id: processId, organizationId: orgScope(request), type: ProcessNodeType.PROCESS },
    include: { positions: responsibilityInclude(), activities: activityInclude() }
  });
  if (!node) throw new HttpError(404, 'Proces sa nenasiel.');
  return node;
}

app.get('/api/processes/:processId/quality', async (request, response, next) => {
  try {
    const node = await requireQualityProcess(request, String(request.params.processId));
    if (!canAssessQuality(request)) throw new HttpError(403, 'Pripravenosť evidencie vidí správca kvality a ISO auditor.');
    const organization = await prisma.organization.findUnique({ where: { id: node.organizationId }, select: { qualityProfile: true } });
    // scenar 4 — bez profilu sa kontrolne otazky neukazuju
    if (!organization?.qualityProfile) {
      response.json({ enabled: false, items: [] });
      return;
    }
    const readiness = await qualityReadiness(node);
    response.json({
      enabled: true,
      assessedAt: new Date().toISOString(),
      note: 'Podklad pre posúdenie — nie hodnotenie zhody s normou.',
      ...readiness
    });
  } catch (error) {
    next(error);
  }
});

/** Zaznam o vykonani smie pridat editor, ISO auditor alebo ten, kto v procese dnes pracuje. */
async function canRecordEvidence(request: express.Request, node: { id: string; organizationId: string }): Promise<boolean> {
  if (canAssessQuality(request)) return true;
  return (await processStakeholders(node.organizationId, node.id)).includes(auth(request).userId);
}

app.get('/api/processes/:processId/evidence', async (request, response, next) => {
  try {
    const node = await requireQualityProcess(request, String(request.params.processId));
    if (!(await canRecordEvidence(request, node))) throw new HttpError(403, 'Záznamy o vykonaní vidia tí, ktorí v procese pracujú, a správca kvality.');
    const records = await prisma.evidenceRecord.findMany({
      where: { processNodeId: node.id },
      orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { createdBy: { select: { name: true } } }
    });
    response.json(records.map((record) => ({
      id: record.id,
      requirement: record.requirement,
      performedOn: day(record.performedOn),
      note: record.note,
      attachmentId: record.attachmentId,
      createdBy: record.createdBy?.name ?? null,
      createdAt: record.createdAt.toISOString()
    })));
  } catch (error) {
    next(error);
  }
});

app.post('/api/processes/:processId/evidence', async (request, response, next) => {
  try {
    const node = await requireQualityProcess(request, String(request.params.processId));
    if (!(await canRecordEvidence(request, node))) throw new HttpError(403, 'Záznam o vykonaní pridá ten, kto v procese pracuje, alebo správca kvality.');
    const requirement = cleanText(request.body?.requirement, 300);
    // len k poziadavke, ktoru proces ma (v navrhu alebo platnej verzii)
    const versions = await prisma.processVersion.findMany({ where: { processNodeId: node.id }, select: { revision: true, effectiveFrom: true, effectiveTo: true, snapshot: true } });
    const effectiveSnapshot = pickEffective(versions, today())?.snapshot as unknown as ProcessSnapshot | undefined;
    const known = new Set([...(node.evidenceRequirements ?? []), ...(effectiveSnapshot?.evidenceRequirements ?? [])]);
    if (!requirement || !known.has(requirement)) throw new HttpError(400, 'Vyberte, ktorý záznam procesu dokladáte.');
    const performedOn = parseDay(request.body?.performedOn, today(), 'performedOn')!;
    if (performedOn > today()) throw new HttpError(400, 'Záznam o vykonaní nemôže byť z budúcnosti.');
    const attachmentId = typeof request.body?.attachmentId === 'string' && request.body.attachmentId ? request.body.attachmentId : null;
    if (attachmentId && !(await prisma.attachment.findFirst({ where: { id: attachmentId, organizationId: node.organizationId, processNodeId: node.id }, select: { id: true } }))) {
      throw new HttpError(404, 'Dokument sa nenasiel.');
    }
    const record = await prisma.evidenceRecord.create({
      data: {
        organizationId: node.organizationId,
        processNodeId: node.id,
        requirement,
        performedOn,
        note: cleanText(request.body?.note, 1000),
        attachmentId,
        createdById: auth(request).userId
      },
      include: { createdBy: { select: { name: true } } }
    });
    response.status(201).json({ id: record.id, requirement: record.requirement, performedOn: day(record.performedOn), note: record.note, createdBy: record.createdBy?.name ?? null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/processes/:processId/readiness-exceptions', async (request, response, next) => {
  try {
    const node = await requireQualityProcess(request, String(request.params.processId));
    const itemKey = cleanText(request.body?.itemKey, 320);
    const reason = cleanText(request.body?.reason, 1000);
    if (!itemKey) throw new HttpError(400, 'Chýba položka pripravenosti.');
    if (!reason) throw new HttpError(400, 'Uveďte dôvod, prečo položka pre tento proces neplatí.');
    // platny postup sa nedá oznacit ako neaplikovatelny — bez neho nie je co posudzovat
    if (itemKey === 'procedure') throw new HttpError(400, 'Platný postup nemožno označiť ako neaplikovateľný.');
    const { userId } = auth(request);
    const exception = await prisma.readinessException.upsert({
      where: { processNodeId_itemKey: { processNodeId: node.id, itemKey } },
      create: { organizationId: node.organizationId, processNodeId: node.id, itemKey, reason, markedById: userId },
      // zmena dovodu = nove posudenie, schvalenie sa rusi
      update: { reason, markedById: userId, markedAt: new Date(), approvedById: null, approvedAt: null }
    });
    response.status(201).json({ id: exception.id, itemKey: exception.itemKey, pending: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/readiness-exceptions/:exceptionId/approve', async (request, response, next) => {
  try {
    const exception = await prisma.readinessException.findFirst({ where: { id: String(request.params.exceptionId), organizationId: orgScope(request) } });
    if (!exception) throw new HttpError(404, 'Výnimka sa nenašla.');
    const { userId } = auth(request);
    if (exception.markedById === userId) throw new HttpError(403, 'Vlastný návrh na výnimku schváli niekto iný.');
    await prisma.readinessException.update({ where: { id: exception.id }, data: { approvedById: userId, approvedAt: new Date() } });
    response.json({ id: exception.id, pending: false });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/readiness-exceptions/:exceptionId', async (request, response, next) => {
  try {
    const exception = await prisma.readinessException.findFirst({ where: { id: String(request.params.exceptionId), organizationId: orgScope(request) } });
    if (!exception) throw new HttpError(404, 'Výnimka sa nenašla.');
    await prisma.readinessException.delete({ where: { id: exception.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- #34 UX-01b prehlad: co treba vo firme napravit ---

type OverviewItem = { id: string; name: string; code: string; detail: string; overdue?: boolean };
const OVERVIEW_KEYS = ['review', 'pendingApproval', 'feedback', 'staleDocuments', 'ownerless', 'vacant', 'retiredSystems', 'incomplete', 'unpublished', 'pendingChanges'] as const;

/**
 * Kazda kategoria je zoznam procesov s konkretnym problemom a popisom, co
 * chyba — pocet na karte je dlzka zoznamu, nie odhad ani skore. „Zdravie
 * procesu“ = co mu chyba, nie percento zhody s normou.
 */
app.get('/api/overview', async (request, response, next) => {
  try {
    const { organizationId } = auth(request);
    const at = parseDay(request.query['at'], today(), 'at')!;
    const soon = new Date(at.getTime() + 30 * 24 * 60 * 60 * 1000);
    const nodes = await prisma.processNode.findMany({
      where: { organizationId, type: ProcessNodeType.PROCESS },
      include: { positions: responsibilityInclude(at), ...publicationInclude(), activities: activityInclude(at) },
      orderBy: { name: 'asc' }
    });

    // #36 — nevybavene podnety (otvorene aj prijate, kym nie su hotove)
    const feedback = await prisma.processFeedback.groupBy({
      by: ['processNodeId', 'kind'],
      where: { organizationId, status: { in: [FeedbackStatus.OPEN, FeedbackStatus.ACCEPTED] } },
      _count: { _all: true }
    });
    const feedbackByProcess = new Map<string, { errors: number; improvements: number }>();
    for (const row of feedback) {
      const entry = feedbackByProcess.get(row.processNodeId) ?? { errors: 0, improvements: 0 };
      if (row.kind === FeedbackKind.ERROR) entry.errors += row._count._all;
      else entry.improvements += row._count._all;
      feedbackByProcess.set(row.processNodeId, entry);
    }

    // #31 — platne verzie, ktore odkazuju na nahradenu verziu dokumentu
    const effectiveIds = nodes.flatMap((node) => pickEffective(node.versions, at)?.id ?? []);
    const effectiveSnapshots = effectiveIds.length
      ? await prisma.processVersion.findMany({ where: { id: { in: effectiveIds } }, select: { id: true, snapshot: true } })
      : [];
    const snapshotById = new Map(effectiveSnapshots.map((item) => [item.id, item.snapshot as unknown as ProcessSnapshot]));
    const referencedDocuments = [...new Set(effectiveSnapshots.flatMap((item) =>
      ((item.snapshot as unknown as ProcessSnapshot).documents ?? []).map((document) => document.documentId ?? document.id)))];
    const documentVersions = referencedDocuments.length
      ? await prisma.attachment.findMany({ where: { organizationId, documentId: { in: referencedDocuments } }, select: DOCUMENT_VERSION_SELECT })
      : [];
    const currentDocument = new Map(currentDocumentVersions(documentVersions, at).map((item) => [item.documentId ?? item.id, item]));
    // #43 — vyradene IT systemy, ktore este nejaky proces pouziva
    const retiredSystems = new Map((await prisma.itSystem.findMany({
      where: { organizationId, archivedAt: { not: null } },
      select: { id: true, name: true }
    })).map((system) => [system.id, system.name]));

    const categories = Object.fromEntries(OVERVIEW_KEYS.map((key) => [key, [] as OverviewItem[]])) as Record<(typeof OVERVIEW_KEYS)[number], OverviewItem[]>;
    for (const node of nodes) {
      const base = { id: node.id, name: node.name, code: node.code ?? '' };
      const publication = publicationState(node).publication!;
      const effective = pickEffective(node.versions, at);

      // revizia platnej verzie: po termine alebo do 30 dni
      if (effective?.nextReviewAt && effective.nextReviewAt <= soon) {
        const overdue = effective.nextReviewAt < at;
        categories.review.push({ ...base, overdue, detail: `${overdue ? 'Revízia po termíne' : 'Revízia do'} ${day(effective.nextReviewAt)} (v${effective.revision})` });
      }
      if (publication.pendingApproval) {
        categories.pendingApproval.push({ ...base, detail: `Návrh odoslal(a) ${publication.pendingApproval.requestedBy ?? '—'} ${new Intl.DateTimeFormat('sv-SE', { timeZone: BUSINESS_TIMEZONE }).format(new Date(publication.pendingApproval.createdAt))}` });
      }
      const effectiveSnapshot = effective ? snapshotById.get((effective as { id?: string }).id ?? '') : undefined;
      const stale = (effectiveSnapshot?.documents ?? []).flatMap((document) => {
        const current = currentDocument.get(document.documentId ?? document.id);
        return current && current.id !== document.id && (current.version ?? 1) > (document.version ?? 1)
          ? [`${document.name} (v${document.version ?? 1}, platí v${current.version})`]
          : [];
      });
      if (stale.length > 0) {
        categories.staleDocuments.push({ ...base, detail: `Platná v${effective!.revision} odkazuje na nahradený dokument: ${stale.join('; ')}` });
      }
      const open = feedbackByProcess.get(node.id);
      if (open) {
        const parts = [open.errors ? `chyby: ${open.errors}` : '', open.improvements ? `návrhy zlepšenia: ${open.improvements}` : ''].filter(Boolean);
        categories.feedback.push({ ...base, detail: `Nevybavené podnety — ${parts.join(', ')}` });
      }
      const owner = node.positions.find((link) => link.role === ResponsibilityRole.OWNER);
      if (!owner) categories.ownerless.push({ ...base, detail: 'Nikto nezodpovedá za proces — určte miesto vlastníka' });

      // neobsadene miesta, na ktorych proces zavisi (vlastnik, vykonavatelia, kroky)
      const vacant = new Map<string, string[]>();
      const note = (positionName: string, where: string) => vacant.set(positionName, [...(vacant.get(positionName) ?? []), where]);
      for (const link of node.positions) {
        if ((link.position?.assignments ?? []).length === 0) note(`${link.position?.name ?? ''}${link.position?.archivedAt ? ' (archivované miesto)' : ''}`, link.role === ResponsibilityRole.OWNER ? 'vlastník' : 'vykonávateľ');
      }
      node.activities.forEach((activity, index) => {
        for (const item of activity.responsibilities) {
          if (item.position && item.position.assignments.length === 0) note(`${item.position.name}${item.position.archivedAt ? ' (archivované miesto)' : ''}`, `krok ${index + 1} (${RACI_CODE[item.role]})`);
        }
      });
      if (vacant.size > 0) {
        categories.vacant.push({ ...base, detail: `Neobsadené: ${[...vacant].map(([name, where]) => `${name} — ${[...new Set(where)].join(', ')}`).join('; ')}` });
      }
      if (retiredSystems.size > 0) {
        // navrh aj platna verzia — ludia podla nej pracuju, kym ju nenahradi nova
        const used = new Set([
          ...(node.systemIds ?? []),
          ...node.activities.flatMap((activity) => activity.systemIds ?? []),
          ...(effectiveSnapshot?.systemIds ?? []),
          ...(effectiveSnapshot?.activities ?? []).flatMap((activity) => activity.systemIds ?? [])
        ]);
        const names = [...used].flatMap((id) => retiredSystems.get(id) ?? []).sort((a, b) => a.localeCompare(b, 'sk'));
        if (names.length > 0) {
          categories.retiredSystems.push({ ...base, detail: `Používa vyradený systém: ${names.join(', ')} — nahraďte ho alebo upravte postup` });
        }
      }

      const missing = publishReadiness(node).filter((item) => item.required && !item.ok);
      if (missing.length > 0) {
        categories.incomplete.push({ ...base, detail: `Chýba: ${missing.map((item) => item.label.split(' — ')[0].toLowerCase()).join(', ')}` });
      }
      if (!effective) {
        const scheduled = publication.scheduled;
        categories.unpublished.push({ ...base, detail: scheduled ? `v${scheduled.revision} začne platiť ${scheduled.effectiveFrom}` : 'Zatiaľ nepublikovaný — kolegovia ho nevidia ako platný postup' });
      } else if (publication.hasDraftChanges && !publication.pendingApproval) {
        categories.pendingChanges.push({ ...base, detail: `Návrh sa líši od v${publication.latestRevision} — zmeny ešte neplatia` });
      }
    }

    response.json({
      at: day(at),
      processCount: nodes.length,
      categories: OVERVIEW_KEYS.map((key) => ({ key, count: categories[key].length, items: categories[key] }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/people', async (request, response, next) => {
  try {
    const people = await prisma.person.findMany({
      where: { organizationId: orgScope(request) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: PERSON_INCLUDE
    });
    response.json(people.map(mapPerson));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/people', async (request, response, next) => {
  try {
    const name = cleanText(request.body?.name);
    if (!name) throw new HttpError(400, 'Meno osoby je povinne.');
    const person = await prisma.person.create({
      data: {
        organizationId: orgScope(request),
        name,
        email: cleanText(request.body?.email)?.toLowerCase() ?? null,
        phone: cleanText(request.body?.phone, 50),
        note: cleanText(request.body?.note, 1000)
      },
      include: PERSON_INCLUDE
    });
    response.status(201).json(mapPerson(person));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/people/:personId', async (request, response, next) => {
  try {
    const current = await requirePerson(request, request.params.personId);
    const body = request.body ?? {};
    if (body.name !== undefined && !cleanText(body.name)) throw new HttpError(400, 'Meno osoby je povinne.');
    const person = await prisma.person.update({
      where: { id: current.id },
      data: {
        name: body.name === undefined ? undefined : cleanText(body.name)!,
        email: body.email === undefined ? undefined : (cleanText(body.email)?.toLowerCase() ?? null),
        phone: body.phone === undefined ? undefined : cleanText(body.phone, 50),
        note: body.note === undefined ? undefined : cleanText(body.note, 1000),
        active: typeof body.active === 'boolean' ? body.active : undefined
      },
      include: PERSON_INCLUDE
    });
    response.json(mapPerson(person));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/people/:personId', async (request, response, next) => {
  try {
    const person = await requirePerson(request, request.params.personId);
    if (person.userId) {
      throw new HttpError(409, 'Osoba ma pouzivatelsky ucet — najprv ju odoberte z pouzivatelov firmy.');
    }
    const history = await prisma.positionAssignment.count({ where: { personId: person.id } });
    if (history > 0) {
      // mazanie by zmazalo aj historiu, kto miesto zastaval
      throw new HttpError(409, 'Osoba ma historiu obsadeni. Namiesto zmazania zaznamenajte jej odchod.');
    }
    await prisma.person.delete({ where: { id: person.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

/**
 * Odchod osoby (#14): ukonci jej obsadenia k datumu (posledny den), planovane
 * obsadenia po tomto dni zrusi a osobu oznaci ako neaktivnu. Historia ostava.
 * Vrati miesta, ktore tym ostali neobsadene — tie treba riesit.
 */
app.post('/api/people/:personId/leave', async (request, response, next) => {
  try {
    const person = await requirePerson(request, request.params.personId);
    const lastDay = parseDay(request.body?.date, today(), 'date')!;

    const open = await prisma.positionAssignment.findMany({
      where: { personId: person.id, OR: [{ validTo: null }, { validTo: { gt: lastDay } }] }
    });
    const planned = open.filter((assignment) => assignment.validFrom > lastDay).map((assignment) => assignment.id);
    const ending = open.filter((assignment) => assignment.validFrom <= lastDay).map((assignment) => assignment.id);

    await prisma.$transaction(async (tx) => {
      await tx.positionAssignment.deleteMany({ where: { id: { in: planned } } });
      await tx.positionAssignment.updateMany({ where: { id: { in: ending } }, data: { validTo: lastDay } });
      await tx.person.update({ where: { id: person.id }, data: { active: false } });
    });

    // miesta, ktore po odchode nema kto zastavat
    const dayAfter = new Date(lastDay.getTime() + 24 * 60 * 60 * 1000);
    const positionIds = [...new Set(open.map((assignment) => assignment.positionId))];
    const stillHeld = await prisma.positionAssignment.findMany({
      where: { positionId: { in: positionIds }, ...activeOn(dayAfter) },
      select: { positionId: true }
    });
    const held = new Set(stillHeld.map((item) => item.positionId));
    const vacated = await prisma.orgPosition.findMany({
      where: { id: { in: positionIds.filter((id) => !held.has(id)) } },
      select: { id: true, name: true }
    });

    const fresh = await prisma.person.findUnique({ where: { id: person.id }, include: PERSON_INCLUDE });
    response.json({ person: mapPerson(fresh), endedAssignments: ending.length, vacatedPositions: vacated });
  } catch (error) {
    next(error);
  }
});

app.post('/api/positions/:positionId/assignments', async (request, response, next) => {
  try {
    const position = await requirePosition(request, request.params.positionId);
    if (position.archivedAt) throw new HttpError(409, 'Miesto je archivovane — obnovte ho alebo vyberte ine.');
    const person = await requirePerson(request, String(request.body?.personId ?? ''));
    if (!person.active) throw new HttpError(409, 'Osoba je oznacena ako neaktivna (odisla z firmy).');

    const validFrom = parseDay(request.body?.validFrom, today(), 'validFrom')!;
    const validTo = parseDay(request.body?.validTo, null, 'validTo');
    if (validTo && validTo < validFrom) throw new HttpError(400, 'Koniec obsadenia nemoze byt pred zaciatkom.');

    // ta ista osoba na tom istom mieste v prekryvajucom sa obdobi
    const overlap = await prisma.positionAssignment.findFirst({
      where: {
        positionId: position.id,
        personId: person.id,
        ...(validTo ? { validFrom: { lte: validTo } } : {}),
        OR: [{ validTo: null }, { validTo: { gte: validFrom } }]
      }
    });
    if (overlap) throw new HttpError(409, 'Osoba uz toto miesto v danom obdobi zastava.');

    const assignment = await prisma.positionAssignment.create({
      data: { organizationId: position.organizationId, positionId: position.id, personId: person.id, validFrom, validTo }
    });
    await emitAssignmentChanged(request, assignment.id);
    response.status(201).json({ id: assignment.id, validFrom: day(assignment.validFrom), validTo: day(assignment.validTo) });
  } catch (error) {
    next(error);
  }
});

/** #38 — cloveku s uctom: odkedy (a dokedy) zastava miesto — jeho procesy su v Moja praca. */
async function emitAssignmentChanged(request: express.Request, assignmentId: string): Promise<void> {
  const assignment = await prisma.positionAssignment.findUnique({
    where: { id: assignmentId },
    select: { organizationId: true, validFrom: true, validTo: true, position: { select: { name: true } }, person: { select: { userId: true } } }
  });
  if (!assignment?.person.userId) return;
  await emitEvent(prisma, {
    organizationId: assignment.organizationId,
    type: 'PositionAssignmentChanged',
    actorId: auth(request).userId,
    payload: { positionName: assignment.position.name, validFrom: day(assignment.validFrom), validTo: day(assignment.validTo), userId: assignment.person.userId }
  });
}

/** Zmena obdobia — typicky ukoncenie (validTo), alebo oprava zaciatku. */
app.patch('/api/assignments/:assignmentId', async (request, response, next) => {
  try {
    const current = await requireAssignment(request, request.params.assignmentId);
    const validFrom = parseDay(request.body?.validFrom, current.validFrom, 'validFrom')!;
    const validTo = request.body?.validTo === undefined
      ? current.validTo
      : parseDay(request.body.validTo, null, 'validTo');
    if (validTo && validTo < validFrom) throw new HttpError(400, 'Koniec obsadenia nemoze byt pred zaciatkom.');
    const assignment = await prisma.positionAssignment.update({
      where: { id: current.id },
      data: { validFrom, validTo }
    });
    if (assignment.validFrom.getTime() !== current.validFrom.getTime() || (assignment.validTo?.getTime() ?? null) !== (current.validTo?.getTime() ?? null)) {
      await emitAssignmentChanged(request, assignment.id);
    }
    response.json({ id: assignment.id, validFrom: day(assignment.validFrom), validTo: day(assignment.validTo) });
  } catch (error) {
    next(error);
  }
});

/** Zmazanie len pre omylom zadane obsadenie — bezny odchod je ukoncenie. */
app.delete('/api/assignments/:assignmentId', async (request, response, next) => {
  try {
    const assignment = await requireAssignment(request, request.params.assignmentId);
    await prisma.positionAssignment.delete({ where: { id: assignment.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- #16 profil prace a verzie popisu prace ---

async function requireJobProfile(request: express.Request, jobProfileId: string) {
  const profile = await prisma.jobProfile.findFirst({ where: { id: jobProfileId, organizationId: orgScope(request) } });
  if (!profile) throw new HttpError(404, 'Profil prace sa nenasiel.');
  return profile;
}

async function requireJobVersion(request: express.Request, versionId: string) {
  const version = await prisma.jobDescriptionVersion.findFirst({ where: { id: versionId, organizationId: orgScope(request) } });
  if (!version) throw new HttpError(404, 'Verzia popisu prace sa nenasla.');
  return version;
}

/**
 * Stav verzie pre zobrazenie. Ulozene su len DRAFT/PUBLISHED — ci je publikovana
 * verzia platna, planovana alebo nahradena, zavisi od datumu ucinnosti.
 */
function describeVersions(versions: any[]) {
  const now = today();
  const published = versions
    .filter((version) => version.status === JobDescriptionStatus.PUBLISHED && version.effectiveFrom)
    .sort((a, b) => (b.effectiveFrom - a.effectiveFrom) || (b.version - a.version));
  const current = published.find((version) => version.effectiveFrom <= now) ?? null;

  return versions
    .slice()
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      id: version.id,
      version: version.version,
      status: version.status === JobDescriptionStatus.DRAFT
        ? 'draft'
        : version === current ? 'current' : version.effectiveFrom > now ? 'planned' : 'superseded',
      content: version.content,
      authorName: version.author?.name ?? null,
      effectiveFrom: day(version.effectiveFrom),
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
      updatedAt: version.updatedAt.toISOString()
    }));
}

function mapJobProfile(profile: any, withContent = false) {
  const versions = describeVersions(profile.versions ?? []);
  const current = versions.find((version) => version.status === 'current') ?? null;
  const draft = versions.find((version) => version.status === 'draft') ?? null;
  const strip = (version: any) => (version && !withContent ? { ...version, content: undefined } : version);
  return {
    id: profile.id,
    name: profile.name,
    summary: profile.summary ?? '',
    positionCount: profile._count?.positions ?? 0,
    currentVersion: strip(current),
    draftVersion: strip(draft),
    versions: versions.map(strip)
  };
}

const JOB_PROFILE_INCLUDE = {
  _count: { select: { positions: true } },
  versions: { include: { author: { select: { name: true } } } }
};

app.get('/api/organizations/:organizationId/job-profiles', async (request, response, next) => {
  try {
    const profiles = await prisma.jobProfile.findMany({
      where: { organizationId: orgScope(request) },
      orderBy: { name: 'asc' },
      include: JOB_PROFILE_INCLUDE
    });
    response.json(profiles.map((profile) => mapJobProfile(profile)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/job-profiles', async (request, response, next) => {
  try {
    const organizationId = orgScope(request);
    const name = cleanText(request.body?.name);
    if (!name) throw new HttpError(400, 'Nazov profilu je povinny.');
    const existing = await prisma.jobProfile.findFirst({
      where: { organizationId, name: { equals: name, mode: 'insensitive' } }
    });
    if (existing) throw new HttpError(409, 'Profil s tymto nazvom uz existuje.');
    const profile = await prisma.jobProfile.create({
      data: { organizationId, name, summary: cleanText(request.body?.summary, 1000) },
      include: JOB_PROFILE_INCLUDE
    });
    response.status(201).json(mapJobProfile(profile, true));
  } catch (error) {
    next(error);
  }
});

app.get('/api/job-profiles/:jobProfileId', async (request, response, next) => {
  try {
    const profile = await requireJobProfile(request, request.params.jobProfileId);
    const full = await prisma.jobProfile.findUnique({ where: { id: profile.id }, include: JOB_PROFILE_INCLUDE });
    response.json(mapJobProfile(full, true));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/job-profiles/:jobProfileId', async (request, response, next) => {
  try {
    const current = await requireJobProfile(request, request.params.jobProfileId);
    if (request.body?.name !== undefined && !cleanText(request.body.name)) throw new HttpError(400, 'Nazov profilu je povinny.');
    const profile = await prisma.jobProfile.update({
      where: { id: current.id },
      data: {
        name: request.body?.name === undefined ? undefined : cleanText(request.body.name)!,
        summary: request.body?.summary === undefined ? undefined : cleanText(request.body.summary, 1000)
      },
      include: JOB_PROFILE_INCLUDE
    });
    response.json(mapJobProfile(profile, true));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/job-profiles/:jobProfileId', async (request, response, next) => {
  try {
    const profile = await requireJobProfile(request, request.params.jobProfileId);
    const published = await prisma.jobDescriptionVersion.count({
      where: { jobProfileId: profile.id, status: JobDescriptionStatus.PUBLISHED }
    });
    // publikovany popis prace je zaznam, na ktory sa ludia mohli odvolavat
    if (published > 0) throw new HttpError(409, 'Profil ma publikovany popis prace — nemozno ho zmazat.');
    await prisma.jobProfile.delete({ where: { id: profile.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Novy navrh popisu. Naraz moze byt len jeden navrh; obsah sa da predvyplnit. */
app.post('/api/job-profiles/:jobProfileId/versions', async (request, response, next) => {
  try {
    const profile = await requireJobProfile(request, request.params.jobProfileId);
    const draft = await prisma.jobDescriptionVersion.findFirst({
      where: { jobProfileId: profile.id, status: JobDescriptionStatus.DRAFT }
    });
    if (draft) throw new HttpError(409, 'Profil uz ma rozpracovany navrh — upravte ho.');
    const last = await prisma.jobDescriptionVersion.aggregate({ where: { jobProfileId: profile.id }, _max: { version: true } });
    const version = await prisma.jobDescriptionVersion.create({
      data: {
        organizationId: profile.organizationId,
        jobProfileId: profile.id,
        version: (last._max.version ?? 0) + 1,
        content: typeof request.body?.content === 'string' ? request.body.content : '',
        authorId: auth(request).userId
      }
    });
    response.status(201).json({ id: version.id, version: version.version });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/job-description-versions/:versionId', async (request, response, next) => {
  try {
    const version = await requireJobVersion(request, request.params.versionId);
    if (version.status !== JobDescriptionStatus.DRAFT) {
      throw new HttpError(409, 'Publikovanu verziu nemozno menit — vytvorte novu verziu.');
    }
    if (typeof request.body?.content !== 'string') throw new HttpError(400, 'content je povinny');
    await prisma.jobDescriptionVersion.update({
      where: { id: version.id },
      // kto navrh naposledy upravil, je jeho autor
      data: { content: request.body.content, authorId: auth(request).userId }
    });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/job-description-versions/:versionId/publish', async (request, response, next) => {
  try {
    const version = await requireJobVersion(request, request.params.versionId);
    if (version.status !== JobDescriptionStatus.DRAFT) throw new HttpError(409, 'Verzia uz je publikovana.');
    if (!version.content.trim()) throw new HttpError(400, 'Prazdny popis prace nemozno publikovat.');
    const effectiveFrom = parseDay(request.body?.effectiveFrom, today(), 'effectiveFrom')!;
    await prisma.jobDescriptionVersion.update({
      where: { id: version.id },
      data: { status: JobDescriptionStatus.PUBLISHED, publishedAt: new Date(), effectiveFrom, authorId: auth(request).userId }
    });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/job-description-versions/:versionId', async (request, response, next) => {
  try {
    const version = await requireJobVersion(request, request.params.versionId);
    if (version.status !== JobDescriptionStatus.DRAFT) throw new HttpError(409, 'Publikovanu verziu nemozno zmazat.');
    await prisma.jobDescriptionVersion.delete({ where: { id: version.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- R8: nastavenia automatickeho prekladu (sifrovany API kluc) ---

// #19 — kluc z prostredia alebo vygenerovany pri prvom starte (server/secrets.ts)
const encryptionKey = scryptSync(secret('SETTINGS_ENCRYPTION_KEY'), 'processbase-settings', 32);

/**
 * Kluc, ktorym sa sifrovalo pred #19 — jeho hodnota je verejna v historii gitu.
 * Pouziva sa LEN na jednorazove presifrovanie starych hodnot pri starte.
 */
const LEGACY_ENCRYPTION_KEY = scryptSync('dev-settings-encryption-key', 'processbase-settings', 32);

function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
}

function decryptWith(key: Buffer, stored: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = stored.split('.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function decryptSecret(stored: string): string | null {
  return decryptWith(encryptionKey, stored);
}

/**
 * Presifruje API kluce zasifrovane starym verejnym klucom na novy (#19).
 * Po prebehnuti uz v databaze nic zasifrovane verejnym klucom nezostane.
 */
async function reencryptLegacySecrets(): Promise<void> {
  const organizations = await prisma.organization.findMany({
    where: { translationApiKeyEnc: { not: null } },
    select: { id: true, translationApiKeyEnc: true }
  });
  let migrated = 0;
  let unreadable = 0;
  for (const organization of organizations) {
    const stored = organization.translationApiKeyEnc!;
    if (decryptWith(encryptionKey, stored) !== null) continue;
    const plain = decryptWith(LEGACY_ENCRYPTION_KEY, stored);
    if (plain === null) {
      unreadable++;
      continue;
    }
    await prisma.organization.update({ where: { id: organization.id }, data: { translationApiKeyEnc: encryptSecret(plain) } });
    migrated++;
  }
  if (migrated || unreadable) {
    console.warn(`[secrets] presifrovane API kluce: ${migrated}, nedesifrovatelne (treba zadat znova): ${unreadable}`);
  }
}

app.get('/api/organizations/:organizationId/settings/translation', async (request, response, next) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: orgScope(request) } });
    if (!organization) throw new HttpError(404, 'Organizacia neexistuje');
    response.json({
      autoTranslate: organization.autoTranslate,
      provider: organization.translationProvider ?? 'deepl',
      targetLocale: organization.translationTargetLocale ?? 'en',
      hasApiKey: Boolean(organization.translationApiKeyEnc)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/settings/translation', async (request, response, next) => {
  try {
    const { autoTranslate, provider, targetLocale, apiKey } = request.body ?? {};
    const organization = await prisma.organization.update({
      where: { id: orgScope(request) },
      data: {
        autoTranslate: Boolean(autoTranslate),
        translationProvider: provider || null,
        translationTargetLocale: targetLocale || null,
        translationApiKeyEnc: apiKey ? encryptSecret(String(apiKey)) : undefined
      }
    });
    response.json({
      autoTranslate: organization.autoTranslate,
      provider: organization.translationProvider ?? 'deepl',
      targetLocale: organization.translationTargetLocale ?? 'en',
      hasApiKey: Boolean(organization.translationApiKeyEnc)
    });
  } catch (error) {
    next(error);
  }
});

async function translateTexts(
  provider: string,
  apiKey: string,
  targetLocale: string,
  texts: string[]
): Promise<string[] | null> {
  try {
    if (provider === 'google') {
      const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: texts, target: targetLocale, format: 'text' })
      });
      if (!response.ok) return null;
      const body: any = await response.json();
      return (body?.data?.translations ?? []).map((item: any) => item.translatedText ?? '');
    }
    // DeepL (default) — free kluce konca na :fx a pouzivaju api-free subdomain
    const host = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const response = await fetch(`https://${host}/v2/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `DeepL-Auth-Key ${apiKey}`
      },
      body: JSON.stringify({ text: texts, target_lang: targetLocale.toUpperCase() })
    });
    if (!response.ok) return null;
    const body: any = await response.json();
    return (body?.translations ?? []).map((item: any) => item.text ?? '');
  } catch {
    return null;
  }
}

async function autoTranslateProcess(organizationId: string, processId: string): Promise<void> {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization?.autoTranslate || !organization.translationApiKeyEnc || !organization.translationTargetLocale) return;
    const apiKey = decryptSecret(organization.translationApiKeyEnc);
    if (!apiKey) return;
    const node = await prisma.processNode.findUnique({ where: { id: processId } });
    if (!node) return;
    const texts = [node.name, node.descriptionText ?? ''];
    const translated = await translateTexts(organization.translationProvider ?? 'deepl', apiKey, organization.translationTargetLocale, texts);
    if (!translated) return;
    const existing = (node.translations as Record<string, any> | null) ?? {};
    await prisma.processNode.update({
      where: { id: processId },
      data: {
        translations: {
          ...existing,
          [organization.translationTargetLocale]: {
            name: translated[0] ?? node.name,
            descriptionText: translated[1] ?? ''
          }
        }
      }
    });
  } catch (error) {
    logError('preklad', error);
  }
}

// --- R4/R5/R6: ISO normy a detekcia ---

type IsoClause = { clause: string; title: string; children?: IsoClause[] };

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(/\s+/).filter((token) => token.length > 2);
}

function flattenClauses(structure: unknown, normId: string, normName: string): Array<{ isoTemplateId: string; normName: string; clause: string; title: string }> {
  const result: Array<{ isoTemplateId: string; normName: string; clause: string; title: string }> = [];
  const walk = (items: IsoClause[] | undefined) => {
    for (const item of items ?? []) {
      result.push({ isoTemplateId: normId, normName, clause: item.clause, title: item.title });
      walk(item.children);
    }
  };
  walk(structure as IsoClause[] | undefined);
  return result;
}

async function computeIsoSuggestions(processId: string) {
  const node = await prisma.processNode.findUnique({ where: { id: processId } });
  if (!node) return [];
  const norms = await prisma.isoTemplate.findMany({ where: { structure: { not: undefined } } });
  const processTokens = new Set(tokenize(`${node.name} ${node.description ?? ''} ${node.descriptionText ?? ''}`));
  if (processTokens.size === 0) return [];

  const suggestions: Array<{ isoTemplateId: string; normName: string; clause: string; title: string; confidence: number }> = [];
  for (const norm of norms) {
    if (!norm.structure) continue;
    for (const clause of flattenClauses(norm.structure, norm.id, norm.name ?? norm.standard)) {
      const clauseTokens = tokenize(clause.title);
      if (clauseTokens.length === 0) continue;
      const matched = clauseTokens.filter((token) => processTokens.has(token)).length;
      if (matched === 0) continue;
      suggestions.push({ ...clause, confidence: Math.round((matched / clauseTokens.length) * 100) / 100 });
    }
  }
  suggestions.sort((a, b) => b.confidence - a.confidence);
  const top = suggestions.slice(0, 5);
  await prisma.processNode.update({ where: { id: processId }, data: { isoSuggestions: top } });
  return top;
}

app.post('/api/processes/:processId/iso-detect', async (request, response, next) => {
  try {
    await requireProcess(request, request.params.processId);
    response.json(await computeIsoSuggestions(request.params.processId));
  } catch (error) {
    next(error);
  }
});

// R6: verejny zoznam ISO noriem pre platformu
app.get('/api/iso-norms', async (_request, response, next) => {
  try {
    const norms = await prisma.isoTemplate.findMany({
      where: { name: { not: null } },
      orderBy: { createdAt: 'desc' }
    });
    response.json(norms.map((norm) => ({
      id: norm.id,
      name: norm.name ?? norm.standard,
      version: norm.version ?? '',
      language: norm.language ?? 'sk',
      structure: norm.structure ?? []
    })));
  } catch (error) {
    next(error);
  }
});

// Verejne preklady pre platformu — globalny slovnik { sk: {...}, en: {...} }
app.get('/api/translations', async (_request, response, next) => {
  try {
    const translations = await prisma.translation.findMany({ where: { organizationId: null } });
    const dictionary: Record<string, Record<string, string>> = {};
    for (const translation of translations) {
      dictionary[translation.locale] = dictionary[translation.locale] ?? {};
      dictionary[translation.locale][translation.key] = translation.value;
    }
    response.json(dictionary);
  } catch (error) {
    next(error);
  }
});

// --- R9: Backoffice autentifikacia (HMAC token) ---

// #19 — bez zaloznej hodnoty v kode: verejnou hodnotou by sa dal podpisat platny token
const BACKOFFICE_SECRET = secret('BACKOFFICE_JWT_SECRET');
const BACKOFFICE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function signBackofficeToken(adminId: string, username: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: adminId,
    username,
    exp: Date.now() + BACKOFFICE_TOKEN_TTL_MS
  })).toString('base64url');
  const signature = createHmac('sha256', BACKOFFICE_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyBackofficeToken(token: string): { sub: string; username: string } | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', BACKOFFICE_SECRET).update(payload).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { sub: data.sub, username: data.username };
  } catch {
    return null;
  }
}

app.post('/api/backoffice/auth/login', rateLimitLogin, async (request, response, next) => {
  try {
    const { username, password } = request.body ?? {};
    if (!username || !password) throw new HttpError(400, 'username a password su povinne');
    const admin = await prisma.backofficeAdmin.findUnique({ where: { username: String(username) } });
    if (!admin || !verifyPassword(String(password), admin.passwordHash)) {
      // #18 — neuspesne pokusy su signal utoku; heslo sa samozrejme nezapisuje
      await writeBackofficeAudit({ adminUsername: String(username).slice(0, 80), action: 'prihlasenie.neuspesne' });
      throw new HttpError(401, 'Nespravne prihlasovacie udaje.');
    }
    await writeBackofficeAudit({ adminId: admin.id, adminUsername: admin.username, action: 'prihlasenie' });
    response.json({ token: signBackofficeToken(admin.id, admin.username), username: admin.username });
  } catch (error) {
    next(error);
  }
});

app.post('/api/backoffice/auth/logout', (_request, response) => {
  // Token je stateless — logout je zahodenie tokenu na klientovi.
  response.json({ ok: true });
});

// Guard pre vsetky dalsie /api/backoffice/* routy (login/logout su registrovane vyssie)
app.use('/api/backoffice', (request, response, next) => {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = verifyBackofficeToken(token);
  if (!session) {
    response.status(401).json({ message: 'Neautorizovany pristup do backoffice.' });
    return;
  }
  (request as any).backofficeAdmin = session;
  next();
});

// --- #18 audit zasahov operatora ---

/** Citatelny nazov zasahu podla metody a routy; neznamy zasah sa zapise ako "METODA /cesta". */
const BACKOFFICE_ACTIONS: Record<string, string> = {
  'POST /api/backoffice/admins': 'admin.vytvorenie',
  'DELETE /api/backoffice/admins/:adminId': 'admin.zmazanie',
  'POST /api/backoffice/admins/me/password': 'admin.zmena-hesla',
  'PATCH /api/backoffice/organizations/:organizationId': 'firma.zmena-planu',
  'POST /api/backoffice/iso': 'iso.vytvorenie',
  'PATCH /api/backoffice/iso/:normId': 'iso.uprava',
  'DELETE /api/backoffice/iso/:normId': 'iso.zmazanie',
  'PUT /api/backoffice/translations': 'preklad.uprava',
  'POST /api/backoffice/translations/import': 'preklad.import',
  'DELETE /api/backoffice/translations/:translationId': 'preklad.zmazanie'
};

async function writeBackofficeAudit(entry: {
  adminId?: string | null;
  adminUsername: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  await prisma.backofficeAuditLog.create({
    data: {
      adminId: entry.adminId ?? null,
      adminUsername: entry.adminUsername,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      detail: (entry.detail ?? undefined) as any
    }
  }).catch((error) => logError('audit', error));
}

/**
 * Kazdy uspesny zapisujuci zasah operatora sa zapise do auditu. Telo poziadavky
 * sa NEUKLADA (moze obsahovat hesla) — len to, co handler vlozi do
 * response.locals.auditDetail (napr. stara a nova kvota).
 */
app.use('/api/backoffice', (request, response, next) => {
  if (request.method === 'GET') {
    next();
    return;
  }
  response.on('finish', () => {
    if (response.statusCode >= 400) return;
    const admin = (request as any).backofficeAdmin as { sub: string; username: string } | undefined;
    const route = request.route?.path ? `${request.method} ${request.route.path}` : `${request.method} ${request.originalUrl}`;
    const params = (request.params ?? {}) as Record<string, string>;
    const [targetType, targetId] = Object.entries(params)[0] ?? [null, null];
    void writeBackofficeAudit({
      adminId: admin?.sub,
      adminUsername: admin?.username ?? 'neznamy',
      action: BACKOFFICE_ACTIONS[route] ?? route,
      targetType: targetType ? targetType.replace(/Id$/, '') : null,
      targetId,
      detail: response.locals['auditDetail'] ?? null
    });
  });
  next();
});

app.get('/api/backoffice/audit', async (request, response, next) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(request.query['limit'] ?? 100) || 100));
    const entries = await prisma.backofficeAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    response.json(entries.map((entry) => ({
      id: entry.id,
      at: entry.createdAt.toISOString(),
      admin: entry.adminUsername,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      detail: entry.detail
    })));
  } catch (error) {
    next(error);
  }
});

// Sprava backoffice adminov
app.get('/api/backoffice/admins', async (_request, response, next) => {
  try {
    const admins = await prisma.backofficeAdmin.findMany({ orderBy: { createdAt: 'asc' } });
    response.json(admins.map((admin) => ({
      id: admin.id,
      username: admin.username,
      createdAt: admin.createdAt.toISOString().slice(0, 10)
    })));
  } catch (error) {
    next(error);
  }
});

const MIN_ADMIN_PASSWORD = 12;

/** Zmena vlastneho hesla (#19) — napr. docasneho hesla z prveho spustenia. */
app.post('/api/backoffice/admins/me/password', async (request, response, next) => {
  try {
    const session = (request as any).backofficeAdmin as { sub: string };
    const { currentPassword, newPassword } = request.body ?? {};
    if (typeof newPassword !== 'string' || newPassword.length < MIN_ADMIN_PASSWORD) {
      throw new HttpError(400, `Nove heslo musi mat aspon ${MIN_ADMIN_PASSWORD} znakov.`);
    }
    const admin = await prisma.backofficeAdmin.findUnique({ where: { id: session.sub } });
    if (!admin || !verifyPassword(String(currentPassword ?? ''), admin.passwordHash)) {
      throw new HttpError(401, 'Sucasne heslo nie je spravne.');
    }
    await prisma.backofficeAdmin.update({ where: { id: admin.id }, data: { passwordHash: hashPassword(newPassword) } });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/backoffice/admins', async (request, response, next) => {
  try {
    const { username, password } = request.body ?? {};
    if (!username || !password) throw new HttpError(400, 'username a password su povinne');
    if (String(password).length < MIN_ADMIN_PASSWORD) {
      throw new HttpError(400, `Heslo admina musi mat aspon ${MIN_ADMIN_PASSWORD} znakov.`);
    }
    const existing = await prisma.backofficeAdmin.findUnique({ where: { username: String(username) } });
    if (existing) throw new HttpError(409, 'Admin s tymto menom uz existuje.');
    const admin = await prisma.backofficeAdmin.create({
      data: { username: String(username), passwordHash: hashPassword(String(password)) }
    });
    response.status(201).json({ id: admin.id, username: admin.username, createdAt: admin.createdAt.toISOString().slice(0, 10) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/backoffice/admins/:adminId', async (request, response, next) => {
  try {
    const count = await prisma.backofficeAdmin.count();
    if (count <= 1) throw new HttpError(400, 'Nemozno vymazat posledneho admina.');
    await prisma.backofficeAdmin.delete({ where: { id: request.params.adminId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- R4: ISO normy — upload PDF a generovanie struktury ---

async function extractIsoStructureFromPdf(pdfBase64: string): Promise<IsoClause[]> {
  const { PDFParse } = await import('pdf-parse');
  const buffer = Buffer.from(pdfBase64, 'base64');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const parsed = await parser.getText();
  await parser.destroy();
  const lines: string[] = String(parsed.text ?? '').split(/\r?\n/);

  const clausePattern = /^(\d{1,2}(?:\.\d{1,2}){0,2})[\s.):–—-]+(\S.{2,90})$/;
  const seen = new Set<string>();
  const flat: Array<{ clause: string; title: string; level: number }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(clausePattern);
    if (!match) continue;
    const clause = match[1];
    const title = match[2].replace(/[.…]{2,}\s*\d*$/, '').trim(); // odstran bodkovane vyplne z obsahu
    const level = clause.split('.').length;
    if (level > 3) continue;
    const top = Number(clause.split('.')[0]);
    if (!Number.isFinite(top) || top < 1 || top > 30) continue;
    if (title.length < 3 || /^\d+$/.test(title)) continue;
    if (seen.has(clause)) continue;
    seen.add(clause);
    flat.push({ clause, title, level });
  }

  // zostav hierarchiu z plocheho zoznamu
  const roots: IsoClause[] = [];
  const byClause = new Map<string, IsoClause>();
  for (const item of flat.sort((a, b) => a.clause.localeCompare(b.clause, undefined, { numeric: true }))) {
    const node: IsoClause = { clause: item.clause, title: item.title, children: [] };
    byClause.set(item.clause, node);
    const parentClause = item.clause.split('.').slice(0, -1).join('.');
    const parent = byClause.get(parentClause);
    if (parent) {
      parent.children = parent.children ?? [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function mapIsoNorm(norm: any) {
  return {
    id: norm.id,
    name: norm.name ?? norm.standard,
    version: norm.version ?? '',
    language: norm.language ?? 'sk',
    structure: norm.structure ?? [],
    createdAt: norm.createdAt?.toISOString().slice(0, 10) ?? ''
  };
}

app.post('/api/backoffice/iso', async (request, response, next) => {
  try {
    const { name, version, language, pdfBase64, structure } = request.body ?? {};
    if (!name) throw new HttpError(400, 'name je povinny');
    let resolvedStructure: IsoClause[] = Array.isArray(structure) ? structure : [];
    if (pdfBase64) {
      resolvedStructure = await extractIsoStructureFromPdf(String(pdfBase64));
      if (resolvedStructure.length === 0) {
        throw new HttpError(422, 'Z PDF sa nepodarilo extrahovat strukturu kapitol. Skus manualny vstup.');
      }
    }
    const norm = await prisma.isoTemplate.create({
      data: {
        standard: String(name),
        name: String(name),
        version: version ? String(version) : null,
        language: language ? String(language) : 'sk',
        structure: resolvedStructure as any
      }
    });
    response.status(201).json(mapIsoNorm(norm));
  } catch (error) {
    next(error);
  }
});

app.get('/api/backoffice/iso', async (_request, response, next) => {
  try {
    const norms = await prisma.isoTemplate.findMany({
      where: { name: { not: null } },
      orderBy: { createdAt: 'desc' }
    });
    response.json(norms.map(mapIsoNorm));
  } catch (error) {
    next(error);
  }
});

app.get('/api/backoffice/iso/:normId', async (request, response, next) => {
  try {
    const norm = await prisma.isoTemplate.findUnique({ where: { id: request.params.normId } });
    if (!norm) throw new HttpError(404, 'Norma neexistuje');
    response.json(mapIsoNorm(norm));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/backoffice/iso/:normId', async (request, response, next) => {
  try {
    const norm = await prisma.isoTemplate.update({
      where: { id: request.params.normId },
      data: {
        name: request.body.name ?? undefined,
        standard: request.body.name ?? undefined,
        version: request.body.version === undefined ? undefined : (request.body.version || null),
        language: request.body.language ?? undefined,
        structure: request.body.structure === undefined ? undefined : request.body.structure
      }
    });
    response.json(mapIsoNorm(norm));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/backoffice/iso/:normId', async (request, response, next) => {
  try {
    await prisma.isoTemplate.delete({ where: { id: request.params.normId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- Backoffice API (samostatna admin aplikacia process-platform-backoffice) ---

// --- #17 spotreba planu a stav uctov — len agregaty, ziadny obsah zakaznika ---

/**
 * Pouzivatelia = clenovia firmy s prihlasenim (plateni). Osoby len v adresari
 * (bez uctu) sa pocitaju zvlast a do planu nevstupuju (#13).
 */
app.get('/api/backoffice/stats', async (_request, response, next) => {
  try {
    const [organizations, users, directoryOnly, processes, storage, quota, activeSessions, translations] = await Promise.all([
      prisma.organization.count(),
      prisma.organizationUser.count(),
      prisma.person.count({ where: { userId: null } }),
      prisma.processNode.count({ where: { type: ProcessNodeType.PROCESS } }),
      prisma.attachment.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      prisma.organization.aggregate({ _sum: { storageQuotaMb: true } }),
      prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
      prisma.translation.count({ where: { organizationId: null } })
    ]);
    response.json({
      organizations,
      users,
      directoryOnly,
      processes,
      documents: storage._count,
      storageUsedBytes: storage._sum.sizeBytes ?? 0,
      storageQuotaBytes: (quota._sum.storageQuotaMb ?? 0) * 1024 * 1024,
      activeSessions,
      translations
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/backoffice/organizations', async (_request, response, next) => {
  try {
    const [organizations, storage, directoryOnly, processes, lastSeen] = await Promise.all([
      prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { users: true } } }
      }),
      prisma.attachment.groupBy({ by: ['organizationId'], _sum: { sizeBytes: true }, _count: true }),
      prisma.person.groupBy({ by: ['organizationId'], where: { userId: null }, _count: true }),
      prisma.processNode.groupBy({ by: ['organizationId'], where: { type: ProcessNodeType.PROCESS }, _count: true }),
      prisma.session.groupBy({ by: ['organizationId'], _max: { lastSeenAt: true } })
    ]);
    const byOrg = <T extends { organizationId: string }>(rows: T[]) => new Map(rows.map((row) => [row.organizationId, row]));
    const storageBy = byOrg(storage);
    const directoryBy = byOrg(directoryOnly);
    const processBy = byOrg(processes);
    const seenBy = byOrg(lastSeen);

    response.json(organizations.map((organization) => {
      const usedBytes = storageBy.get(organization.id)?._sum.sizeBytes ?? 0;
      const quotaBytes = organization.storageQuotaMb * 1024 * 1024;
      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        defaultLocale: organization.defaultLocale,
        camundaBaseUrl: organization.camundaBaseUrl,
        createdAt: organization.createdAt.toISOString().slice(0, 10),
        userCount: organization._count.users,
        directoryOnlyCount: directoryBy.get(organization.id)?._count ?? 0,
        processCount: processBy.get(organization.id)?._count ?? 0,
        documentCount: storageBy.get(organization.id)?._count ?? 0,
        storageUsedBytes: usedBytes,
        storageQuotaMb: organization.storageQuotaMb,
        storagePercent: quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 1000) / 10 : 0,
        lastActivityAt: seenBy.get(organization.id)?._max.lastSeenAt?.toISOString() ?? null
      };
    }));
  } catch (error) {
    next(error);
  }
});

/** Zmena planu firmy (#17) — zatial kapacita uloziska. Zasah ide do auditu (#18). */
app.patch('/api/backoffice/organizations/:organizationId', async (request, response, next) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: request.params.organizationId } });
    if (!organization) throw new HttpError(404, 'Firma sa nenasla.');
    const quota = Number(request.body?.storageQuotaMb);
    if (!Number.isInteger(quota) || quota < 1 || quota > 1_000_000) {
      throw new HttpError(400, 'storageQuotaMb musi byt cele cislo 1 – 1 000 000 (MB).');
    }
    await prisma.organization.update({ where: { id: organization.id }, data: { storageQuotaMb: quota } });
    response.locals['auditDetail'] = { storageQuotaMb: { from: organization.storageQuotaMb, to: quota } };
    response.json({ id: organization.id, storageQuotaMb: quota });
  } catch (error) {
    next(error);
  }
});

// --- #18 stav sluzby: technicke metriky bez pristupu k obsahu zakaznika ---

app.get('/api/backoffice/health', async (_request, response, next) => {
  try {
    const started = Date.now();
    let database: { ok: boolean; latencyMs: number | null; sizeBytes: number | null } = { ok: false, latencyMs: null, sizeBytes: null };
    try {
      const rows = await prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`;
      database = { ok: true, latencyMs: Date.now() - started, sizeBytes: Number(rows[0]?.size ?? 0) };
    } catch {
      database = { ok: false, latencyMs: null, sizeBytes: null };
    }

    const [onDisk, inDatabase, activeSessions] = await Promise.all([
      prisma.attachment.aggregate({ where: { NOT: { storagePath: { startsWith: 'data:' } } }, _sum: { sizeBytes: true }, _count: true }),
      prisma.attachment.aggregate({ where: { storagePath: { startsWith: 'data:' } }, _sum: { sizeBytes: true }, _count: true }),
      prisma.session.count({ where: { expiresAt: { gt: new Date() } } })
    ]);

    const memory = process.memoryUsage();
    const recentServerErrors = incidents.filter((incident) => Date.now() - Date.parse(incident.at) < 60 * 60 * 1000).length;
    response.json({
      status: !database.ok ? 'down' : recentServerErrors > 0 ? 'degraded' : 'ok',
      checkedAt: new Date().toISOString(),
      startedAt: serviceMetrics.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      memoryRssMb: Math.round(memory.rss / 1024 / 1024),
      database,
      storage: {
        filesOnDisk: { count: onDisk._count, bytes: onDisk._sum.sizeBytes ?? 0 },
        // #10 — stare prilohy este v DB; po migracii ma byt 0
        legacyInDatabase: { count: inDatabase._count, bytes: inDatabase._sum.sizeBytes ?? 0 }
      },
      activeSessions,
      requests: {
        total: serviceMetrics.requests,
        clientErrors: serviceMetrics.clientErrors,
        serverErrors: serviceMetrics.serverErrors,
        serverErrorsLastHour: recentServerErrors
      },
      incidents: incidents.slice(0, 20),
      // #20 — doručovanie emailov zatial neexistuje (chyba SMTP poskytovatel)
      email: await emailDeliveryStats()
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/backoffice/translations', async (request, response, next) => {
  try {
    const locale = typeof request.query['locale'] === 'string' ? request.query['locale'] : undefined;
    const translations = await prisma.translation.findMany({
      where: { organizationId: null, ...(locale ? { locale } : {}) },
      orderBy: [{ locale: 'asc' }, { key: 'asc' }]
    });
    response.json(translations.map((translation) => ({
      id: translation.id,
      locale: translation.locale,
      key: translation.key,
      value: translation.value
    })));
  } catch (error) {
    next(error);
  }
});

// Postgres berie NULL != NULL, takze compound unique upsert s organizationId null
// nefunguje cez prisma.upsert — preto findFirst + update/create.
async function upsertGlobalTranslation(locale: string, key: string, value: string) {
  const existing = await prisma.translation.findFirst({
    where: { organizationId: null, locale, key }
  });
  if (existing) {
    return prisma.translation.update({ where: { id: existing.id }, data: { value } });
  }
  return prisma.translation.create({ data: { organizationId: null, locale, key, value } });
}

app.put('/api/backoffice/translations', async (request, response, next) => {
  try {
    const { locale, key, value } = request.body ?? {};
    if (!locale || !key || typeof value !== 'string') {
      throw new HttpError(400, 'locale, key a value su povinne');
    }
    const translation = await upsertGlobalTranslation(locale, key, value);
    response.json({
      id: translation.id,
      locale: translation.locale,
      key: translation.key,
      value: translation.value
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/backoffice/translations/import', async (request, response, next) => {
  try {
    const items = Array.isArray(request.body?.items) ? request.body.items : [];
    let imported = 0;
    for (const item of items) {
      if (!item?.locale || !item?.key || typeof item?.value !== 'string') continue;
      await upsertGlobalTranslation(item.locale, item.key, item.value);
      imported += 1;
    }
    response.json({ imported });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/backoffice/translations/:translationId', async (request, response, next) => {
  try {
    await prisma.translation.delete({ where: { id: request.params.translationId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- produkcia: zostaveny frontend z toho isteho procesu (docs/DEPLOYMENT.md) ---

/**
 * STATIC_DIR = zostavena aplikacia (ng build). Vyvojovy server Angularu
 * (ng serve) nie je urceny na verejny internet — v produkcii servuje staticke
 * subory priamo API a pred nim je reverzna proxy s TLS.
 */
function serveSpa(target: express.Express, directory: string): void {
  const root = path.resolve(directory);
  // subory s hashom v nazve sa nemenia — mozu sa cachovat dlho; index.html nie
  target.use(express.static(root, {
    index: false,
    setHeaders: (response, filePath) => {
      // Angular pomenuva zostavene subory ako main-XH5NX6AK.js
      response.setHeader('Cache-Control', /-[A-Z0-9]{8,}\.(js|css|woff2?|png|jpe?g|svg)$/.test(path.basename(filePath))
        ? 'public, max-age=31536000, immutable'
        : 'no-cache');
    }
  }));
  // SPA: vsetky ostatne GET mimo /api vratia index.html (routing robi Angular)
  target.get(/^(?!\/api\/).*/, (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(path.join(root, 'index.html'));
  });
}

const STATIC_DIR = process.env['STATIC_DIR'];
if (STATIC_DIR) serveSpa(app, STATIC_DIR);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const requestId = response.locals['requestId'] as string | undefined;
  if (error instanceof HttpError) {
    // 4xx je odpoved pre pouzivatela (moze obsahovat nazvy z jeho firmy) — do logu nie
    if (error.status >= 500) {
      response.locals['errorName'] = `HttpError ${error.status}`;
      logError('api', error, requestId);
    }
    response.status(error.status).json(error.status >= 500 ? { message: error.message, requestId } : { message: error.message });
    return;
  }
  // chyby tela poziadavky z express.json (prilis velke, neplatny JSON) su 4xx
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    response.status(status).json({ message: status === 413 ? 'Poziadavka je prilis velka.' : 'Neplatna poziadavka.' });
    return;
  }
  // sprava chyby (napr. z Prismy) moze obsahovat strukturu databazy a casti
  // dotazu s datami — neide klientovi ani do logu (#32), len druh a ID poziadavky
  response.locals['errorName'] = error instanceof Error ? error.name : typeof error;
  logError('api', error, requestId);
  response.status(500).json({ message: 'Nastala chyba servera. Skuste to znova.', requestId });
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Prvy backoffice admin (#19) — LEN ak ziadny neexistuje. Heslo nie je v zdrojaku
 * (repozitar je verejny): berie sa z BACKOFFICE_ADMIN_PASSWORD, inak sa vygeneruje
 * do suboru citatelneho len vlastnikom — nie do logu, logy sa kopiruju dalej.
 */
async function ensureFirstBackofficeAdmin(): Promise<void> {
  if ((await prisma.backofficeAdmin.count()) > 0) return;
  const username = process.env['BACKOFFICE_ADMIN_USERNAME'] || 'admin';
  const fromEnv = process.env['BACKOFFICE_ADMIN_PASSWORD'];
  const password = fromEnv || randomBytes(12).toString('base64url');
  await prisma.backofficeAdmin.create({ data: { username, passwordHash: hashPassword(password) } });
  if (fromEnv) {
    console.log(`[backoffice] admin "${username}" vytvoreny s heslom z BACKOFFICE_ADMIN_PASSWORD.`);
    return;
  }
  const file = path.join(path.dirname(SECRETS_FILE), 'initial-backoffice-password.txt');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${username}\n${password}\n`, { mode: 0o600 });
  console.log(`[backoffice] admin "${username}" vytvoreny, docasne heslo je v ${file} — po prihlaseni ho zmente a subor zmazte.`);
}

// #32 — Node by pri neosetrenej chybe vypisal celu spravu (moze niest data z dotazu);
// zapiseme len druh a miesto a proces ukoncime ako predtym (Docker ho spusti znova)
process.on('uncaughtException', (error) => {
  logError('neosetrena', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError('neosetrena', reason);
  process.exit(1);
});

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
  // #38 — dispecer upozorneni (aj udalosti, ktore ostali po restarte) a terminy revizii
  dispatchEvents().catch((error) => logError('udalosti', error));
  scanReviewDue().catch((error) => logError('revizie', error));
  scanDocumentVersions().catch((error) => logError('dokumenty', error));
  setInterval(() => dispatchEvents().catch((error) => logError('udalosti', error)), 15_000).unref();
  setInterval(() => {
    scanReviewDue().catch((error) => logError('revizie', error));
    // naplanovane verzie dokumentov zacinaju platit o polnoci
    scanDocumentVersions().catch((error) => logError('dokumenty', error));
  }, 60 * 60 * 1000).unref();
  reencryptLegacySecrets().catch((error) => logError('secrets', error));
  ensureFirstBackofficeAdmin().catch((error) => logError('backoffice', error));
});

/**
 * Backoffice na samostatnom porte (produkcia). Port sa ma vystavit len do
 * internej siete alebo cez VPN — operator nema byt dostupny z internetu.
 * Na verejnom porte je potom /api/backoffice zablokovane (vid middleware hore).
 */
if (BACKOFFICE_PORT && process.env['BACKOFFICE_STATIC_DIR']) {
  const backoffice = express();
  backoffice.disable('x-powered-by');
  backoffice.use((request, response, next) => {
    if (request.path.startsWith('/api/backoffice')) {
      app(request, response);
      return;
    }
    next();
  });
  serveSpa(backoffice, process.env['BACKOFFICE_STATIC_DIR']);
  const backofficeHost = process.env['BACKOFFICE_HOST'] ?? '127.0.0.1';
  backoffice.listen(BACKOFFICE_PORT, backofficeHost, () => {
    console.log(`Backoffice listening on http://${backofficeHost}:${BACKOFFICE_PORT}`);
  });
}
