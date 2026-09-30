import { DraftStep, ProcessDraft } from '../../shared/process-draft/draft';

/** #42 — nastavenie AI asistenta firmy (kľúč sa nikdy nevracia). */
export interface AiSettings {
  enabled: boolean;
  hasOrgKey: boolean;
  platformKey: boolean;
  available: boolean;
  provider: string;
  model: string;
}

export interface AiStatus {
  available: boolean;
  enabled: boolean;
  provider: string;
  model: string;
}

export interface RoleMatch {
  role: string;
  positionId: string | null;
  positionName: string | null;
}

/** #42 — návrh procesu z textu (neuložený). */
export interface DraftResult {
  method: 'ai' | 'rules';
  draft: ProcessDraft;
  steps: DraftStep[];
  roleMatches: RoleMatch[];
}

export interface Citation {
  file: string;
  location: string;
  quote: string;
}

export interface ExistingRef {
  id: string;
  name: string;
}

export interface UnitCandidate {
  key: string;
  name: string;
  parentKey: string | null;
  source: Citation;
  existing: ExistingRef | null;
}

export interface PositionCandidate {
  key: string;
  name: string;
  unitKey: string | null;
  reportsToKey: string | null;
  holder: string | null;
  source: Citation;
  existing: ExistingRef | null;
}

export interface ProcessCandidate {
  key: string;
  draft: ProcessDraft;
  steps: DraftStep[];
  source: Citation;
  existing: ExistingRef | null;
  roleMatches: RoleMatch[];
}

/** #41 — rozbor jedného súboru. */
export interface AnalyzeResult {
  file: string;
  format: string;
  method: 'ai' | 'rules';
  units: UnitCandidate[];
  positions: PositionCandidate[];
  processes: ProcessCandidate[];
  warnings: string[];
}

export interface ApplyPayload {
  units?: Array<{ name: string; parentKey: string | null }>;
  positions?: Array<{ name: string; unitKey: string | null; reportsToKey: string | null; holder: string | null }>;
  processes?: Array<{ draft: ProcessDraft; ownerRole: string | null; source?: Citation | null }>;
  createPeople?: boolean;
  createMissingRoles?: boolean;
}

export interface ApplyResult {
  units: { created: number; merged: number };
  positions: { created: number; merged: number };
  people: number;
  processes: Array<{ id: string; name: string }>;
}
