import { Component, OnInit, signal } from '@angular/core';
import { formatDateTime } from '../../core/format';
import { AuditEntry } from '../../core/models/backoffice.model';
import { BackofficeApiService } from '../../core/services/backoffice-api.service';

const ACTION_LABELS: Record<string, string> = {
  'prihlasenie': 'Prihlásenie',
  'prihlasenie.neuspesne': 'Neúspešné prihlásenie',
  'admin.vytvorenie': 'Nový admin',
  'admin.zmazanie': 'Zmazanie admina',
  'admin.zmena-hesla': 'Zmena vlastného hesla',
  'firma.zmena-planu': 'Zmena plánu firmy',
  'iso.vytvorenie': 'Nová ISO norma',
  'iso.uprava': 'Úprava ISO normy',
  'iso.zmazanie': 'Zmazanie ISO normy',
  'preklad.uprava': 'Úprava prekladu',
  'preklad.import': 'Import prekladov',
  'preklad.zmazanie': 'Zmazanie prekladu'
};

/** Audit zásahov operátora (#18) — kto, čo a kedy; bez obsahu zákazníkov. */
@Component({
  selector: 'bo-audit-page',
  standalone: true,
  templateUrl: './audit-page.component.html',
  styleUrl: './audit-page.component.scss'
})
export class AuditPageComponent implements OnInit {
  readonly entries = signal<AuditEntry[]>([]);
  readonly error = signal<string | null>(null);
  readonly formatDateTime = formatDateTime;

  constructor(private readonly api: BackofficeApiService) {}

  ngOnInit(): void {
    this.api.audit(200).subscribe({
      next: (entries) => this.entries.set(entries),
      error: () => this.error.set('Audit sa nepodarilo načítať.')
    });
  }

  actionLabel(action: string): string {
    return ACTION_LABELS[action] ?? action;
  }

  describe(entry: AuditEntry): string {
    const quota = (entry.detail as any)?.storageQuotaMb;
    if (quota) return `kapacita ${quota.from} MB → ${quota.to} MB`;
    return entry.detail ? JSON.stringify(entry.detail) : '';
  }
}
