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
  /** #40 — riadený proces: vstupy, výstupy, nadväzujúce procesy */
  inputs?: string[];
  outputs?: string[];
  upstreamProcessIds?: string[];
  downstreamProcessIds?: string[];
  /** #40 — profil Kvalita a audit */
  successMeasure?: string;
  resources?: string;
  opportunities?: string;
  evidenceRequirements?: string[];
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
  /** #43 — miesto bolo archivované; väzba ostala, treba určiť nové */
  archived?: boolean;
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
  documents?: Array<{ id: string; name: string; version?: number; newerVersion?: number | null }>;
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
    /** STEP = zodpovednosť len za krok (#29); bez miesta = priradené priamo mne */
    roles: Array<{ role: 'OWNER' | 'PERFORMER' | 'STEP'; positionId: string | null; positionName: string; step?: string; raci?: RaciCode }>;
  }>;
}

/** #29 CORE-03 — R vykonáva, A zodpovedá, C konzultuje, I je informovaný. */
export type RaciCode = 'R' | 'A' | 'C' | 'I';

export interface StepResponsibility {
  role: RaciCode;
  positionId: string | null;
  /** výnimka — priradené konkrétnej osobe, nie miestu */
  personId: string | null;
  name: string;
  /** kto miesto zastáva (dnes, alebo k dátumu zobrazenej verzie) */
  holders: string[];
  vacant: boolean;
  exception: boolean;
  personLeft: boolean;
}

/** #28 — krok procesu (lineárny zoznam). */
export interface ProcessActivity {
  id: string;
  title: string;
  description?: string;
  /** #29 — kto pri kroku vykonáva, zodpovedá, konzultuje, je informovaný */
  raci?: StepResponsibility[];
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
  /** #31 — verzia riadeného dokumentu */
  documentId?: string;
  version?: number;
  effectiveFrom?: string | null;
  changeNote?: string | null;
  versionCount?: number;
  nextVersion?: { id: string; version: number; effectiveFrom: string | null } | null;
  /** v publikovanej verzii procesu: platí už novšia verzia dokumentu */
  newerVersion?: number | null;
}

export interface ProcessRevision {
  id: string;
  name: string;
  date: string;
  bpmnXml: string;
  diagramSvg?: string;
  snapshot?: Partial<ProcessNode>;
}

/** #34 — prehľad firmy: každá karta je zoznam procesov s konkrétnym problémom. */
export type OverviewKey = 'review' | 'pendingApproval' | 'feedback' | 'staleDocuments' | 'ownerless' | 'vacant' | 'incomplete' | 'unpublished' | 'pendingChanges';

export interface OverviewItem {
  id: string;
  name: string;
  code: string;
  /** čo chýba alebo čo treba urobiť — nie skóre */
  detail: string;
  overdue?: boolean;
}

export interface Overview {
  at: string;
  processCount: number;
  categories: Array<{ key: OverviewKey; count: number; items: OverviewItem[] }>;
}

/** #36 — podnet k procesu: chyba alebo návrh zlepšenia. */
export interface ProcessFeedback {
  id: string;
  processId: string;
  processName?: string;
  kind: 'error' | 'improvement';
  text: string;
  status: 'open' | 'accepted' | 'rejected' | 'done';
  author: string | null;
  mine: boolean;
  createdAt: string;
  /** verzia, ktorú autor čítal */
  revision: number | null;
  stepTitle: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** #35 — výsledok globálneho vyhľadávania (len vlastná firma). */
export interface SearchMatch {
  kind: 'published' | 'draft' | 'archive';
  revision: number | null;
  state?: 'effective' | 'scheduled';
  snippet: { text: string; start: number; length: number };
}

export interface SearchResult {
  query: string;
  processes: Array<{ id: string; name: string; code: string; matches: SearchMatch[] }>;
  positions: Array<{ id: string; name: string }>;
  documents: Array<{ id: string; fileName: string; processId: string | null; processName: string | null }>;
}

/** #31 — riadený dokument so všetkými verziami. */
export interface DocumentVersions {
  id: string;
  title: string;
  status: 'active' | 'archived';
  ownerPosition: { id: string; name: string } | null;
  versions: Array<Attachment & { state: 'current' | 'scheduled' | 'superseded'; usedIn: Array<{ revision: number; processName: string }> }>;
}

/** #40 — pripravenosť evidencie: zoznam stavov, nikdy percento zhody. */
export type ReadinessState = 'done' | 'attention' | 'na' | 'unverified';

export interface ReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  detail: string;
  source: string;
  fix: 'publish' | 'relations' | 'steps' | 'control' | 'quality' | 'evidence';
  exception?: { id: string; reason: string; markedBy: string | null; approvedBy: string | null; pending: boolean };
}

export interface QualityReadiness {
  enabled: boolean;
  assessedAt?: string;
  note?: string;
  source?: string;
  items: ReadinessItem[];
}

export interface EvidenceRecord {
  id: string;
  requirement: string;
  performedOn: string;
  note: string | null;
  attachmentId?: string | null;
  createdBy: string | null;
  createdAt?: string;
}
