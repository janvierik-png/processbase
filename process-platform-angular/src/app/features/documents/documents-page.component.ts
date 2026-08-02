import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Attachment } from '../../core/models/process.model';
import { DocumentService } from '../../core/services/document.service';

@Component({
  selector: 'pp-documents-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './documents-page.component.html',
  styleUrl: './documents-page.component.scss'
})
export class DocumentsPageComponent implements OnInit {
  readonly documents = signal<Attachment[]>([]);
  readonly error = signal('');

  editingId: string | null = null;
  nameDraft = '';

  constructor(private readonly documentsApi: DocumentService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.documentsApi.listAll().subscribe({
      next: (documents) => this.documents.set(documents),
      error: (error) => this.error.set(error?.error?.message ?? 'Dokumenty sa nepodarilo nacitat.')
    });
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
