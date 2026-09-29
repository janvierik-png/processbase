/** #17 — agregaty platformy; ziadny obsah zakaznikov. */
export interface PlatformStats {
  organizations: number;
  /** clenovia firiem s prihlasenim (plateni) */
  users: number;
  /** osoby len v adresari — nepocitaju sa do planu */
  directoryOnly: number;
  processes: number;
  documents: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  activeSessions: number;
  translations: number;
}

export interface OrganizationOverview {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  camundaBaseUrl: string | null;
  createdAt: string;
  userCount: number;
  directoryOnlyCount: number;
  processCount: number;
  documentCount: number;
  storageUsedBytes: number;
  storageQuotaMb: number;
  storagePercent: number;
  lastActivityAt: string | null;
}

/** #18 — technicky stav sluzby. */
export interface ServiceHealth {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  startedAt: string;
  uptimeSeconds: number;
  node: string;
  memoryRssMb: number;
  database: { ok: boolean; latencyMs: number | null; sizeBytes: number | null };
  storage: {
    filesOnDisk: { count: number; bytes: number };
    legacyInDatabase: { count: number; bytes: number };
  };
  activeSessions: number;
  requests: { total: number; clientErrors: number; serverErrors: number; serverErrorsLastHour: number };
  incidents: Array<{ at: string; method: string; route: string; status: number; error: string | null; requestId?: string | null }>;
  email: { configured: boolean; transport?: string; queued?: number; sentLastDay?: number; failedLastDay?: number; note: string };
}

/** #18 — zasah operatora. */
export interface AuditEntry {
  id: string;
  at: string;
  admin: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
}

export interface TranslationEntry {
  id: string;
  locale: string;
  key: string;
  value: string;
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
  createdAt: string;
}

export interface BackofficeAdmin {
  id: string;
  username: string;
  createdAt: string;
}
