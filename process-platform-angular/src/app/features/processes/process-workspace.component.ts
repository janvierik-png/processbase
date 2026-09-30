import { Component, OnInit, computed, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BpmnEditorComponent } from './components/bpmn-editor.component';
import { BpmnViewerComponent } from './components/bpmn-viewer.component';
import { FlowchartEditorComponent } from './components/flowchart-editor.component';
import { RichTextEditorComponent } from './components/rich-text-editor.component';
import { ProcessQualityComponent } from './components/process-quality.component';
import { markdownToHtml } from '../../core/utils/markdown';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, formatBytes, isPreviewable } from '../../core/utils/upload-limits';
import { PdfPreviewComponent } from '../../shared/pdf-preview.component';
import { ProcessStoreService } from '../../core/services/process-store.service';
import { PositionService } from '../../core/services/position.service';
import {
  ApprovalRequestInfo,
  Attachment,
  DocumentVersions,
  IsoNorm,
  IsoSuggestion,
  ProcessChange,
  ProcessFeedback,
  ProcessDetail,
  ProcessNode,
  ProcessRevision,
  RaciCode,
  ProcessVersionMeta
} from '../../core/models/process.model';
import { ItSystem, OrgPosition, Person } from '../../core/models/user.model';
import { SystemService } from '../../core/services/system.service';
import { OrganizationService } from '../../core/services/organization.service';
import { Camunda7Service } from '../../core/services/camunda7.service';
import { DocumentService } from '../../core/services/document.service';
import { StorageService } from '../../core/services/storage.service';
import { AuthService } from '../../core/services/auth.service';

type TreeRow = { node: ProcessNode; level: number; kind: 'process' | 'clause' | 'norm' };
type PanelState = 'wide' | 'narrow' | 'hidden';
type Tab = 'card' | 'bpmn' | 'history';
type EditSection = 'basic' | 'description' | 'relations' | 'steps' | null;
type RaciDraft = { role: RaciCode; positionId: string | null; personId: string | null };
type StepDraft = {
  key: string;
  id: string | null;
  title: string;
  description: string;
  /** #29 — RACI kroku a rozpísané pridanie ďalšej zodpovednosti */
  raci: RaciDraft[];
  newRole: RaciCode;
  newHolder: string;
  /** #43 — IT systémy použité pri kroku */
  systemIds: string[];
  newSystem: string;
};

@Component({
  selector: 'pp-process-workspace',
  standalone: true,
  imports: [
    FormsModule,
    DecimalPipe,
    BpmnEditorComponent,
    BpmnViewerComponent,
    FlowchartEditorComponent,
    RichTextEditorComponent,
    ProcessQualityComponent,
    PdfPreviewComponent
  ],
  templateUrl: './process-workspace.component.html',
  styleUrl: './process-workspace.component.scss'
})
export class ProcessWorkspaceComponent implements OnInit {
  readonly active = computed(() => this.store.activeProcess());
  readonly deployState = signal('');
  readonly camundaDetailsOpen = signal(false);
  readonly collapsedIds = signal<Set<string>>(new Set());
  readonly documents = signal<Attachment[]>([]);

  // R2: stav stromoveho panelu (zachovava sa v localStorage)
  readonly panelState = signal<PanelState>((this.storage.readString('ngTreePanel', 'wide') as PanelState) || 'wide');

  // R3/R7: detail, zalozky, historia
  readonly tab = signal<Tab>('card');
  readonly detail = signal<ProcessDetail | null>(null);
  readonly history = signal<ProcessChange[]>([]);
  readonly viewedRevision = signal<ProcessRevision | null>(null);
  changeDescription = '';

  // R1: pozicie organizacie
  readonly positions = signal<OrgPosition[]>([]);
  // #43 — IT systémy firmy (aj vyradené, kvôli názvom v starších verziách)
  readonly systems = signal<ItSystem[]>([]);

  // dokumenty — premenovanie, nahravanie, nahlad
  editingDocumentId: string | null = null;
  documentNameDraft = '';
  readonly uploading = signal(false);
  readonly previewDocument = signal<Attachment | null>(null);

  // karta procesu — ktora sekcia je prave v rezime upravy
  readonly editSection = signal<EditSection>(null);

  // vyhladavanie v strome
  treeSearch = '';

  // R6: ISO normy a rezim stromu
  readonly norms = signal<IsoNorm[]>([]);
  readonly treeMode = signal<'standard' | 'iso'>('standard');

  // Suvisiace procesy — vyhladavanie
  relatedSearch = '';
  relatedOpen = false;
  readonly relatedSearchResults = computed(() => {
    const q = this.relatedSearch.trim().toLowerCase();
    const detail = this.detail();
    const assigned = new Set(detail?.relatedProcessIds ?? []);
    return this.processes()
      .filter((p) => p.id !== detail?.id && !assigned.has(p.id) && (!q || p.name.toLowerCase().includes(q)))
      .slice(0, 10);
  });

  // R2: drag-and-drop
  readonly dragId = signal<string | null>(null);
  readonly dropTargetId = signal<string | null>(null);

  readonly processes = computed(() => this.store.flatten().filter((node) => node.type === 'process'));
  readonly treeRows = computed<TreeRow[]>(() => this.treeMode() === 'iso' ? this.buildIsoRows() : this.buildProcessRows());
  readonly unassignedProcesses = computed(() => this.treeMode() === 'iso'
    ? this.processes().filter((process) => !(process.iso ?? []).length)
    : []);

  constructor(
    readonly store: ProcessStoreService,
    private readonly camunda: Camunda7Service,
    private readonly documentsApi: DocumentService,
    private readonly positionsApi: PositionService,
    private readonly systemsApi: SystemService,
    private readonly organizationApi: OrganizationService,
    private readonly storage: StorageService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly auth: AuthService
  ) {}

  ngOnInit(): void {
    this.store.loadFromDatabase();
    this.positionsApi.list().subscribe({ next: (items) => this.positions.set(items), error: () => undefined });
    this.systemsApi.list().subscribe({ next: (items) => this.systems.set(items), error: () => undefined });
    this.store.isoNorms().subscribe({ next: (norms) => this.norms.set(norms), error: () => undefined });

    // R3: vlastna URL procesu /app/processes/:id
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.store.setActive(id);
        // #37 — odkaz zo schránky schvaľovateľa otvorí priamo posudzovaný obsah
        this.openDetail(id, 'draft', this.route.snapshot.queryParamMap.get('approval'));
      }
    });
  }

  // --- R2: strom ---

  select(node: ProcessNode): void {
    this.selectById(node.id);
  }

  selectById(id: string): void {
    this.router.navigate(['/app/processes', id]);
  }

  cyclePanel(): void {
    const order: PanelState[] = ['wide', 'narrow', 'hidden'];
    const next = order[(order.indexOf(this.panelState()) + 1) % order.length];
    this.panelState.set(next);
    this.storage.writeString('ngTreePanel', next);
  }

  panelLabel(): string {
    if (this.panelState() === 'wide') return 'Zuzit strom';
    if (this.panelState() === 'narrow') return 'Skryt strom';
    return 'Zobrazit strom';
  }

  onDragStart(node: ProcessNode, event: DragEvent): void {
    this.dragId.set(node.id);
    event.dataTransfer?.setData('text/plain', node.id);
  }

  onDragOver(node: ProcessNode | null, event: DragEvent): void {
    event.preventDefault();
    this.dropTargetId.set(node?.id ?? '__root__');
  }

  onDrop(target: ProcessNode | null, event: DragEvent): void {
    event.preventDefault();
    const dragged = this.dragId();
    this.dragId.set(null);
    this.dropTargetId.set(null);
    if (!dragged) return;
    if (target && (target.id === dragged || this.isDescendantOf(target.id, dragged))) return;
    this.store.updateProcess(dragged, { parentId: target?.id ?? null }, () => {
      if (this.store.activeProcessId() === dragged) this.openDetail(dragged);
    });
  }

  toggleCollapse(node: ProcessNode, event: Event): void {
    event.stopPropagation();
    const next = new Set(this.collapsedIds());
    next.has(node.id) ? next.delete(node.id) : next.add(node.id);
    this.collapsedIds.set(next);
  }

  rename(node: ProcessNode, event: Event): void {
    event.stopPropagation();
    const name = window.prompt('Novy nazov', node.name);
    if (name?.trim()) this.store.renameNode(node.id, name.trim());
  }

  delete(node: ProcessNode, event: Event): void {
    event.stopPropagation();
    if (!window.confirm(`Vymazat ${node.name}?`)) return;
    this.store.deleteNode(node.id);
    this.documents.set([]);
    if (this.detail()?.id === node.id) this.detail.set(null);
  }

  // --- R3: karta procesu ---

  openDetail(id: string, mode: 'draft' | 'effective' = 'draft', approvalId: string | null = null): void {
    this.saveError.set('');
    this.tab.set('card');
    this.viewedRevision.set(null);
    this.editSection.set(null);
    this.editingDocumentId = null;
    this.changeDescription = '';
    this.publishOpen = false;
    this.viewMode.set(mode);
    this.store.detail(id).subscribe({
      next: (detail) => {
        this.ownerPositionDraft = detail.ownerPosition?.id ?? '';
        if (approvalId) {
          this.openApproval(approvalId);
          return;
        }
        // #27 — kto proces neupravuje, vidí predovšetkým platnú verziu
        if (mode === 'effective' || (!this.canWrite && detail.publication?.effective)) {
          this.showEffective(id);
          return;
        }
        this.detail.set(detail);
      },
      error: () => this.detail.set(null)
    });
    this.store.versions(id).subscribe({ next: (versions) => this.versions.set(versions), error: () => this.versions.set([]) });
    this.store.approvalRequests(id).subscribe({ next: (items) => this.approvals.set(items), error: () => this.approvals.set([]) });
    this.loadFeedback(id);
    this.store.history(id).subscribe({
      next: (history) => this.history.set(history),
      error: () => this.history.set([])
    });
    this.loadDocuments(id);
  }

  parentCandidates(): ProcessNode[] {
    const detail = this.detail();
    if (!detail) return [];
    return this.processes().filter((process) => process.id !== detail.id && !this.isDescendantOf(process.id, detail.id));
  }

  relatedCandidates(): ProcessNode[] {
    const detail = this.detail();
    return this.processes().filter((process) => process.id !== detail?.id);
  }

  toggleRelated(processId: string): void {
    const detail = this.detail();
    if (!detail) return;
    const current = detail.relatedProcessIds ?? [];
    detail.relatedProcessIds = current.includes(processId)
      ? current.filter((id) => id !== processId)
      : [...current, processId];
  }

  addRelated(processId: string): void {
    const detail = this.detail();
    if (!detail) return;
    const current = detail.relatedProcessIds ?? [];
    if (!current.includes(processId)) detail.relatedProcessIds = [...current, processId];
    this.relatedSearch = '';
    this.relatedOpen = false;
  }

  relatedName(id: string): string {
    return this.processes().find((p) => p.id === id)?.name ?? id;
  }

  onRelatedBlur(): void {
    setTimeout(() => { this.relatedOpen = false; }, 150);
  }

  /** #15 — vybrane miesto vlastnika v rezime upravy ('' = ziadne). */
  ownerPositionDraft = '';

  holderNames(position: OrgPosition): string {
    return position.holders.map((holder) => holder.name).join(', ');
  }

  togglePosition(positionId: string): void {
    const detail = this.detail();
    if (!detail) return;
    const current = detail.positionIds ?? [];
    detail.positionIds = current.includes(positionId)
      ? current.filter((id) => id !== positionId)
      : [...current, positionId];
  }

  /**
   * Dokumentácia sa ukladá ako Markdown — na čítanie ju prevedieme na HTML.
   * Angular výstup ešte sanitizuje, a markdownToHtml navyše escapuje vstup,
   * takže sa cez dokumentáciu nedá vložiť vlastné HTML.
   */
  renderedDocumentation(): string {
    return markdownToHtml(this.detail()?.descriptionText ?? '');
  }

  // --- karta procesu: rezim upravy po sekciach ---

  startEdit(section: Exclude<EditSection, null>): void {
    this.saveError.set('');
    this.editSection.set(section);
  }

  cancelEdit(): void {
    const detail = this.detail();
    this.editSection.set(null);
    this.changeDescription = '';
    // zahod neulozene zmeny — nacitaj cerstvy stav z databazy
    if (detail) this.openDetail(detail.id);
  }

  /** Stav procesu -> CSS trieda badge. */
  statusClass(status?: string): string {
    // #27 — stav počíta server z verzií: „Návrh", „Platná vN", „Naplánovaná vN"
    const value = (status ?? '').toLowerCase();
    if (value.startsWith('platn')) return 'is-approved';
    if (value.startsWith('naplán')) return 'is-review';
    if (value.includes('arch')) return 'is-archived';
    return 'is-draft';
  }

  initials(name?: string | null): string {
    return (name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';
  }

  /** Pripona suboru pre ikonu dokumentu. */
  fileExtension(document: Attachment): string {
    const fromName = document.name?.split('.').pop() ?? '';
    if (fromName && fromName.length <= 5 && fromName !== document.name) return fromName.toUpperCase();
    return (document.type?.split('/').pop() ?? 'file').slice(0, 4).toUpperCase();
  }

  // --- vyhladavanie v strome ---

  visibleTreeRows(): TreeRow[] {
    const query = this.treeSearch.trim().toLowerCase();
    const rows = this.treeRows();
    if (!query) return rows;
    // pri hladani zobraz plochy zoznam zhod — bez hierarchie, aby bolo vidno vsetko
    return rows
      .filter((row) => row.kind === 'process'
        && (row.node.name.toLowerCase().includes(query) || (row.node.code ?? '').toLowerCase().includes(query)))
      .map((row) => ({ ...row, level: 0 }));
  }

  clearTreeSearch(): void {
    this.treeSearch = '';
  }

  // --- #28 kroky procesu ---

  stepsDraft: StepDraft[] = [];
  readonly stepsError = signal('');
  private stepKey = 0;

  startStepsEdit(): void {
    this.stepsError.set('');
    this.stepsDraft = (this.detail()?.activities ?? []).map((step) => ({
      key: `s${this.stepKey++}`,
      id: step.id,
      title: step.title,
      description: step.description ?? '',
      raci: (step.raci ?? []).map((item) => ({ role: item.role, positionId: item.positionId, personId: item.personId })),
      newRole: 'R' as RaciCode,
      newHolder: '',
      systemIds: [...(step.systemIds ?? [])],
      newSystem: ''
    }));
    if (this.stepsDraft.length === 0) this.addStep();
    // osoby len pre výnimočné priradenie konkrétnemu človeku (#29)
    if (this.people().length === 0) {
      this.organizationApi.people().subscribe({ next: (people) => this.people.set(people.filter((person) => person.active)), error: () => undefined });
    }
    this.editSection.set('steps');
  }

  addStep(): void {
    this.stepsDraft = [...this.stepsDraft, { key: `s${this.stepKey++}`, id: null, title: '', description: '', raci: [], newRole: 'R', newHolder: '', systemIds: [], newSystem: '' }];
  }

  // --- #43 IT systémy pri kroku ---

  /** Aktívne systémy na výber; vyradený ostane pri kroku, kým ho niekto neodoberie. */
  readonly selectableSystems = computed(() => this.systems().filter((system) => !system.archived));

  systemName(id: string): string {
    const system = this.systems().find((item) => item.id === id);
    return system ? `${system.name}${system.archived ? ' (vyradený)' : ''}` : 'Systém';
  }

  isRetiredSystem(id: string): boolean {
    return this.systems().find((item) => item.id === id)?.archived ?? false;
  }

  addStepSystem(step: StepDraft): void {
    if (step.newSystem && !step.systemIds.includes(step.newSystem)) step.systemIds = [...step.systemIds, step.newSystem];
    step.newSystem = '';
  }

  removeStepSystem(step: StepDraft, id: string): void {
    step.systemIds = step.systemIds.filter((item) => item !== id);
  }

  // --- #36 podnety k procesu ---

  readonly feedback = signal<{ canDecide: boolean; items: ProcessFeedback[] }>({ canDecide: false, items: [] });
  readonly feedbackError = signal('');
  readonly feedbackNotice = signal('');
  feedbackOpen = false;
  feedbackModel: { kind: 'error' | 'improvement'; text: string; activityId: string } = { kind: 'error', text: '', activityId: '' };
  /** rozpísaná odpoveď vlastníka pri každom podnete */
  feedbackNotes: Record<string, string> = {};

  private loadFeedback(id: string): void {
    this.store.processFeedback(id).subscribe({
      next: (feedback) => this.feedback.set(feedback),
      error: () => this.feedback.set({ canDecide: false, items: [] })
    });
  }

  openFeedback(): void {
    this.feedbackError.set('');
    this.feedbackNotice.set('');
    this.feedbackModel = { kind: 'error', text: '', activityId: '' };
    this.feedbackOpen = true;
  }

  submitFeedback(): void {
    const detail = this.detail();
    if (!detail) return;
    this.store.submitFeedback(detail.id, {
      kind: this.feedbackModel.kind,
      text: this.feedbackModel.text.trim(),
      activityId: this.feedbackModel.activityId || undefined,
      // podnet sa viaže na verziu, ktorú človek práve číta
      revision: detail.view === 'version' ? detail.version?.revision : undefined
    }).subscribe({
      next: () => {
        this.feedbackOpen = false;
        this.feedbackNotice.set('Ďakujeme — vlastník procesu podnet posúdi. Výsledok uvidíte tu.');
        this.loadFeedback(detail.id);
      },
      error: (error) => this.feedbackError.set(error?.error?.message ?? 'Podnet sa nepodarilo odoslať.')
    });
  }

  decideFeedback(item: ProcessFeedback, status: 'accepted' | 'rejected' | 'done'): void {
    const detail = this.detail();
    if (!detail) return;
    this.feedbackError.set('');
    this.store.decideFeedback(item.id, status, this.feedbackNotes[item.id]?.trim() || undefined).subscribe({
      next: () => {
        delete this.feedbackNotes[item.id];
        this.loadFeedback(detail.id);
      },
      error: (error) => this.feedbackError.set(error?.error?.message ?? 'Rozhodnutie sa nepodarilo uložiť.')
    });
  }

  feedbackStatusLabel(status: ProcessFeedback['status']): string {
    return { open: 'nový', accepted: 'prijatý — zapracuje sa', rejected: 'zamietnutý', done: 'vybavený' }[status];
  }

  // --- #29 RACI na kroku ---

  readonly people = signal<Person[]>([]);
  readonly raciRoles: Array<{ code: RaciCode; label: string }> = [
    { code: 'R', label: 'R — vykonáva' },
    { code: 'A', label: 'A — zodpovedá' },
    { code: 'C', label: 'C — konzultuje' },
    { code: 'I', label: 'I — je informovaný' }
  ];

  raciLabel(code: RaciCode): string {
    return { R: 'vykonáva', A: 'zodpovedá', C: 'konzultuje', I: 'informovaný' }[code];
  }

  /** Názov miesta alebo osoby v rozpracovanom kroku. */
  raciHolderName(item: RaciDraft): string {
    if (item.positionId) return this.positions().find((position) => position.id === item.positionId)?.name ?? 'Pracovné miesto';
    return this.people().find((person) => person.id === item.personId)?.name ?? 'Osoba';
  }

  /** Hodnota výberu: „pos:ID“ = miesto, „per:ID“ = osoba (výnimka), „new“ = založiť miesto. */
  addRaci(step: StepDraft): void {
    const [kind, id] = step.newHolder.split(':');
    if (step.newHolder === 'new') {
      this.createRaciPosition(step);
      return;
    }
    if (!id) return;
    const entry: RaciDraft = { role: step.newRole, positionId: kind === 'pos' ? id : null, personId: kind === 'per' ? id : null };
    const exists = step.raci.some((item) => item.role === entry.role && item.positionId === entry.positionId && item.personId === entry.personId);
    // zodpovedný (A) je na kroku jeden — nový nahradí predchádzajúceho
    if (!exists) step.raci = [...step.raci.filter((item) => entry.role !== 'A' || item.role !== 'A'), entry];
    step.newHolder = '';
  }

  removeRaci(step: StepDraft, index: number): void {
    step.raci = step.raci.filter((_, position) => position !== index);
  }

  /** Nové miesto priamo pri kroku — bez odbočky do Organizácie. */
  private createRaciPosition(step: StepDraft): void {
    step.newHolder = '';
    if (!this.canCreatePosition) return;
    const name = window.prompt('Názov nového pracovného miesta, napr. Účtovník')?.trim();
    if (!name) return;
    this.positionsApi.create({ name }).subscribe({
      next: (position) => {
        this.positions.update((items) => [...items, position].sort((a, b) => a.name.localeCompare(b.name)));
        step.newHolder = `pos:${position.id}`;
        this.addRaci(step);
      },
      error: (error) => this.stepsError.set(error?.error?.message ?? 'Miesto sa nepodarilo vytvoriť.')
    });
  }

  removeStep(index: number): void {
    this.stepsDraft = this.stepsDraft.filter((_, position) => position !== index);
  }

  moveStep(index: number, offset: number): void {
    const target = index + offset;
    if (target < 0 || target >= this.stepsDraft.length) return;
    const next = [...this.stepsDraft];
    [next[index], next[target]] = [next[target], next[index]];
    this.stepsDraft = next;
  }

  saveSteps(): void {
    const detail = this.detail();
    if (!detail) return;
    // prázdne riadky (napr. pridané omylom) sa neukladajú
    const steps = this.stepsDraft
      .filter((step) => step.title.trim() || step.description.trim())
      .map((step) => ({
        id: step.id ?? undefined,
        title: step.title.trim(),
        description: step.description.trim(),
        raci: step.raci.map((item) => item.positionId ? { role: item.role, positionId: item.positionId } : { role: item.role, personId: item.personId ?? undefined }),
        systemIds: step.systemIds
      }));
    if (steps.some((step) => !step.title)) {
      this.stepsError.set('Každý krok potrebuje názov.');
      return;
    }
    this.store.saveActivities(detail.id, steps).subscribe({
      next: () => {
        this.editSection.set(null);
        this.openDetail(detail.id);
      },
      error: (error) => this.stepsError.set(error?.error?.message ?? 'Kroky sa nepodarilo uložiť.')
    });
  }

  newPositionName = '';

  /** Nové miesto priamo pri procese smie založiť, kto smie meniť organizáciu. */
  get canCreatePosition(): boolean {
    return this.auth.can('organization:write');
  }

  createOwnerPosition(): void {
    const name = this.newPositionName.trim();
    if (!name) return;
    this.positionsApi.create({ name }).subscribe({
      next: (position) => {
        this.positions.update((items) => [...items, position].sort((a, b) => a.name.localeCompare(b.name)));
        this.ownerPositionDraft = position.id;
        this.newPositionName = '';
      },
      error: (error) => this.store.error.set(error?.error?.message ?? 'Miesto sa nepodarilo vytvoriť.')
    });
  }

  /** #43 — na výber len aktívne miesta; už priradené archivované ostane viditeľné. */
  selectablePositions(current: Array<string | null | undefined> = []): OrgPosition[] {
    return this.positions().filter((position) => !position.archived || current.includes(position.id));
  }

  newPerformerName = '';

  createPerformerPosition(): void {
    const name = this.newPerformerName.trim();
    if (!name) return;
    this.positionsApi.create({ name }).subscribe({
      next: (position) => {
        this.positions.update((items) => [...items, position].sort((a, b) => a.name.localeCompare(b.name)));
        const detail = this.detail();
        if (detail) detail.positionIds = [...(detail.positionIds ?? []), position.id];
        this.newPerformerName = '';
      },
      error: (error) => this.saveError.set(error?.error?.message ?? 'Miesto sa nepodarilo vytvoriť.')
    });
  }

  /** Povinné údaje, ktoré chýbajú na publikovanie (#28). */
  missingRequired(): Array<{ key: string; label: string }> {
    return (this.detail()?.readiness ?? []).filter((item) => item.required && !item.ok);
  }

  missingRecommended(): Array<{ key: string; label: string }> {
    return (this.detail()?.readiness ?? []).filter((item) => !item.required && !item.ok);
  }

  // --- #27 verzie procesu ---

  readonly viewMode = signal<'draft' | 'effective' | 'approval'>('draft');
  readonly versions = signal<ProcessVersionMeta[]>([]);
  readonly publishError = signal('');
  publishOpen = false;
  publishModel = { effectiveFrom: '', changeReason: '', nextReviewAt: '' };

  /** Deň udalosti v miestnom čase (slice ISO reťazca by po polnoci ukázal včerajšok v UTC). */
  localDay(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleDateString('sv-SE') : '';
  }

  /** Miestny dnešok (toISOString by dal UTC — po polnoci ešte včerajšok). */
  todayLocal(): string {
    return new Date().toLocaleDateString('sv-SE');
  }

  /** Publikovaná verzia alebo bez oprávnenia — nič sa nedá meniť. */
  readOnlyView(): boolean {
    return !this.canWrite || this.viewMode() !== 'draft';
  }

  setViewMode(mode: 'draft' | 'effective'): void {
    const id = this.detail()?.id;
    if (!id || mode === this.viewMode()) return;
    this.clearApprovalParam();
    if (mode === 'effective') {
      this.viewMode.set('effective');
      this.editSection.set(null);
      this.showEffective(id);
    } else {
      this.openDetail(id, 'draft');
    }
  }

  /** Platná verzia — dokumenty sa zobrazia tak, ako boli pri publikovaní. */
  private showEffective(id: string): void {
    this.viewMode.set('effective');
    this.store.effectiveDetail(id).subscribe({
      next: (version) => this.applyVersion(version),
      error: () => this.openDetail(id, 'draft')
    });
  }

  openVersion(version: ProcessVersionMeta): void {
    const id = this.detail()?.id;
    if (!id) return;
    this.store.versionDetail(id, version.revision).subscribe({
      next: (detail) => {
        this.viewMode.set('effective');
        this.tab.set('card');
        this.applyVersion(detail);
      },
      error: (error) => this.store.error.set(error?.error?.message ?? 'Verziu sa nepodarilo načítať.')
    });
  }

  private applyVersion(detail: ProcessDetail): void {
    this.detail.set(detail);
    // #31 — verzia dokumentu, ktorú publikovaná verzia procesu má (a či platí novšia)
    this.documents.set((detail.documents ?? []).map((document) => ({
      id: document.id, name: document.name, type: '', owner: '', version: document.version, newerVersion: document.newerVersion ?? null
    })));
  }

  // --- #31 verzie riadených dokumentov ---

  readonly documentVersions = signal<Record<string, DocumentVersions>>({});
  versionsOpenFor: string | null = null;
  versionFormFor: string | null = null;
  versionFile: File | null = null;
  versionModel = { effectiveFrom: '', note: '' };

  toggleDocumentVersions(document: Attachment): void {
    if (this.versionsOpenFor === document.id) {
      this.versionsOpenFor = null;
      return;
    }
    this.versionsOpenFor = document.id;
    this.documentsApi.versions(document.id).subscribe({
      next: (info) => this.documentVersions.update((all) => ({ ...all, [document.id]: info })),
      error: (error) => this.store.error.set(error?.error?.message ?? 'Verzie dokumentu sa nepodarilo načítať.')
    });
  }

  openVersionForm(document: Attachment): void {
    this.versionFormFor = document.id;
    this.versionFile = null;
    this.versionModel = { effectiveFrom: this.todayLocal(), note: '' };
  }

  pickVersionFile(event: Event): void {
    this.versionFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  uploadDocumentVersion(document: Attachment): void {
    const detail = this.detail();
    const file = this.versionFile;
    if (!detail || !file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      this.store.error.set(`Súbor „${file.name}" má ${formatBytes(file.size)} a prekračuje limit ${MAX_UPLOAD_LABEL}.`);
      return;
    }
    this.uploading.set(true);
    this.documentsApi.uploadVersion(document.id, file, this.versionModel.effectiveFrom || undefined, this.versionModel.note).subscribe({
      next: (created) => {
        this.uploading.set(false);
        this.versionFormFor = null;
        this.versionsOpenFor = null;
        this.deployState.set(created.effectiveFrom && created.effectiveFrom > this.todayLocal()
          ? `Verzia v${created.version} dokumentu začne platiť ${created.effectiveFrom}.`
          : `Nahraná verzia v${created.version}. Publikované verzie procesu ostávajú pri doterajšej verzii — prevezmete ju publikovaním.`);
        this.openDetail(detail.id);
      },
      error: (error) => {
        this.uploading.set(false);
        this.store.error.set(error?.error?.message ?? 'Novú verziu sa nepodarilo nahrať.');
      }
    });
  }

  versionStateLabel(state: 'current' | 'scheduled' | 'superseded'): string {
    return { current: 'platí', scheduled: 'naplánovaná', superseded: 'nahradená' }[state];
  }

  usedInLabel(item: { usedIn: Array<{ revision: number; processName: string }> }): string {
    return item.usedIn.map((use) => `${use.processName} v${use.revision}`).join(', ');
  }

  openPublish(mode: 'publish' | 'approval' = 'publish'): void {
    this.publishError.set('');
    this.publishMode = mode;
    this.publishModel = { effectiveFrom: this.todayLocal(), changeReason: '', nextReviewAt: '' };
    this.publishOpen = true;
  }

  submitPublish(): void {
    const detail = this.detail();
    if (!detail) return;
    const payload = {
      effectiveFrom: this.publishModel.effectiveFrom,
      changeReason: this.publishModel.changeReason.trim() || undefined,
      nextReviewAt: this.publishModel.nextReviewAt || undefined
    };
    const done = (message: string) => {
      this.publishOpen = false;
      this.deployState.set(message);
      this.store.loadFromDatabase();
      this.openDetail(detail.id, 'draft');
    };
    if (this.publishMode === 'approval') {
      this.store.submitForApproval(detail.id, payload).subscribe({
        next: () => done('Návrh je odoslaný na schválenie. Verzia vznikne, keď ho schvaľovateľ schváli.'),
        error: (error) => this.publishError.set(error?.error?.message ?? 'Návrh sa nepodarilo odoslať na schválenie.')
      });
      return;
    }
    this.store.publish(detail.id, payload).subscribe({
      next: (version) => done(`Publikovaná verzia v${version.revision}, účinná od ${version.effectiveFrom}.`),
      error: (error) => this.publishError.set(error?.error?.message ?? 'Proces sa nepodarilo publikovať.')
    });
  }

  // --- #37 schvaľovanie ---

  readonly approvals = signal<ApprovalRequestInfo[]>([]);
  readonly decisionError = signal('');
  publishMode: 'publish' | 'approval' = 'publish';
  decisionComment = '';

  get currentUserId(): string | undefined {
    return this.auth.currentUser()?.id;
  }

  /** Firma zverejňuje verzie len schválením — priame publikovanie sa neponúka. */
  /** #40 — profil „Kvalita a audit“ je zapnutý pre firmu */
  get qualityProfile(): boolean {
    return Boolean(this.auth.currentOrganization()?.qualityProfile);
  }

  get requireApproval(): boolean {
    return Boolean(this.auth.currentOrganization()?.requireApproval);
  }

  /** Rozhodnúť smie schvaľovateľ, nie ten, kto zmenu navrhol (oddelenie povinností). */
  canDecide(request: { requestedById: string | null; status?: string } | null | undefined): boolean {
    return Boolean(request && (request.status ?? 'pending') === 'pending' && this.auth.can('approval:approve')
      && request.requestedById !== this.auth.currentUser()?.id);
  }

  /** Stiahnuť smie žiadateľ, alebo vlastník či administrátor firmy — ako na serveri. */
  canWithdraw(request: { requestedById: string | null; status?: string } | null | undefined): boolean {
    const user = this.auth.currentUser();
    if (!request || !user || !this.canWrite || (request.status ?? 'pending') !== 'pending') return false;
    return request.requestedById === user.id || user.roleId === 'owner' || user.roleId === 'admin';
  }

  /** Účinnosť, ktorá medzičasom prešla, začne dňom schválenia — nie spätne. */
  approvalEffective(request: ApprovalRequestInfo): string {
    const today = this.todayLocal();
    return request.effectiveFrom && request.effectiveFrom > today ? request.effectiveFrom : today;
  }

  approvalStatusLabel(status: ApprovalRequestInfo['status']): string {
    return { pending: 'čaká na schválenie', approved: 'schválená', rejected: 'zamietnutá', withdrawn: 'stiahnutá' }[status];
  }

  /** Obsah zmrazený pri odoslaní — o tom schvaľovateľ rozhoduje, nie o neskorších úpravách. */
  openApproval(requestId: string): void {
    this.store.approvalView(requestId).subscribe({
      next: (detail) => {
        this.viewMode.set('approval');
        this.tab.set('card');
        this.editSection.set(null);
        this.publishOpen = false;
        this.decisionComment = '';
        this.decisionError.set('');
        this.applyVersion(detail);
      },
      error: (error) => this.store.error.set(error?.error?.message ?? 'Návrh na schválenie sa nepodarilo načítať.')
    });
  }

  decide(decision: 'approve' | 'reject' | 'withdraw', requestId: string): void {
    const id = this.detail()?.id;
    if (!id) return;
    const comment = this.decisionComment.trim();
    if (decision === 'reject' && !comment) {
      this.decisionError.set('Uveďte dôvod zamietnutia — autor podľa neho návrh upraví.');
      return;
    }
    if (decision === 'withdraw' && !window.confirm('Stiahnuť žiadosť o schválenie? Návrh ostane rozpracovaný.')) return;
    this.decisionError.set('');
    this.store.decideApproval(requestId, decision, comment || undefined).subscribe({
      next: () => {
        this.deployState.set({
          approve: 'Návrh je schválený — vznikla nová verzia procesu.',
          reject: 'Návrh je zamietnutý. Autor vidí dôvod v histórii procesu.',
          withdraw: 'Žiadosť o schválenie je stiahnutá.'
        }[decision]);
        this.clearApprovalParam();
        this.store.loadFromDatabase();
        this.openDetail(id, 'draft');
      },
      error: (error) => {
        const message = error?.error?.message ?? 'Rozhodnutie sa nepodarilo uložiť.';
        if (decision === 'withdraw') this.store.error.set(message);
        else this.decisionError.set(message);
      }
    });
  }

  /** Po rozhodnutí alebo návrate na návrh už URL nemá ukazovať na žiadosť. */
  private clearApprovalParam(): void {
    if (this.route.snapshot.queryParamMap.has('approval')) {
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  /** B7 — co smie prihlaseny menit; server to kontroluje aj tak. */
  get canWrite(): boolean {
    return this.auth.can('process:write');
  }

  get canIso(): boolean {
    return this.auth.can('process:write') || this.auth.can('iso:write');
  }

  saveDetail(): void {
    const detail = this.detail();
    if (!detail) return;
    const done = () => {
      this.changeDescription = '';
      this.editSection.set(null);
      this.openDetail(detail.id);
    };
    // ISO auditor smie menit len ISO vazby — posielame len tie, inak by server odmietol celu zmenu
    if (!this.canWrite) {
      this.store.updateProcess(detail.id, { iso: detail.iso ?? [], changeDescription: this.changeDescription }, done);
      return;
    }
    this.store.updateProcess(detail.id, {
      name: detail.name,
      code: detail.code ?? '',
      purpose: detail.purpose,
      trigger: detail.trigger ?? '',
      outcome: detail.outcome ?? '',
      descriptionText: detail.descriptionText,
      // stav sa neposiela — počíta ho server z publikovaných verzií (#27)
      parentId: detail.parentId ?? null,
      relatedProcessIds: detail.relatedProcessIds ?? [],
      positionIds: detail.positionIds ?? [],
      ownerPositionId: this.ownerPositionDraft || null,
      iso: detail.iso ?? [],
      changeDescription: this.changeDescription
    }, done, (message) => this.saveError.set(message));
  }

  /** Chyba ukladania pri otvorenej sekcii (napr. #30 obsadený kód) — formulár ostáva otvorený. */
  readonly saveError = signal('');

  saveBpmn(xml: string): void {
    const process = this.active();
    if (process) this.store.updateProcess(process.id, { bpmnXml: xml });
  }

  saveFlowchart(xml: string): void {
    const process = this.active();
    if (!process) return;
    this.detail.update((current) => current ? { ...current, flowchartXml: xml } : current);
    this.store.updateProcess(process.id, { flowchartXml: xml });
  }

  saveDiagramType(type: 'NONE' | 'BPMN' | 'FLOWCHART'): void {
    const detail = this.detail();
    if (!detail) return;
    this.detail.update((current) => current ? { ...current, diagramType: type } : current);
    this.store.updateProcess(detail.id, { diagramType: type });
  }

  saveRevision(): void {
    const detail = this.detail();
    if (!detail) return;
    const name = window.prompt('Nazov verzie', `Verzia ${new Date().toISOString().slice(0, 10)}`);
    if (name) {
      this.store.saveRevision(detail.id, name);
      setTimeout(() => this.openDetail(detail.id), 600);
    }
  }

  deployToCamunda(): void {
    const process = this.active();
    if (!process?.bpmnXml) return;
    this.deployState.set('Deploy prebieha...');
    this.camunda.deploy(process.id, process.name, process.bpmnXml).subscribe({
      next: () => this.deployState.set('Proces bol nasadeny do Camunda 7.'),
      error: (error) => this.deployState.set(error?.error?.message ?? 'Deploy do Camunda 7 zlyhal.')
    });
  }

  // --- R5: ISO sugescie ---

  detectIso(): void {
    const detail = this.detail();
    if (!detail) return;
    this.store.isoDetect(detail.id).subscribe({
      next: (suggestions) => this.detail.update((current) => current ? { ...current, isoSuggestions: suggestions } : current)
    });
  }

  acceptSuggestion(suggestion: IsoSuggestion): void {
    const detail = this.detail();
    if (!detail) return;
    const iso = detail.iso ?? [];
    if (iso.some((link) => link.standard === suggestion.normName && link.clause === suggestion.clause)) return;
    detail.iso = [...iso, { standard: suggestion.normName, clause: suggestion.clause, evidence: '' }];
    this.saveDetail();
  }

  removeIsoLink(index: number): void {
    const detail = this.detail();
    if (!detail) return;
    detail.iso = (detail.iso ?? []).filter((_, i) => i !== index);
  }

  // --- R6: ISO rezim stromu ---

  toggleTreeMode(): void {
    this.treeMode.set(this.treeMode() === 'iso' ? 'standard' : 'iso');
  }

  // --- dokumenty ---

  readonly maxUploadLabel = MAX_UPLOAD_LABEL;

  uploadDocument(event: Event): void {
    const detail = this.detail();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !detail) return;

    // kontrola pred odoslanim — velky subor by sa zbytocne posielal
    if (file.size > MAX_UPLOAD_BYTES) {
      this.store.error.set(
        `Súbor „${file.name}" má ${formatBytes(file.size)} a prekračuje limit ${MAX_UPLOAD_LABEL}. Nahrajte menší súbor.`
      );
      input.value = '';
      return;
    }

    this.store.error.set('');
    this.uploading.set(true);

    // #9 — kapacitu overime skor, nez sa subor posle; server ju kontroluje aj tak
    this.documentsApi.storage().subscribe({
      next: (usage) => {
        const free = Math.max(0, usage.quotaBytes - usage.usedBytes);
        if (file.size > free) {
          this.store.error.set(
            `Nedostatok miesta v úložisku: voľných ${formatBytes(free)} z ${formatBytes(usage.quotaBytes)}, súbor má ${formatBytes(file.size)}.`
          );
          this.uploading.set(false);
          input.value = '';
          return;
        }
        this.sendFile(detail.id, file, input);
      },
      error: () => this.sendFile(detail.id, file, input)
    });
  }

  private sendFile(processId: string, file: File, input: HTMLInputElement): void {
    input.value = '';
    this.documentsApi.upload(processId, file).subscribe({
      next: (document) => {
        this.documents.update((items) => [document, ...items]);
        this.uploading.set(false);
      },
      error: (error) => {
        this.store.error.set(error?.error?.message ?? 'Dokument sa nepodarilo nahrat.');
        this.uploading.set(false);
      }
    });
  }

  // --- nahlad PDF ---

  canPreview(document: Attachment): boolean {
    return isPreviewable(document.type);
  }

  openPreview(document: Attachment): void {
    this.previewDocument.set(document);
  }

  documentUrl(document: Attachment): string {
    return this.documentsApi.downloadUrl(document.id);
  }

  /** href zostava kvoli pristupnosti, subor sa vsak taha s tokenom cez API. */
  downloadDocument(document: Attachment, event: Event): void {
    event.preventDefault();
    this.documentsApi.download(document.id, document.name).subscribe({
      error: () => this.store.error.set(`Dokument ${document.name} sa nepodarilo stiahnut.`)
    });
  }

  formatSize(bytes?: number): string {
    return formatBytes(bytes);
  }

  startDocumentEdit(document: Attachment): void {
    this.editingDocumentId = document.id;
    this.documentNameDraft = document.name;
  }

  cancelDocumentEdit(): void {
    this.editingDocumentId = null;
    this.documentNameDraft = '';
  }

  saveDocumentName(document: Attachment): void {
    const name = this.documentNameDraft.trim();
    if (!name || name === document.name) {
      this.cancelDocumentEdit();
      return;
    }
    this.documentsApi.update(document.id, { name }).subscribe({
      next: (updated) => {
        this.documents.update((items) => items.map((item) => item.id === updated.id ? updated : item));
        this.cancelDocumentEdit();
      },
      error: (error) => this.store.error.set(error?.error?.message ?? 'Dokument sa nepodarilo premenovat.')
    });
  }

  availableDocumentPositions(document: Attachment): OrgPosition[] {
    const assigned = new Set(document.positionIds ?? []);
    return this.positions().filter((position) => !assigned.has(position.id));
  }

  addDocumentPosition(document: Attachment, positionId: string): void {
    if (!positionId) return;
    const next = [...new Set([...(document.positionIds ?? []), positionId])];
    this.persistDocumentPositions(document, next);
  }

  toggleDocumentPosition(document: Attachment, positionId: string): void {
    const current = document.positionIds ?? [];
    const next = current.includes(positionId)
      ? current.filter((id) => id !== positionId)
      : [...current, positionId];
    this.persistDocumentPositions(document, next);
  }

  private persistDocumentPositions(document: Attachment, positionIds: string[]): void {
    this.documentsApi.update(document.id, { positionIds }).subscribe({
      next: (updated) => this.documents.update((items) => items.map((item) => item.id === updated.id ? updated : item)),
      error: (error) => this.store.error.set(error?.error?.message ?? 'Priradenie pozicie sa nepodarilo ulozit.')
    });
  }

  deleteDocument(document: Attachment): void {
    if (!window.confirm(`Vymazat dokument ${document.name}?`)) return;
    this.documentsApi.delete(document.id).subscribe({
      next: () => this.documents.update((items) => items.filter((item) => item.id !== document.id)),
      error: (error) => this.store.error.set(error?.error?.message ?? 'Dokument sa nepodarilo vymazat.')
    });
  }

  private readonly fieldLabels: Record<string, string> = {
    name: 'názov', code: 'kód', purpose: 'účel', descriptionText: 'popis', trigger: 'spúšťač', outcome: 'výsledok',
    parentId: 'nadradený proces', relatedProcessIds: 'súvisiace procesy', isoLinks: 'ISO väzby',
    bpmnXml: 'diagram', diagramType: 'typ diagramu', flowchartXml: 'flowchart',
    positions: 'vykonávatelia', ownerPosition: 'vlastník', kroky: 'kroky',
    zodpovednostiKrokov: 'zodpovednosti pri krokoch (RACI)', publikovanie: 'publikovanie', schvalovanie: 'schvaľovanie',
    systemy: 'IT systémy', systemyKrokov: 'IT systémy pri krokoch'
  };

  changedFieldNames(change: ProcessChange): string {
    return Object.keys(change.changedFields ?? {}).map((key) => this.fieldLabels[key] ?? key).join(', ');
  }

  private loadDocuments(processId: string): void {
    this.documentsApi.listForProcess(processId).subscribe({
      next: (documents) => this.documents.set(documents),
      error: () => this.documents.set([])
    });
  }

  // --- stavba stromu (R2: len procesy; nadradenost cez najblizsi proces-predok) ---

  private parentProcessId(node: ProcessNode, byId: Map<string, ProcessNode>): string | null {
    let parentId = node.parentId ?? null;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) return null;
      if (parent.type === 'process') return parent.id;
      parentId = parent.parentId ?? null;
    }
    return null;
  }

  private buildProcessRows(): TreeRow[] {
    const all = this.store.flatten();
    const byId = new Map(all.map((node) => [node.id, node]));
    const processes = all.filter((node) => node.type === 'process');
    const childrenOf = new Map<string | null, ProcessNode[]>();
    for (const process of processes) {
      const parent = this.parentProcessId(process, byId);
      const list = childrenOf.get(parent) ?? [];
      list.push(process);
      childrenOf.set(parent, list);
    }
    const rows: TreeRow[] = [];
    const walk = (parent: string | null, level: number) => {
      for (const process of childrenOf.get(parent) ?? []) {
        rows.push({ node: process, level, kind: 'process' });
        if (!this.collapsedIds().has(process.id)) walk(process.id, level + 1);
      }
    };
    walk(null, 0);
    return rows;
  }

  hasChildren(node: ProcessNode): boolean {
    const all = this.store.flatten();
    const byId = new Map(all.map((item) => [item.id, item]));
    return all.some((item) => item.type === 'process' && this.parentProcessId(item, byId) === node.id);
  }

  isDescendantOf(candidateId: string, ancestorId: string): boolean {
    const all = this.store.flatten();
    const byId = new Map(all.map((node) => [node.id, node]));
    let current = byId.get(candidateId)?.parentId ?? null;
    while (current) {
      if (current === ancestorId) return true;
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  }

  // R6: strom podla ISO struktury
  private buildIsoRows(): TreeRow[] {
    const rows: TreeRow[] = [];
    for (const norm of this.norms()) {
      rows.push({ node: { id: `norm-${norm.id}`, name: `${norm.name} ${norm.version}`.trim(), type: 'folder' }, level: 0, kind: 'norm' });
      const walkClauses = (clauses: IsoNorm['structure'], level: number) => {
        for (const clause of clauses ?? []) {
          rows.push({
            node: { id: `clause-${norm.id}-${clause.clause}`, name: `${clause.clause} ${clause.title}`, type: 'folder' },
            level,
            kind: 'clause'
          });
          for (const process of this.processes()) {
            if ((process.iso ?? []).some((link) => link.standard === norm.name && link.clause === clause.clause)) {
              rows.push({ node: process, level: level + 1, kind: 'process' });
            }
          }
          walkClauses(clause.children ?? [], level + 1);
        }
      };
      walkClauses(norm.structure, 1);
    }
    return rows;
  }
}
