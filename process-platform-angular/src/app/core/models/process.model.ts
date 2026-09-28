export interface ProcessNode {
  id: string;
  name: string;
  type: 'folder' | 'process';
  parentId?: string | null;
  children?: ProcessNode[];
  owner?: string;
  status?: string;
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
