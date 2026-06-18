import { Component, OnInit, computed, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BpmnEditorComponent } from './components/bpmn-editor.component';
import { BpmnViewerComponent } from './components/bpmn-viewer.component';
import { FlowchartEditorComponent } from './components/flowchart-editor.component';
import { ProcessStoreService } from '../../core/services/process-store.service';
import { PositionService } from '../../core/services/position.service';
import {
  Attachment,
  IsoNorm,
  IsoSuggestion,
  ProcessChange,
  ProcessDetail,
  ProcessNode,
  ProcessRevision
} from '../../core/models/process.model';
import { OrgPosition } from '../../core/models/user.model';
import { Camunda7Service } from '../../core/services/camunda7.service';
import { DocumentService } from '../../core/services/document.service';
import { StorageService } from '../../core/services/storage.service';

type TreeRow = { node: ProcessNode; level: number; kind: 'process' | 'clause' | 'norm' };
type PanelState = 'wide' | 'narrow' | 'hidden';
type Tab = 'card' | 'bpmn' | 'history';

@Component({
  selector: 'pp-process-workspace',
  standalone: true,
  imports: [FormsModule, DecimalPipe, BpmnEditorComponent, BpmnViewerComponent, FlowchartEditorComponent],
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
    private readonly storage: StorageService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.store.loadFromDatabase();
    this.positionsApi.list().subscribe({ next: (items) => this.positions.set(items), error: () => undefined });
    this.store.isoNorms().subscribe({ next: (norms) => this.norms.set(norms), error: () => undefined });

    // R3: vlastna URL procesu /app/processes/:id
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.store.setActive(id);
        this.openDetail(id);
      }
    });
  }

  // --- R2: strom ---

  select(node: ProcessNode): void {
    this.router.navigate(['/app/processes', node.id]);
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

  openDetail(id: string): void {
    this.tab.set('card');
    this.viewedRevision.set(null);
    this.changeDescription = '';
    this.store.detail(id).subscribe({
      next: (detail) => this.detail.set(detail),
      error: () => this.detail.set(null)
    });
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

  togglePosition(positionId: string): void {
    const detail = this.detail();
    if (!detail) return;
    const current = detail.positionIds ?? [];
    detail.positionIds = current.includes(positionId)
      ? current.filter((id) => id !== positionId)
      : [...current, positionId];
  }

  saveDetail(): void {
    const detail = this.detail();
    if (!detail) return;
    this.store.updateProcess(detail.id, {
      name: detail.name,
      purpose: detail.purpose,
      risks: detail.risks,
      descriptionText: detail.descriptionText,
      status: detail.status,
      parentId: detail.parentId ?? null,
      relatedProcessIds: detail.relatedProcessIds ?? [],
      positionIds: detail.positionIds ?? [],
      iso: detail.iso ?? [],
      changeDescription: this.changeDescription
    }, () => {
      this.changeDescription = '';
      this.openDetail(detail.id);
    });
  }

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

  uploadDocument(event: Event): void {
    const detail = this.detail();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !detail) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.documentsApi.upload(detail.id, file, String(reader.result ?? '')).subscribe({
        next: (document) => this.documents.update((items) => [document, ...items]),
        error: (error) => this.store.error.set(error?.error?.message ?? 'Dokument sa nepodarilo nahrat.')
      });
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  deleteDocument(document: Attachment): void {
    if (!window.confirm(`Vymazat dokument ${document.name}?`)) return;
    this.documentsApi.delete(document.id).subscribe({
      next: () => this.documents.update((items) => items.filter((item) => item.id !== document.id)),
      error: (error) => this.store.error.set(error?.error?.message ?? 'Dokument sa nepodarilo vymazat.')
    });
  }

  changedFieldNames(change: ProcessChange): string {
    return Object.keys(change.changedFields ?? {}).join(', ');
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
