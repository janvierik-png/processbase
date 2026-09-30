export interface Organization {
  id: string;
  name: string;
  companyId?: string;
  ownerUserId: string;
  createdAt: string;
  /** #37 — verzie procesov sa zverejňujú len schválením */
  requireApproval?: boolean;
  /** #40 — profil „Kvalita a audit“ (kontrolné otázky, pripravenosť evidencie) */
  qualityProfile?: boolean;
}

/** #45 — typ vlastného poľa procesu. */
export type ProcessFieldType = 'text' | 'longText' | 'number' | 'date' | 'select' | 'checkbox';

/** #45 — vlastné pole procesu, ktoré si firma definuje v nastaveniach. */
export interface ProcessFieldDefinition {
  id: string;
  label: string;
  type: ProcessFieldType;
  options: string[];
  /** povinné pole blokuje publikovanie (nie uloženie návrhu) */
  required: boolean;
  helpText: string;
  sortOrder: number;
  /** firma pole už nepoužíva; hodnoty v procesoch ostali */
  archived: boolean;
  /** v koľkých procesoch je vyplnené */
  usage: number;
}
