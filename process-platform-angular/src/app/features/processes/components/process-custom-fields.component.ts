import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProcessFieldDefinition } from '../../../core/models/organization.model';
import { ProcessDetail } from '../../../core/models/process.model';
import { ProcessStoreService } from '../../../core/services/process-store.service';

type FieldValue = string | number | boolean;

/**
 * #45 — vlastné polia firmy pri procese. Povinné pole je označené
 * hviezdičkou; bez neho sa proces nedá publikovať (zoznam chýbajúcich údajov).
 */
@Component({
  selector: 'pp-process-custom-fields',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './process-custom-fields.component.html',
  styleUrl: './process-quality.component.scss'
})
export class ProcessCustomFieldsComponent {
  @Input({ required: true }) process!: ProcessDetail;
  /** definície polí firmy vrátane archivovaných (kvôli hodnotám v starších verziách) */
  @Input() fields: ProcessFieldDefinition[] = [];
  @Input() readOnly = true;
  @Output() saved = new EventEmitter<void>();

  readonly error = signal('');
  editing = false;
  draft: Record<string, FieldValue | ''> = {};

  /** Aktívne polia a archivované, ktoré majú v procese hodnotu. */
  visibleFields(): ProcessFieldDefinition[] {
    const values = this.process.customFields ?? {};
    return this.fields.filter((field) => !field.archived || values[field.id] !== undefined);
  }

  display(field: ProcessFieldDefinition): string {
    const value = this.process.customFields?.[field.id];
    if (value === undefined || value === '') return '—';
    if (field.type === 'checkbox') return value === true ? 'Áno' : '—';
    if (field.type === 'date') return String(value).split('-').reverse().join('. ');
    return String(value);
  }

  missing(field: ProcessFieldDefinition): boolean {
    const value = this.process.customFields?.[field.id];
    return field.required && !field.archived && (field.type === 'checkbox' ? value !== true : value === undefined || value === '');
  }

  startEdit(): void {
    const values = this.process.customFields ?? {};
    this.draft = Object.fromEntries(this.fields.map((field) => [field.id, values[field.id] ?? (field.type === 'checkbox' ? false : '')]));
    this.error.set('');
    this.editing = true;
  }

  save(): void {
    // posielajú sa aktívne polia a vymazané hodnoty archivovaných (tie sa dajú len vymazať)
    const values = this.process.customFields ?? {};
    const patch: Record<string, FieldValue | null> = {};
    for (const field of this.fields) {
      const value = this.draft[field.id];
      const empty = value === '' || value === undefined || value === null || (field.type === 'checkbox' && value === false);
      if (field.archived) {
        if (empty && values[field.id] !== undefined) patch[field.id] = null;
        continue;
      }
      patch[field.id] = empty ? null : field.type === 'text' || field.type === 'longText' ? String(value).trim() : value;
    }
    this.store.updateProcess(this.process.id, { customFields: patch as any }, () => {
      this.editing = false;
      this.saved.emit();
    }, (message) => this.error.set(message));
  }

  constructor(private readonly store: ProcessStoreService) {}
}
