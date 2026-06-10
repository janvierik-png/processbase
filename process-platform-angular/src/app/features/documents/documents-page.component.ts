import { Component, OnInit, signal } from '@angular/core';
import { Attachment } from '../../core/models/process.model';
import { DocumentService } from '../../core/services/document.service';

@Component({
  selector: 'pp-documents-page',
  standalone: true,
  templateUrl: './documents-page.component.html',
  styleUrl: './documents-page.component.scss'
})
export class DocumentsPageComponent implements OnInit {
  readonly documents = signal<Attachment[]>([]);
  readonly error = signal('');

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

  deleteDocument(document: Attachment): void {
    if (!window.confirm(`Vymazat dokument ${document.name}?`)) return;
    this.documentsApi.delete(document.id).subscribe({
      next: () => this.documents.update((items) => items.filter((item) => item.id !== document.id)),
      error: (error) => this.error.set(error?.error?.message ?? 'Dokument sa nepodarilo vymazat.')
    });
  }
}
