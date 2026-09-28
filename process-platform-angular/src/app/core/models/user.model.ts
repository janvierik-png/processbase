export type RoleId = 'owner' | 'admin' | 'quality' | 'approver' | 'iso';

export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  password?: string;
  roleId: RoleId;
  active: boolean;
  status: 'active' | 'pending' | 'disabled';
  positions?: Array<{ id: string; name: string }>;
}

export interface OrgUnit {
  id: string;
  organizationId: string;
  /** Nadradena zlozka (#12); null = korenova. */
  parentId: string | null;
  name: string;
  description: string;
  sortOrder: number;
  positionCount: number;
}

/** Kto miesto dnes zastava (#14). */
export interface PositionHolder {
  assignmentId: string;
  personId: string;
  name: string;
  validFrom: string;
  validTo: string | null;
}

export interface OrgPosition {
  id: string;
  organizationId: string;
  unitId: string | null;
  unitName: string | null;
  /** Nadriadene miesto (#12). */
  reportsToId: string | null;
  reportsToName: string | null;
  /** Profil prace, ktory miesto napla (#16). */
  jobProfileId: string | null;
  jobProfileName: string | null;
  name: string;
  description: string;
  createdAt: string;
  holders: PositionHolder[];
  /** Nikto miesto dnes nezastava. */
  vacant: boolean;
}

/** Obsadenie miesta osobou na obdobie (#14); validTo = null -> aktivne. */
export interface PersonAssignment {
  id: string;
  positionId: string;
  positionName: string;
  unitName: string | null;
  validFrom: string;
  validTo: string | null;
  /** Platne dnes. */
  current: boolean;
}

/** Osoba v pracovnom adresari (#13) — nemusi mat ucet. */
export interface Person {
  id: string;
  name: string;
  email: string;
  phone: string;
  note: string;
  /** false = osoba odisla z firmy */
  active: boolean;
  /** true = ma pouzivatelsky ucet a pocita sa ako pouzivatel */
  hasAccount: boolean;
  userId: string | null;
  assignments: PersonAssignment[];
}

export type JobVersionStatus = 'draft' | 'current' | 'planned' | 'superseded';

export interface JobDescriptionVersion {
  id: string;
  version: number;
  status: JobVersionStatus;
  content?: string;
  authorName: string | null;
  effectiveFrom: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

/** Profil prace (#16) — znovupouzitelny opis typu prace. */
export interface JobProfile {
  id: string;
  name: string;
  summary: string;
  positionCount: number;
  currentVersion: JobDescriptionVersion | null;
  draftVersion: JobDescriptionVersion | null;
  versions: JobDescriptionVersion[];
}

export interface TranslationSettings {
  autoTranslate: boolean;
  provider: string;
  targetLocale: string;
  hasApiKey: boolean;
}

export interface Role {
  id: RoleId;
  name: string;
  permissions: string[];
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  roleId: RoleId;
  invitedByUserId?: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  token: string;
  createdAt: string;
  expiresAt?: string;
}
