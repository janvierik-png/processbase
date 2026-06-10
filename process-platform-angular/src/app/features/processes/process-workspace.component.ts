import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BpmnEditorComponent } from './components/bpmn-editor.component';
import { ProcessStoreService } from '../../core/services/process-store.service';
import { Attachment, ProcessNode } from '../../core/models/process.model';
import { Camunda7Service } from '../../core/services/camunda7.service';
import { DocumentService } from '../../core/services/document.service';

@Component({
  selector: 'pp-process-workspace',
  standalone: true,
  imports: [FormsModule, BpmnEditorComponent],
  templateUrl: './process-workspace.component.html',
  styleUrl: './process-workspace.component.scss'
})
export class ProcessWorkspaceComponent implements OnInit {
  readonly active = computed(() => this.store.activeProcess());
  readonly deployState = signal('');
  readonly detailsOpen = signal(false);
  readonly camundaDetailsOpen = signal(false);
  readonly collapsedIds = signal<Set<string>>(new Set());
  readonly documents = signal<Attachment[]>([]);
  readonly visibleNodes = computed(() => this.flattenVisible(this.store.tree()));

  constructor(
    readonly store: ProcessStoreService,
    private readonly camunda: Camunda7Service,
    private readonly documentsApi: DocumentService
  ) {}

  ngOnInit(): void {
    this.store.loadFromDatabase();
  }

  select(node: ProcessNode): void {
    if (node.type !== 'process') {
      this.toggleCollapse(node);
      return;
    }
    this.store.setActive(node.id);
    this.loadDocuments(node.id);
  }

  saveDetails(process: ProcessNode): void {
    this.store.updateProcess(process.id, process);
  }

  saveBpmn(xml: string): void {
    const process = this.active();
    if (process) this.store.updateProcess(process.id, { bpmnXml: xml });
  }

  saveRevision(process: ProcessNode): void {
    const name = window.prompt('Nazov verzie', `Verzia ${new Date().toISOString().slice(0, 10)}`);
    if (name) this.store.saveRevision(process.id, name);
  }

  deployToCamunda(process: ProcessNode): void {
    if (!process.bpmnXml) return;
    this.deployState.set('Deploy prebieha...');
    this.camunda.deploy(process.id, process.name, process.bpmnXml).subscribe({
      next: () => this.deployState.set('Proces bol nasadeny do Camunda 7.'),
      error: (error) => this.deployState.set(error?.error?.message ?? 'Deploy do Camunda 7 zlyhal.')
    });
  }

  toggleCollapse(node: ProcessNode): void {
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
  }

  uploadDocument(process: ProcessNode, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.documentsApi.upload(process.id, file, String(reader.result ?? '')).subscribe({
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

  private loadDocuments(processId: string): void {
    this.documentsApi.listForProcess(processId).subscribe({
      next: (documents) => this.documents.set(documents),
      error: () => this.documents.set([])
    });
  }

  private flattenVisible(nodes: ProcessNode[], level = 0): Array<ProcessNode & { level: number }> {
    return nodes.flatMap((node) => {
      const current = { ...node, level };
      if (this.collapsedIds().has(node.id)) return [current];
      return [current, ...this.flattenVisible(node.children ?? [], level + 1)];
    });
  }
}
