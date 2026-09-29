export interface ProcessNode {
  id: string;
  name: string;
  /** #30 — kód procesu (napr. PR-07); prázdny, ak nie je zadaný */
  code?: string;
  type: 'folder' | 'process';
  parentId?: string | null;
  children?: ProcessNode[];
  owner?: string;
  status?: string;
  publication?: ProcessPublication;
  /** #28 — rýchly proces */
  trigger?: string;
  outcome?: string;
  activities?: ProcessActivity[];
  /** čo chýba na publikovanie; povinné blokujú, odporúčané len upozornia */
  readiness?: Array<{ key: string; label: string; ok: boolean; required: boolean }>;
  revision?: string;
  purpose?: string;
  risks?: string;
  descriptionText?: string;
  relatedProcessIds?: string[];
  positionIds?: string[];
  positions?: ProcessPositionRef[];
  /** #15 — miesto vlastnika procesu; owner je jeho dnesny drzitel */
  ownerPosition?: ProcessPositionRef | null;
  /** zodpovednosti, ktore dnes nikto nezastava */
  vacantResponsibilities?: ProcessPositionRef[];
  isoSuggestions?: IsoSuggestion[];
  translations?: Record<string, { name: string; descriptionText: string }> | null;
  bpmnXml?: string;
  diagramType?: 'NONE' | 'BPMN' | 'FLOWCHART';
  flowchartXml?: string;
  diagramSvg?: string;
  iso?: IsoLink[];
  history?: string[];
  approvals?: ApprovalStep[];
  attachments?: Attachment[];
  revisions?: ProcessRevision[];
}

export interface ProcessPositionRef {
  id: string;
  name: string;
  /** #15 — rola miesta v zodpovednosti za proces */
  role?: 'OWNER' | 'PERFORMER';
  /** kto miesto dnes zastava */
  holders?: string[];
  vacant?: boolean;
}

export interface ProcessDetail extends ProcessNode {
  parentName?: string | null;
  childProcesses?: Array<{ id: string; name: string }>;
  relatedProcesses?: Array<{ id: string; name: string }>;
  /** #27 — 'draft' = rozpracovaný návrh, 'version' = publikovaná verzia, 'approval' = návrh na schválenie; posledné dve len na čítanie */
  view?: 'draft' | 'version' | 'approval';
  /** #37 — pri view 'approval': žiadosť, ktorej zmrazený obsah sa zobrazuje */
  approvalRequest?: ApprovalRequestInfo;
  version?: ProcessVersionMeta;
  /** dokumenty v publikovanej verzii (stav pri publikovaní) */
  documents?: Array<{ id: string; name: string }>;
}

/** #33 — „Moja práca": procesy podľa miest, ktoré prihlásený zastáva. */
export interface MyWork {
  at: string;
  person: { id: string; name: string } | null;
  positions: Array<{ id: string; name: string; validFrom: string; validTo: string | null }>;
  processes: Array<{
    id: string;
    name: string;
    code?: string;
    effective: { revision: number; effectiveFrom: string; nextReviewAt: string | null } | null;
    /** termín revízie: po termíne / do 30 dní */
    review: 'overdue' | 'soon' | null;
    /** zdroj zodpovednosti — miesto a rola */
    roles: Array<{ role: 'OWNER' | 'PERFORMER'; positionId: string; positionName: string }>;
  }>;
}

/** #28 — krok procesu (lineárny zoznam). */
export interface ProcessActivity {
  id: string;
  title: string;
  description?: string;
}

/** #27 — stav publikovania procesu, počíta ho server z verzií. */
export interface ProcessPublication {
  effective: { revision: number; effectiveFrom: string } | null;
  scheduled: { revision: number; effectiveFrom: string } | null;
  latestRevision: number;
  /** návrh sa líši od poslednej publikovanej verzie */
  hasDraftChanges: boolean;
  /** #37 — žiadosť o schválenie, ktorá čaká na rozhodnutie */
  pendingApproval?: { id: string; requestedBy: string | null; requestedById: string | null; createdAt: string; effectiveFrom: string | null } | null;
}

/** #37 — žiadosť o schválenie verzie procesu. */
export interface ApprovalRequestInfo {
  id: string;
  processId: string;
  processName?: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  requestedBy: string | null;
  requestedById: string | null;
  createdAt: string;
  effectiveFrom: string | null;
  nextReviewAt: string | null;
  changeReason: string | null;
  decidedAt: string | null;
  /** kto rozhodol a aké miesto vtedy zastával */
  decision: { by: string | null; positions: string | null; comment: string | null } | null;
  versionId: string | null;
}

export interface ProcessVersionMeta {
  id: string;
  revision: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  nextReviewAt: string | null;
  changeReason: string | null;
  publishedAt: string;
  publishedBy: string | null;
  /** #37 — kto verziu schválil (pri priamom publikovaní null) */
  approvedBy?: string | null;
  approvedAt?: string | null;
  state: 'effective' | 'scheduled' | 'superseded';
}

export interface IsoSuggestion {
  isoTemplateId: string;
  normName: string;
  clause: string;
  title: string;
  confidence: number;
}

export interface ProcessChange {
  id: string;
  date: string;
  userName: string;
  changedFields: Record<string, { from: unknown; to: unknown }>;
  description?: string | null;
}

export interface IsoClause {
  clause: string;
  title: string;
  children?: IsoClause[];
}

export interface IsoNorm {
  id: string;
  name: string;
  version: string;
  language: string;
  structure: IsoClause[];
}

export interface IsoLink {
  standard: string;
  clause: string;
  evidence: string;
}

export interface ApprovalStep {
  userId: string;
  state: string;
  note: string;
  date: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  owner: string;
  size?: number;
  createdAt?: string;
  processId?: string;
  processName?: string;
  positionIds?: string[];
  positions?: ProcessPositionRef[];
}

export interface ProcessRevision {
  id: string;
  name: string;
  date: string;
  bpmnXml: string;
  diagramSvg?: string;
  snapshot?: Partial<ProcessNode>;
}
