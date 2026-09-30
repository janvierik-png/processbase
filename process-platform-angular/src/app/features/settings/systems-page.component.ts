import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ItSystem, OrgPosition, SystemImpact } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';
import { PositionService } from '../../core/services/position.service';
import { SystemService } from '../../core/services/system.service';

type SystemDraft = { name: string; code: string; vendor: string; url: string; description: string; ownerPositionId: string };

const emptyDraft = (): SystemDraft => ({ name: '', code: '', vendor: '', url: '', description: '', ownerPositionId: '' });

/**
 * #43 — IT systémy firmy: čo procesy a kroky používajú, kto za systém
 * zodpovedá (pracovné miesto) a čo zasiahne jeho vyradenie.
 */
@Component({
  selector: 'pp-systems-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './systems-page.component.html',
  styleUrl: './systems-page.component.scss'
})
export class SystemsPageComponent implements OnInit {
  readonly systems = signal<ItSystem[]>([]);
  readonly positions = signal<OrgPosition[]>([]);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly impact = signal<SystemImpact | null>(null);

  readonly activeSystems = computed(() => this.systems().filter((system) => !system.archived));
  readonly retiredSystems = computed(() => this.systems().filter((system) => system.archived));
  readonly selectablePositions = computed(() => this.positions().filter((position) => !position.archived));

  /** Zaradiť a upraviť smie aj editor procesov; vyradiť len správa firmy (server to kontroluje tiež). */
  readonly canEdit = this.auth.can('organization:write') || this.auth.can('process:write');
  readonly canRetire = this.auth.can('organization:write');

  model: SystemDraft = emptyDraft();
  editingId: string | null = null;
  filter = '';

  constructor(
    private readonly api: SystemService,
    private readonly positionsApi: PositionService,
    private readonly auth: AuthService
  ) {}

  ngOnInit(): void {
    this.load();
    this.positionsApi.list().subscribe({ next: (items) => this.positions.set(items), error: () => undefined });
  }

  filtered(list: ItSystem[]): ItSystem[] {
    const q = this.filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((system) => [system.name, system.code, system.vendor].some((value) => value.toLowerCase().includes(q)));
  }

  private load(): void {
    this.api.list().subscribe({
      next: (items) => this.systems.set(items),
      error: () => this.error.set('Systémy sa nepodarilo načítať.')
    });
  }

  private fail(fallback: string) {
    return (error: any) => this.error.set(error?.error?.message ?? fallback);
  }

  startEdit(system: ItSystem): void {
    this.editingId = system.id;
    this.model = {
      name: system.name,
      code: system.code,
      vendor: system.vendor,
      url: system.url,
      description: system.description,
      ownerPositionId: system.ownerPositionId ?? ''
    };
    this.impact.set(null);
  }

  cancelEdit(): void {
    this.editingId = null;
    this.model = emptyDraft();
  }

  save(): void {
    const payload = {
      name: this.model.name.trim(),
      code: this.model.code.trim(),
      vendor: this.model.vendor.trim(),
      url: this.model.url.trim(),
      description: this.model.description.trim(),
      ownerPositionId: this.model.ownerPositionId || null
    };
    if (!payload.name) {
      this.error.set('Zadajte názov systému.');
      return;
    }
    this.error.set(null);
    const request = this.editingId ? this.api.update(this.editingId, payload) : this.api.create(payload);
    request.subscribe({
      next: (system) => {
        this.notice.set(this.editingId ? `Systém „${system.name}“ je upravený.` : `Systém „${system.name}“ je v zozname.`);
        this.cancelEdit();
        this.load();
      },
      error: this.fail('Systém sa nepodarilo uložiť.')
    });
  }

  showImpact(system: ItSystem): void {
    this.error.set(null);
    this.api.impact(system.id).subscribe({ next: (impact) => this.impact.set(impact), error: this.fail('Dopad sa nepodarilo zistiť.') });
  }

  confirmRetire(): void {
    const impact = this.impact();
    if (!impact) return;
    this.api.archive(impact.system.id).subscribe({
      next: (result) => {
        this.impact.set(null);
        this.notice.set(result.processes.length > 0
          ? `Systém „${result.system.name}“ je vyradený. Procesy, ktoré ho používajú (${result.processes.length}), nájdete v Prehľade.`
          : `Systém „${result.system.name}“ je vyradený.`);
        this.load();
      },
      error: this.fail('Systém sa nepodarilo vyradiť.')
    });
  }

  restore(system: ItSystem): void {
    this.api.restore(system.id).subscribe({ next: () => this.load(), error: this.fail('Systém sa nepodarilo obnoviť.') });
  }

  remove(system: ItSystem): void {
    if (!window.confirm(`Odstrániť systém „${system.name}“ zo zoznamu?`)) return;
    this.api.remove(system.id).subscribe({ next: () => this.load(), error: this.fail('Systém sa nepodarilo odstrániť.') });
  }

  usage(system: ItSystem): string {
    if (system.processCount === 0) return 'nepoužíva ho žiadny proces';
    const steps = system.stepCount > 0 ? `, pri krokoch: ${system.stepCount}` : '';
    return `procesy: ${system.processCount}${steps}`;
  }
}
