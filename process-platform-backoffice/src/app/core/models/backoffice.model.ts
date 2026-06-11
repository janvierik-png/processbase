export interface PlatformStats {
  organizations: number;
  users: number;
  processes: number;
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
  processCount: number;
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
