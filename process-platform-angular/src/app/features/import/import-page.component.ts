import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AiStatus, AnalyzeResult, ApplyResult, Citation, PositionCandidate, ProcessCandidate, UnitCandidate } from '../../core/models/import.model';
import { OrgPosition } from '../../core/models/user.model';
import { AiImportService } from '../../core/services/ai-import.service';
import { AuthService } from '../../core/services/auth.service';
import { PositionService } from '../../core/services/position.service';
import { BpmnViewerComponent } from '../processes/components/bpmn-viewer.component';
import { DraftStep, ProcessDraft, draftSteps, foldName, sanitizeDraft } from '../../shared/process-draft/draft';
import { draftToBpmnXml } from '../../shared/process-draft/bpmn-layout';

type Tab = 'text' | 'files';
type FileJob = { id: number; file: File; status: 'waiting' | 'analyzing' | 'done' | 'error'; result?: AnalyzeResult; error?: string };
type Merged<T> = T & { sources: Citation[] };

const ACCEPT = '.docx,.xlsx,.pptx,.csv,.txt,.md,.pdf,.png,.jpg,.jpeg,.webp,.gif';
const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const SAMPLE = `Spracovanie prijatej faktúry
Účel: faktúry sú uhradené včas a správne zaúčtované.
Proces začína, keď príde faktúra od dodávateľa.
1. Asistentka zaeviduje faktúru.
2. Účtovník skontroluje faktúru voči objednávke.
3. Ak je faktúra v poriadku, vedúci oddelenia ju schváli, inak ju účtovník vráti dodávateľovi.
4. Účtovník faktúru zaúčtuje a pripraví platobný príkaz.
Výsledok: uhradená a zaúčtovaná faktúra.`;

/**
 * #42 AI-01 / #41 IMP-01 — návrh procesu z textu a import dokumentov
 * (Word, Excel, PowerPoint, CSV, PDF, obrázok organizačnej schémy).
 * Všetko je najprv len návrh na kontrolu; vytvorí sa až po potvrdení
 * a procesy vždy ako nepublikované návrhy.
 */
@Component({
  selector: 'pp-import-page',
  standalone: true,
  imports: [FormsModule, RouterLink, BpmnViewerComponent],
  templateUrl: './import-page.component.html',
  styleUrl: './import-page.component.scss'
})
export class ImportPageComponent implements OnInit {
  readonly tab = signal<Tab>('text');
  readonly ai = signal<AiStatus | null>(null);
  readonly positions = signal<OrgPosition[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly accept = ACCEPT;
  readonly canOrg = this.auth.can('organization:write');
  readonly canProcess = this.auth.can('process:write');

  // --- z textu ---
  text = '';
  useAi = false;
  readonly draft = signal<ProcessDraft | null>(null);
  readonly method = signal<'ai' | 'rules' | null>(null);
  readonly previewXml = signal('');
  ownerRole = '';
  createMissingRoles = false;

  // --- zo súborov ---
  readonly jobs = signal<FileJob[]>([]);
  private jobId = 0;
  useAiFiles = false;
  createPeople = false;
  createMissingRolesFiles = false;
  readonly selectedUnits = signal<Set<string>>(new Set());
  readonly selectedPositions = signal<Set<string>>(new Set());
  readonly selectedProcesses = signal<Set<string>>(new Set());
  readonly openProcess = signal<string | null>(null);
  readonly applied = signal<ApplyResult | null>(null);

  readonly results = computed(() => this.jobs().flatMap((job) => job.result ?? []));

  /** Kandidáti zo všetkých súborov — rovnaký názov (bez diakritiky) sa zlúči, citácie ostanú všetky. */
  readonly units = computed(() => this.merge(this.results().flatMap((result) => result.units), (item) => item.key));
  readonly candidatePositions = computed(() => this.merge(this.results().flatMap((result) => result.positions), (item) => item.key));
  readonly processes = computed(() => this.merge(this.results().flatMap((result) => result.processes), (item) => foldName(item.draft.name)));
  readonly warnings = computed(() => this.jobs().flatMap((job) => (job.result?.warnings ?? []).map((warning) => `${job.file.name}: ${warning}`)));
  readonly hasCandidates = computed(() => this.units().length + this.candidatePositions().length + this.processes().length > 0);

  constructor(
    private readonly api: AiImportService,
    private readonly positionsApi: PositionService,
    readonly auth: AuthService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.api.status().subscribe({ next: (status) => this.ai.set(status), error: () => this.ai.set(null) });
    this.positionsApi.list().subscribe({ next: (items) => this.positions.set(items.filter((item) => !item.archived)), error: () => undefined });
  }

  private fail(fallback: string) {
    return (error: any) => {
      this.busy.set(false);
      this.error.set(error?.error?.message ?? fallback);
    };
  }

  // --- z textu ---

  useSample(): void {
    this.text = SAMPLE;
  }

  makeDraft(): void {
    this.error.set('');
    this.busy.set(true);
    this.api.draftFromText(this.text, this.useAi && Boolean(this.ai()?.available)).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.method.set(result.method);
        this.draft.set(result.draft);
        this.ownerRole = '';
        this.refreshPreview();
      },
      error: this.fail('Návrh sa nepodarilo vytvoriť.')
    });
  }

  /** Po úprave názvov a rolí sa náhľad diagramu prekreslí (v prehliadači). */
  refreshPreview(): void {
    const draft = this.draft();
    if (!draft) return;
    const clean = sanitizeDraft(draft);
    this.draft.set(clean);
    this.previewXml.set(draftToBpmnXml(clean));
  }

  steps(draft: ProcessDraft): DraftStep[] {
    return draftSteps(draft);
  }

  tasks(draft: ProcessDraft) {
    return draft.nodes.filter((node) => node.type === 'task' || node.type === 'gateway');
  }

  /** Rola z návrhu už je pracovným miestom firmy? */
  isPosition(role: string | undefined | null): boolean {
    return Boolean(role) && this.positions().some((position) => foldName(position.name) === foldName(role!));
  }

  roleOptions(draft: ProcessDraft): string[] {
    const names = new Map<string, string>();
    for (const name of [...draft.roles, ...this.positions().map((position) => position.name)]) names.set(foldName(name), names.get(foldName(name)) ?? name);
    return [...names.values()].sort((a, b) => a.localeCompare(b, 'sk'));
  }

  unmatchedRoles(draft: ProcessDraft): string[] {
    return draft.roles.filter((role) => !this.isPosition(role));
  }

  createFromDraft(): void {
    const draft = this.draft();
    if (!draft) return;
    this.error.set('');
    this.busy.set(true);
    this.api.apply({ processes: [{ draft: sanitizeDraft(draft), ownerRole: this.ownerRole || null }], createMissingRoles: this.createMissingRoles }).subscribe({
      next: (result) => {
        this.busy.set(false);
        const created = result.processes[0];
        if (created) this.router.navigate(['/app/processes', created.id]);
      },
      error: this.fail('Proces sa nepodarilo vytvoriť.')
    });
  }

  // --- zo súborov ---

  addFiles(list: FileList | null): void {
    this.error.set('');
    this.applied.set(null);
    const files = list ? Array.from(list) : [];
    const room = MAX_FILES - this.jobs().length;
    if (files.length > room) this.error.set(`Naraz najviac ${MAX_FILES} súborov.`);
    const accepted = files.slice(0, Math.max(0, room)).filter((file) => {
      if (file.size > MAX_FILE_BYTES) {
        this.error.set(`${file.name}: súbor je väčší ako 20 MB.`);
        return false;
      }
      return true;
    });
    this.jobs.update((jobs) => [...jobs, ...accepted.map((file) => ({ id: ++this.jobId, file, status: 'waiting' as const }))]);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.addFiles(event.dataTransfer?.files ?? null);
  }

  removeJob(job: FileJob): void {
    this.jobs.update((jobs) => jobs.filter((item) => item.id !== job.id));
    this.resetSelection();
  }

  /** Súbory po jednom (server ich neukladá, len rozoberie). */
  analyzeAll(): void {
    const next = this.jobs().find((job) => job.status === 'waiting' || job.status === 'error');
    if (!next) {
      this.busy.set(false);
      this.resetSelection();
      return;
    }
    this.busy.set(true);
    this.updateJob(next.id, { status: 'analyzing', error: undefined });
    this.api.analyze(next.file, this.useAiFiles && Boolean(this.ai()?.available)).subscribe({
      next: (result) => {
        this.updateJob(next.id, { status: 'done', result });
        this.analyzeAll();
      },
      error: (error) => {
        this.updateJob(next.id, { status: 'error', error: error?.error?.message ?? 'Súbor sa nepodarilo rozobrať.' });
        // ďalšie súbory pokračujú; chybný sa dá skúsiť znova
        const pending = this.jobs().some((job) => job.status === 'waiting');
        if (pending) this.analyzeAll();
        else {
          this.busy.set(false);
          this.resetSelection();
        }
      }
    });
  }

  private updateJob(id: number, patch: Partial<FileJob>): void {
    this.jobs.update((jobs) => jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }

  private merge<T extends { source: Citation }>(items: T[], keyOf: (item: T) => string): Merged<T>[] {
    const merged = new Map<string, Merged<T>>();
    for (const item of items) {
      const key = keyOf(item);
      const existing = merged.get(key);
      if (!existing) merged.set(key, { ...item, sources: [item.source] });
      else {
        existing.sources.push(item.source);
        // doplniť, čo prvý súbor nemal (útvar, nadriadený, meno)
        for (const field of ['unitKey', 'reportsToKey', 'holder', 'parentKey'] as const) {
          if ((existing as any)[field] == null && (item as any)[field] != null) (existing as any)[field] = (item as any)[field];
        }
      }
    }
    return [...merged.values()];
  }

  /** Predvolene: nové útvary a miesta áno, procesy áno — okrem tých, ktoré firma už má. */
  private resetSelection(): void {
    this.selectedUnits.set(new Set(this.units().map((item) => item.key)));
    this.selectedPositions.set(new Set(this.candidatePositions().map((item) => item.key)));
    this.selectedProcesses.set(new Set(this.processes().filter((item) => !item.existing).map((item) => foldName(item.draft.name))));
  }

  toggle(set: 'units' | 'positions' | 'processes', key: string): void {
    const target = { units: this.selectedUnits, positions: this.selectedPositions, processes: this.selectedProcesses }[set];
    target.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  processKey(item: ProcessCandidate): string {
    return foldName(item.draft.name);
  }

  unitName(key: string | null): string {
    if (!key) return '';
    return this.units().find((unit) => unit.key === key)?.name ?? key;
  }

  positionName(key: string | null): string {
    if (!key) return '';
    return this.candidatePositions().find((position) => position.key === key)?.name
      ?? this.positions().find((position) => foldName(position.name) === key)?.name
      ?? key;
  }

  previewFor(item: ProcessCandidate): string {
    return draftToBpmnXml(item.draft);
  }

  newCount(list: Array<UnitCandidate | PositionCandidate>, selected: Set<string>): number {
    return list.filter((item) => selected.has(item.key) && !item.existing).length;
  }

  /** Vytvára sa niečo z organizačnej štruktúry? Na to treba správu firmy. */
  needsOrg(): boolean {
    return this.newCount(this.units(), this.selectedUnits()) > 0 || this.newCount(this.candidatePositions(), this.selectedPositions()) > 0
      || this.createPeople || this.createMissingRolesFiles;
  }

  applySelected(): void {
    const units = this.units().filter((item) => this.selectedUnits().has(item.key));
    const positions = this.candidatePositions().filter((item) => this.selectedPositions().has(item.key));
    const processes = this.processes().filter((item) => this.selectedProcesses().has(this.processKey(item)));
    this.error.set('');
    this.busy.set(true);
    this.api.apply({
      units: units.map((item) => ({ name: item.name, parentKey: item.parentKey })),
      positions: positions.map((item) => ({ name: item.name, unitKey: item.unitKey, reportsToKey: item.reportsToKey, holder: item.holder })),
      processes: processes.map((item) => ({ draft: item.draft, ownerRole: null, source: item.source })),
      createPeople: this.createPeople,
      createMissingRoles: this.createMissingRolesFiles
    }).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.applied.set(result);
        this.positionsApi.list().subscribe({ next: (items) => this.positions.set(items.filter((item) => !item.archived)), error: () => undefined });
      },
      error: this.fail('Import sa nepodarilo dokončiť.')
    });
  }

  resetFiles(): void {
    this.jobs.set([]);
    this.applied.set(null);
    this.resetSelection();
  }

  statusLabel(job: FileJob): string {
    if (job.status === 'done') {
      const r = job.result!;
      return `${r.method === 'ai' ? 'AI' : 'pravidlá'} · útvary ${r.units.length}, miesta ${r.positions.length}, procesy ${r.processes.length}`;
    }
    return { waiting: 'čaká', analyzing: 'rozoberá sa…', error: job.error ?? 'chyba' }[job.status];
  }
}
