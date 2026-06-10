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
