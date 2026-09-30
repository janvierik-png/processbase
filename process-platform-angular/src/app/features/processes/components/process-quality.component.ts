import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EvidenceRecord, ProcessDetail, ProcessNode, QualityReadiness, ReadinessItem, ReadinessState } from '../../../core/models/process.model';
import { ItSystem } from '../../../core/models/user.model';
import { AuthService } from '../../../core/services/auth.service';
import { ProcessStoreService } from '../../../core/services/process-store.service';

type Section = 'control' | 'quality' | null;

/**
 * Riadený proces a profil „Kvalita a audit“ (#40 QUAL-01).
 *
 * Riadenie procesu (vstupy, výstupy, nadväznosť) vidí každý. S profilom firmy
 * pribudne meradlo úspechu, riziká, čo sa uchováva ako záznam, záznamy
 * o vykonaní a pre správcu kvality pripravenosť evidencie — zoznam stavov,
 * nikdy percento ani tvrdenie o zhode s normou.
 */
@Component({
  selector: 'pp-process-quality',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './process-quality.component.html',
  styleUrl: './process-quality.component.scss'
})
export class ProcessQualityComponent implements OnChanges {
  @Input({ required: true }) process!: ProcessDetail;
  @Input() processes: ProcessNode[] = [];
  /** publikovaná verzia, posudzovaný návrh alebo bez práva upravovať */
  @Input() readOnly = true;
  @Input() qualityProfile = false;
  /** #43 — IT systémy firmy (aj vyradené — kvôli názvom v starších verziách) */
  @Input() systems: ItSystem[] = [];
  @Output() saved = new EventEmitter<void>();

  readonly quality = signal<QualityReadiness | null>(null);
  /** null = záznamy nie sú pre tohto človeka dostupné */
  readonly records = signal<EvidenceRecord[] | null>(null);
  readonly error = signal('');
  editing: Section = null;
  draft = { inputs: '', outputs: '', upstream: [] as string[], downstream: [] as string[], systems: [] as string[], successMeasure: '', resources: '', risks: '', opportunities: '', evidence: '' };
  evidenceModel = { requirement: '', performedOn: '', note: '' };
  exceptionFor: string | null = null;
  exceptionReason = '';

  constructor(
    private readonly store: ProcessStoreService,
    readonly auth: AuthService
  ) {}

  get canAssess(): boolean {
    return this.auth.can('process:write') || this.auth.can('iso:write');
  }

  get canApprove(): boolean {
    return this.auth.can('approval:approve');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['process'] || changes['qualityProfile']) this.load();
  }

  private load(): void {
    this.error.set('');
    this.quality.set(null);
    this.records.set(null);
    // posudzovaný návrh (#37) nemá vlastné záznamy ani pripravenosť
    if (!this.process?.id || this.process.view === 'approval' || !this.qualityProfile) return;
    if (this.canAssess) {
      this.store.quality(this.process.id).subscribe({ next: (quality) => this.quality.set(quality), error: () => this.quality.set(null) });
    }
    this.store.evidence(this.process.id).subscribe({ next: (records) => this.records.set(records), error: () => this.records.set(null) });
    this.evidenceModel = { requirement: this.process.evidenceRequirements?.[0] ?? '', performedOn: new Date().toLocaleDateString('sv-SE'), note: '' };
  }

  // --- úprava ---

  startEdit(section: Exclude<Section, null>): void {
    const p = this.process;
    this.draft = {
      inputs: (p.inputs ?? []).join('\n'),
      outputs: (p.outputs ?? []).join('\n'),
      upstream: [...(p.upstreamProcessIds ?? [])],
      downstream: [...(p.downstreamProcessIds ?? [])],
      systems: [...(p.systemIds ?? [])],
      successMeasure: p.successMeasure ?? '',
      resources: p.resources ?? '',
      risks: p.risks ?? '',
      opportunities: p.opportunities ?? '',
      evidence: (p.evidenceRequirements ?? []).join('\n')
    };
    this.error.set('');
    this.editing = section;
  }

  toggleLink(list: 'upstream' | 'downstream' | 'systems', id: string): void {
    const current = this.draft[list];
    this.draft[list] = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  }

  save(): void {
    const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
    const patch = this.editing === 'control'
      ? {
          inputs: lines(this.draft.inputs),
          outputs: lines(this.draft.outputs),
          upstreamProcessIds: this.draft.upstream,
          downstreamProcessIds: this.draft.downstream,
          systemIds: this.draft.systems
        }
      : {
          successMeasure: this.draft.successMeasure,
          resources: this.draft.resources,
          risks: this.draft.risks,
          opportunities: this.draft.opportunities,
          evidenceRequirements: lines(this.draft.evidence)
        };
    this.store.updateProcess(this.process.id, patch, () => {
      this.editing = null;
      this.saved.emit();
    }, (message) => this.error.set(message));
  }

  // --- pripravenosť a záznamy ---

  stateLabel(state: ReadinessState): string {
    return { done: 'hotové', attention: 'potrebuje pozornosť', na: 'neaplikovateľné', unverified: 'neoverené' }[state];
  }

  processName(id: string): string {
    return this.processes.find((item) => item.id === id)?.name ?? 'Proces';
  }

  // --- #43 IT systémy ---

  systemName(id: string): string {
    const system = this.systems.find((item) => item.id === id);
    return system ? `${system.name}${system.archived ? ' (vyradený)' : ''}` : 'Systém';
  }

  isRetired(id: string): boolean {
    return this.systems.find((item) => item.id === id)?.archived ?? false;
  }

  /** Na výber sú aktívne systémy a tie vyradené, ktoré proces už má (dajú sa len odobrať). */
  systemCandidates(): ItSystem[] {
    const linked = new Set(this.process.systemIds ?? []);
    return this.systems.filter((item) => !item.archived || linked.has(item.id));
  }

  /** Systémy, ktoré proces používa len pri krokoch (nie pri celom procese). */
  stepSystems(): string[] {
    const own = new Set(this.process.systemIds ?? []);
    return [...new Set((this.process.activities ?? []).flatMap((step) => step.systemIds ?? []))].filter((id) => !own.has(id));
  }

  linkCandidates(): ProcessNode[] {
    return this.processes.filter((item) => item.type === 'process' && item.id !== this.process.id);
  }

  addEvidence(): void {
    const { requirement, performedOn, note } = this.evidenceModel;
    if (!requirement) return;
    this.store.addEvidence(this.process.id, { requirement, performedOn, note: note.trim() || undefined }).subscribe({
      next: () => {
        this.evidenceModel.note = '';
        this.load();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Záznam sa nepodarilo uložiť.')
    });
  }

  markNotApplicable(item: ReadinessItem): void {
    const reason = this.exceptionReason.trim();
    if (!reason) {
      this.error.set('Uveďte dôvod, prečo položka pre tento proces neplatí.');
      return;
    }
    this.store.markNotApplicable(this.process.id, item.key, reason).subscribe({
      next: () => {
        this.exceptionFor = null;
        this.exceptionReason = '';
        this.load();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Výnimku sa nepodarilo uložiť.')
    });
  }

  approveException(item: ReadinessItem): void {
    if (!item.exception) return;
    this.store.approveException(item.exception.id).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(error?.error?.message ?? 'Výnimku sa nepodarilo schváliť.')
    });
  }

  revokeException(item: ReadinessItem): void {
    if (!item.exception) return;
    this.store.revokeException(item.exception.id).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(error?.error?.message ?? 'Výnimku sa nepodarilo zrušiť.')
    });
  }
}
