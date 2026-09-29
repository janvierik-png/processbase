import { HttpClient } from '@angular/common/http';
import { Injectable, effect, signal, untracked } from '@angular/core';
import { Observable } from 'rxjs';
import {
  IsoNorm,
  IsoSuggestion,
  ProcessChange,
  ProcessDetail,
  ProcessNode,
  ProcessVersionMeta
} from '../models/process.model';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

export type ProcessPatch = Partial<ProcessNode> & {
  positionIds?: string[];
  /** #15 — miesto vlastnika; null = bez vlastnika podla miesta */
  ownerPositionId?: string | null;
  changeDescription?: string;
};

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
  ) {
    // odhlasenie alebo ina firma: strom v pamati patri predchadzajucej relacii
    let organizationId = this.auth.currentOrganizationId();
    effect(() => {
      const next = this.auth.currentOrganizationSignal()?.id ?? null;
      if (next === organizationId) return;
      organizationId = next;
      untracked(() => {
        this.tree.set([]);
        this.activeProcessId.set(null);
      });
    });
  }

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

  detail(id: string): Observable<ProcessDetail> {
    return this.http.get<ProcessDetail>(`${API_BASE_URL}/processes/${id}`);
  }

  // --- #27 verzie procesu ---

  /** Verzia účinná v daný deň (predvolene dnes) namiesto rozpracovaného návrhu. */
  effectiveDetail(id: string, at?: string): Observable<ProcessDetail> {
    const query = at ? `&at=${encodeURIComponent(at)}` : '';
    return this.http.get<ProcessDetail>(`${API_BASE_URL}/processes/${id}?view=effective${query}`);
  }

  versions(id: string): Observable<ProcessVersionMeta[]> {
    return this.http.get<ProcessVersionMeta[]>(`${API_BASE_URL}/processes/${id}/versions`);
  }

  versionDetail(id: string, revision: number): Observable<ProcessDetail> {
    return this.http.get<ProcessDetail>(`${API_BASE_URL}/processes/${id}/versions/${revision}`);
  }

  /** #39 — diagram z bezplatného modelera ako návrh procesu (pôvodné XML sa uloží bez zmeny). */
  importBpmn(payload: {
    bpmnXml: string;
    name: string;
    purpose: string;
    ownerPositionId?: string;
    newPositionName?: string;
    sourceFileName?: string;
  }): Observable<ProcessNode> {
    return this.http.post<ProcessNode>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/processes/import-bpmn`, payload);
  }

  /** #28 — celý zoradený zoznam krokov návrhu (existujúce kroky podľa id sa zachovajú). */
  saveActivities(id: string, activities: Array<{ id?: string; title: string; description?: string }>): Observable<ProcessNode> {
    return this.http.put<ProcessNode>(`${API_BASE_URL}/processes/${id}/activities`, { activities });
  }

  publish(id: string, payload: { effectiveFrom: string; changeReason?: string; nextReviewAt?: string }): Observable<ProcessVersionMeta> {
    return this.http.post<ProcessVersionMeta>(`${API_BASE_URL}/processes/${id}/publish`, payload);
  }

  history(id: string): Observable<ProcessChange[]> {
    return this.http.get<ProcessChange[]>(`${API_BASE_URL}/processes/${id}/history`);
  }

  isoDetect(id: string): Observable<IsoSuggestion[]> {
    return this.http.post<IsoSuggestion[]>(`${API_BASE_URL}/processes/${id}/iso-detect`, {});
  }

  isoNorms(): Observable<IsoNorm[]> {
    return this.http.get<IsoNorm[]>(`${API_BASE_URL}/iso-norms`);
  }

  createProcess(): void {
    this.createNode('process', 'Novy proces');
  }

  createFolder(): void {
    this.createNode('folder', 'Nova skupina');
  }

  updateProcess(id: string, patch: ProcessPatch, onDone?: (updated: ProcessNode) => void): void {
    const { positionIds, ownerPositionId, changeDescription, ...nodePatch } = patch;
    this.tree.set(this.walk(this.tree(), (node) => node.id === id ? { ...node, ...nodePatch } : node));
    this.persist();
    this.http.patch<ProcessNode>(`${API_BASE_URL}/processes/${id}`, patch).subscribe({
      next: (updated) => {
        this.tree.set(this.walk(this.tree(), (node) => node.id === id ? { ...node, ...updated } : node));
        this.persist();
        // presun v strome (zmena parentId) vyzaduje rebuild celej struktury
        if (patch.parentId !== undefined) this.loadFromDatabase();
        onDone?.(updated);
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
}
