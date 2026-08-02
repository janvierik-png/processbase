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
  name: string;
  description: string;
  sortOrder: number;
  positionCount: number;
}

export interface OrgPosition {
  id: string;
  organizationId: string;
  unitId: string | null;
  unitName: string | null;
  name: string;
  description: string;
  createdAt: string;
  assignedUsers: Array<{ id: string; name: string }>;
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
