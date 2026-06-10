export interface ProcessNode {
  id: string;
  name: string;
  type: 'folder' | 'process';
  children?: ProcessNode[];
  owner?: string;
  status?: string;
  revision?: string;
  purpose?: string;
  risks?: string;
  bpmnXml?: string;
  diagramSvg?: string;
  iso?: IsoLink[];
  history?: string[];
  approvals?: ApprovalStep[];
  attachments?: Attachment[];
  revisions?: ProcessRevision[];
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
  dataUrl?: string;
  processId?: string;
  processName?: string;
}

export interface ProcessRevision {
  id: string;
  name: string;
  date: string;
  bpmnXml: string;
  diagramSvg?: string;
  snapshot: Partial<ProcessNode>;
}
