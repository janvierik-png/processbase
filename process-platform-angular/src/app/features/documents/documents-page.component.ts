import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Attachment } from '../../core/models/process.model';
import { OrgPosition } from '../../core/models/user.model';
import { DocumentService } from '../../core/services/document.service';
import { PositionService } from '../../core/services/position.service';
import { fileTypeLabel, formatBytes, isPreviewable } from '../../core/utils/upload-limits';
import { PdfPreviewComponent } from '../../shared/pdf-preview.component';

@Component({
  selector: 'pp-documents-page',
  standalone: true,
  imports: [FormsModule, PdfPreviewComponent],
  templateUrl: './documents-page.component.html',
  styleUrl: './documents-page.component.scss'
})
export class DocumentsPageComponent implements OnInit {
  readonly documents = signal<Attachment[]>([]);
  readonly positions = signal<OrgPosition[]>([]);
  readonly error = signal('');

  // filtre
  readonly search = signal('');
  readonly positionFilter = signal('');
  readonly processFilter = signal('');

  editingId: string | null = null;
  nameDraft = '';

  /** Procesy, ku ktorym existuje aspon jeden dokument. */
  readonly processOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const document of this.documents()) {
      if (document.processId && document.processName) seen.set(document.processId, document.processName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    const positionId = this.positionFilter();
    const processId = this.processFilter();

    return this.documents().filter((document) => {
      if (processId && document.processId !== processId) return false;
      if (positionId && !(document.positionIds ?? []).includes(positionId)) return false;
      if (!query) return true;

      // hlada sa v nazve, procese, poziciach aj type suboru
      const haystack = [
        document.name,
        document.processName ?? '',
        document.type ?? '',
        ...(document.positions ?? []).map((position) => position.name)
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  });

  readonly hasActiveFilter = computed(() =>
    !!this.search().trim() || !!this.positionFilter() || !!this.processFilter()
  );

  constructor(
    private readonly documentsApi: DocumentService,
    private readonly positionsApi: PositionService
  ) {}

  ngOnInit(): void {
    this.load();
    this.positionsApi.list().subscribe({
      next: (positions) => this.positions.set(positions),
      error: () => undefined
    });
  }

  load(): void {
    this.documentsApi.listAll().subscribe({
      next: (documents) => this.documents.set(documents),
      error: (error) => this.error.set(error?.error?.message ?? 'Dokumenty sa nepodarilo nacitat.')
    });
  }

  readonly previewDocument = signal<Attachment | null>(null);

  downloadUrl(document: Attachment): string {
    return this.documentsApi.downloadUrl(document.id);
  }

  previewUrl(document: Attachment): string {
    return this.documentsApi.previewUrl(document.id);
  }

  canPreview(document: Attachment): boolean {
    return isPreviewable(document.type);
  }

  openPreview(document: Attachment): void {
    this.previewDocument.set(document);
  }

  clearFilters(): void {
    this.search.set('');
    this.positionFilter.set('');
    this.processFilter.set('');
  }

  positionLabel(position: OrgPosition): string {
    return position.unitName ? `${position.unitName} — ${position.name}` : position.name;
  }

  formatSize(bytes?: number): string {
    return formatBytes(bytes);
  }

  typeLabel(document: Attachment): string {
    return fileTypeLabel(document.name, document.type);
  }

  startEdit(document: Attachment): void {
    this.editingId = document.id;
    this.nameDraft = document.name;
  }

  cancelEdit(): void {
    this.editingId = null;
    this.nameDraft = '';
  }

  saveName(document: Attachment): void {
    const name = this.nameDraft.trim();
    if (!name || name === document.name) {
      this.cancelEdit();
      return;
    }
    this.documentsApi.update(document.id, { name }).subscribe({
      next: (updated) => {
        this.documents.update((items) => items.map((item) => item.id === updated.id ? updated : item));
        this.cancelEdit();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Dokument sa nepodarilo premenovat.')
    });
  }

  deleteDocument(document: Attachment): void {
    if (!window.confirm(`Vymazat dokument ${document.name}?`)) return;
    this.documentsApi.delete(document.id).subscribe({
      next: () => this.documents.update((items) => items.filter((item) => item.id !== document.id)),
      error: (error) => this.error.set(error?.error?.message ?? 'Dokument sa nepodarilo vymazat.')
    });
  }
}
