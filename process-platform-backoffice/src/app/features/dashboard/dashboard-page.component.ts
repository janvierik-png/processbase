import { Component, OnInit, computed, signal } from '@angular/core';
import { formatBytes, formatDateTime, formatDuration } from '../../core/format';
import { PlatformStats, ServiceHealth } from '../../core/models/backoffice.model';
import { BackofficeApiService } from '../../core/services/backoffice-api.service';

const STATUS_LABELS: Record<ServiceHealth['status'], string> = {
  ok: 'V poriadku',
  degraded: 'Chyby za poslednú hodinu',
  down: 'Databáza nedostupná'
};

/**
 * Prehľad platformy (#17) a stav služby (#18). Len agregáty a technické
 * údaje — obsah procesov ani osobné údaje zákazníkov sa sem nedostanú.
 */
@Component({
  selector: 'bo-dashboard-page',
  standalone: true,
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss'
})
export class DashboardPageComponent implements OnInit {
  readonly stats = signal<PlatformStats | null>(null);
  readonly health = signal<ServiceHealth | null>(null);
  readonly error = signal<string | null>(null);

  readonly storagePercent = computed(() => {
    const stats = this.stats();
    if (!stats || stats.storageQuotaBytes <= 0) return 0;
    return Math.min(100, Math.round((stats.storageUsedBytes / stats.storageQuotaBytes) * 1000) / 10);
  });

  readonly formatBytes = formatBytes;
  readonly formatDuration = formatDuration;
  readonly formatDateTime = formatDateTime;

  constructor(private readonly api: BackofficeApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.stats().subscribe({
      next: (stats) => this.stats.set(stats),
      error: () => this.error.set('Štatistiky sa nepodarilo načítať. Beží API platformy na porte 3000?')
    });
    this.api.health().subscribe({
      next: (health) => this.health.set(health),
      error: () => this.error.set('Stav služby sa nepodarilo načítať.')
    });
  }

  statusLabel(status: ServiceHealth['status']): string {
    return STATUS_LABELS[status];
  }
}
