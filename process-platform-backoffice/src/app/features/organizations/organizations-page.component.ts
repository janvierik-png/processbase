import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatBytes, formatDateTime } from '../../core/format';
import { OrganizationOverview } from '../../core/models/backoffice.model';
import { BackofficeApiService } from '../../core/services/backoffice-api.service';

/**
 * Firmy a spotreba plánu (#17). Operátor vidí agregáty (počty, GB, posledná
 * aktivita), nie obsah procesov, dokumentov ani mená ľudí z adresára.
 */
@Component({
  selector: 'bo-organizations-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './organizations-page.component.html',
  styleUrl: './organizations-page.component.scss'
})
export class OrganizationsPageComponent implements OnInit {
  readonly organizations = signal<OrganizationOverview[]>([]);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly loading = signal(true);

  editingId: string | null = null;
  quotaDraft = 1024;

  readonly formatBytes = formatBytes;
  readonly formatDateTime = formatDateTime;

  constructor(private readonly api: BackofficeApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.organizations().subscribe({
      next: (organizations) => {
        this.organizations.set(organizations);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Firmy sa nepodarilo načítať.');
        this.loading.set(false);
      }
    });
  }

  startEdit(org: OrganizationOverview): void {
    this.editingId = org.id;
    this.quotaDraft = org.storageQuotaMb;
  }

  saveQuota(org: OrganizationOverview): void {
    const quota = Math.round(Number(this.quotaDraft));
    if (!window.confirm(`Zmeniť kapacitu úložiska firmy ${org.name} z ${org.storageQuotaMb} MB na ${quota} MB?\nZásah sa zapíše do auditu.`)) return;
    this.api.updateOrganizationQuota(org.id, quota).subscribe({
      next: () => {
        this.editingId = null;
        this.error.set(null);
        this.notice.set(`Kapacita firmy ${org.name} je ${quota} MB.`);
        this.load();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Kapacitu sa nepodarilo zmeniť.')
    });
  }

  usageClass(org: OrganizationOverview): string {
    if (org.storagePercent >= 100) return 'full';
    if (org.storagePercent >= 80) return 'warn';
    return '';
  }
}
