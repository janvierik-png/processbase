export interface Organization {
  id: string;
  name: string;
  companyId?: string;
  ownerUserId: string;
  createdAt: string;
  /** #37 — verzie procesov sa zverejňujú len schválením */
  requireApproval?: boolean;
}
