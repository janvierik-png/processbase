import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IsoClause, IsoNorm } from '../../core/models/backoffice.model';
import { BackofficeApiService } from '../../core/services/backoffice-api.service';

type FlatClause = { clause: string; title: string; level: number };

@Component({
  selector: 'bo-iso-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './iso-page.component.html',
  styleUrl: './iso-page.component.scss'
})
export class IsoPageComponent implements OnInit {
  readonly norms = signal<IsoNorm[]>([]);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly selected = signal<IsoNorm | null>(null);
  readonly editRows = signal<FlatClause[]>([]);

  model = { name: '', version: '', language: 'sk' };
  private pdfBase64: string | null = null;
  pdfFileName = '';

  constructor(private readonly api: BackofficeApiService) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.isoNorms().subscribe({
      next: (norms) => this.norms.set(norms),
      error: () => this.error.set('ISO normy sa nepodarilo nacitat.')
    });
  }

  onPdfSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.pdfFileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      this.pdfBase64 = result.includes(',') ? result.split(',')[1] : result;
    };
    reader.readAsDataURL(file);
  }

  create(): void {
    if (!this.model.name.trim()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.createIsoNorm({
      name: this.model.name,
      version: this.model.version,
      language: this.model.language,
      pdfBase64: this.pdfBase64 ?? undefined,
      structure: this.pdfBase64 ? undefined : []
    }).subscribe({
      next: (norm) => {
        this.busy.set(false);
        this.model = { name: '', version: '', language: 'sk' };
        this.pdfBase64 = null;
        this.pdfFileName = '';
        this.reload();
        this.select(norm);
      },
      error: (error) => {
        this.busy.set(false);
        this.error.set(error?.error?.message ?? 'Normu sa nepodarilo vytvorit.');
      }
    });
  }

  select(norm: IsoNorm): void {
    this.selected.set(norm);
    this.editRows.set(this.flatten(norm.structure));
  }

  remove(norm: IsoNorm, event: Event): void {
    event.stopPropagation();
    if (!window.confirm(`Vymazat normu ${norm.name}?`)) return;
    this.api.deleteIsoNorm(norm.id).subscribe({
      next: () => {
        if (this.selected()?.id === norm.id) this.selected.set(null);
        this.reload();
      },
      error: () => this.error.set('Normu sa nepodarilo vymazat.')
    });
  }

  addRow(): void {
    this.editRows.update((rows) => [...rows, { clause: '', title: '', level: 1 }]);
  }

  removeRow(index: number): void {
    this.editRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  saveStructure(): void {
    const norm = this.selected();
    if (!norm) return;
    const structure = this.buildTree(this.editRows().filter((row) => row.clause.trim() && row.title.trim()));
    this.busy.set(true);
    this.api.updateIsoNorm(norm.id, { structure }).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.reload();
        this.select(updated);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Strukturu sa nepodarilo ulozit.');
      }
    });
  }

  private flatten(structure: IsoClause[], level = 1): FlatClause[] {
    return (structure ?? []).flatMap((clause) => [
      { clause: clause.clause, title: clause.title, level },
      ...this.flatten(clause.children ?? [], level + 1)
    ]);
  }

  // Plochy zoznam -> hierarchia podla cislovania (4 -> 4.1 -> 4.1.2)
  private buildTree(rows: FlatClause[]): IsoClause[] {
    const sorted = [...rows].sort((a, b) => a.clause.localeCompare(b.clause, undefined, { numeric: true }));
    const roots: IsoClause[] = [];
    const byClause = new Map<string, IsoClause>();
    for (const row of sorted) {
      const node: IsoClause = { clause: row.clause.trim(), title: row.title.trim(), children: [] };
      byClause.set(node.clause, node);
      const parentClause = node.clause.split('.').slice(0, -1).join('.');
      const parent = byClause.get(parentClause);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }
}
