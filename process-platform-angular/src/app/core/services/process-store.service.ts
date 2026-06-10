import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { ProcessNode } from '../models/process.model';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class ProcessStoreService {
  private readonly key = 'ngProcessTree';
  readonly tree = signal<ProcessNode[]>(this.storage.read<ProcessNode[]>(this.key, []));
  readonly activeProcessId = signal<string | null>(this.storage.readString('ngActiveProcessId', '') || null);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor(
    private readonly storage: StorageService,
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  activeProcess(): ProcessNode | null {
    return this.flatten(this.tree()).find((node) => node.id === this.activeProcessId() && node.type === 'process') ?? null;
  }

  flatten(nodes = this.tree()): ProcessNode[] {
    return nodes.flatMap((node) => [node, ...this.flatten(node.children ?? [])]);
  }

  loadFromDatabase(): void {
    const organizationId = this.auth.currentOrganizationId();
    if (!organizationId) return;
    this.loading.set(true);
    this.error.set(null);
    this.http.get<ProcessNode[]>(`${API_BASE_URL}/organizations/${organizationId}/processes`).subscribe({
      next: (tree) => {
        this.tree.set(tree);
        this.persist();
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.message ?? 'Procesy sa nepodarilo nacitat z databazy.');
        this.loading.set(false);
      }
    });
  }

  createProcess(): void {
    this.createNode('process', 'Novy proces');
  }

  createFolder(): void {
    this.createNode('folder', 'Nova skupina');
  }

  updateProcess(id: string, patch: Partial<ProcessNode>): void {
    this.tree.set(this.walk(this.tree(), (node) => node.id === id ? { ...node, ...patch } : node));
    this.persist();
    this.http.patch<ProcessNode>(`${API_BASE_URL}/processes/${id}`, patch).subscribe({
      next: (updated) => {
        this.tree.set(this.walk(this.tree(), (node) => node.id === id ? { ...node, ...updated } : node));
        this.persist();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Proces sa nepodarilo ulozit do databazy.')
    });
  }

  renameNode(id: string, name: string): void {
    this.updateProcess(id, { name });
  }

  deleteNode(id: string): void {
    this.tree.set(this.removeFromTree(this.tree(), id));
    if (this.activeProcessId() === id) this.setActive(null);
    this.persist();
    this.http.delete<void>(`${API_BASE_URL}/processes/${id}`).subscribe({
      error: (error) => {
        this.error.set(error?.error?.message ?? 'Polozku sa nepodarilo vymazat.');
        this.loadFromDatabase();
      }
    });
  }

  saveRevision(id: string, name: string): void {
    const process = this.flatten().find((node) => node.id === id);
    if (!process?.bpmnXml) return;
    this.http.post<NonNullable<ProcessNode['revisions']>[number]>(`${API_BASE_URL}/processes/${id}/revisions`, {
      name,
      bpmnXml: process.bpmnXml,
      diagramSvg: process.diagramSvg
    }).subscribe({
      next: (revision) => {
        this.updateProcess(id, { revisions: [revision, ...(process.revisions ?? [])] });
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Revizia sa nepodarila ulozit.')
    });
  }

  setActive(id: string | null): void {
    this.activeProcessId.set(id);
    this.storage.writeString('ngActiveProcessId', id ?? '');
  }

  private walk(nodes: ProcessNode[], mapper: (node: ProcessNode) => ProcessNode): ProcessNode[] {
    return nodes.map((node) => {
      const mapped = mapper(node);
      return mapped.children ? { ...mapped, children: this.walk(mapped.children, mapper) } : mapped;
    });
  }

  private removeFromTree(nodes: ProcessNode[], id: string): ProcessNode[] {
    return nodes
      .filter((node) => node.id !== id)
      .map((node) => node.children ? { ...node, children: this.removeFromTree(node.children, id) } : node);
  }

  private persist(): void {
    this.storage.write(this.key, this.tree());
  }

  private createNode(type: 'folder' | 'process', name: string): void {
    const organizationId = this.auth.currentOrganizationId();
    if (!organizationId) return;
    this.http.post<ProcessNode>(`${API_BASE_URL}/organizations/${organizationId}/processes`, { type, name }).subscribe({
      next: (node) => {
        this.tree.set([...this.tree(), node]);
        if (node.type === 'process') this.setActive(node.id);
        this.persist();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Proces sa nepodarilo vytvorit.')
    });
  }

  private emptyBpmnXml(id: string, name: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_${id}" targetNamespace="https://processbase.local/bpmn">
  <bpmn:process id="Process_${id}" name="${name}" isExecutable="true" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_${id}">
    <bpmndi:BPMNPlane id="BPMNPlane_${id}" bpmnElement="Process_${id}" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
  }
}
