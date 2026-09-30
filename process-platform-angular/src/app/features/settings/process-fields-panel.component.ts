import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProcessFieldDefinition, ProcessFieldType } from '../../core/models/organization.model';
import { ProcessFieldService } from '../../core/services/process-field.service';

type FieldDraft = { label: string; type: ProcessFieldType; options: string; required: boolean; helpText: string };

const emptyDraft = (): FieldDraft => ({ label: '', type: 'text', options: '', required: false, helpText: '' });

export const FIELD_TYPE_LABELS: Record<ProcessFieldType, string> = {
  text: 'Krátky text',
  longText: 'Dlhý text',
  number: 'Číslo',
  date: 'Dátum',
  select: 'Výber z možností',
  checkbox: 'Zaškrtnutie (áno/nie)'
};

/**
 * #45 — vlastné polia procesu: firma si určí, čo chce pri procesoch evidovať
 * (napr. číslo smernice, útvar, stupeň dôvernosti) a či je pole povinné.
 * Povinné pole blokuje publikovanie, nie uloženie rozpracovaného návrhu.
 */
@Component({
  selector: 'pp-process-fields-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './process-fields-panel.component.html',
  styleUrl: './process-fields-panel.component.scss'
})
export class ProcessFieldsPanelComponent implements OnInit {
  readonly fields = signal<ProcessFieldDefinition[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly typeLabels = FIELD_TYPE_LABELS;
  readonly types = Object.keys(FIELD_TYPE_LABELS) as ProcessFieldType[];

  model: FieldDraft = emptyDraft();
  editingId: string | null = null;

  constructor(private readonly api: ProcessFieldService) {}

  ngOnInit(): void {
    this.load();
  }

  active(): ProcessFieldDefinition[] {
    return this.fields().filter((field) => !field.archived);
  }

  archived(): ProcessFieldDefinition[] {
    return this.fields().filter((field) => field.archived);
  }

  private load(): void {
    this.api.list().subscribe({ next: (fields) => this.fields.set(fields), error: () => this.error.set('Polia sa nepodarilo načítať.') });
  }

  private fail(fallback: string) {
    return (error: any) => this.error.set(error?.error?.message ?? fallback);
  }

  startEdit(field: ProcessFieldDefinition): void {
    this.editingId = field.id;
    this.model = { label: field.label, type: field.type, options: field.options.join('\n'), required: field.required, helpText: field.helpText };
    this.error.set('');
  }

  cancel(): void {
    this.editingId = null;
    this.model = emptyDraft();
  }

  save(): void {
    const options = this.model.options.split('\n').map((line) => line.trim()).filter(Boolean);
    const payload = {
      label: this.model.label.trim(),
      options: this.model.type === 'select' ? options : undefined,
      required: this.model.required,
      helpText: this.model.helpText.trim()
    };
    if (!payload.label) {
      this.error.set('Zadajte názov poľa.');
      return;
    }
    this.error.set('');
    const request = this.editingId
      ? this.api.update(this.editingId, payload)
      : this.api.create({ ...payload, type: this.model.type });
    request.subscribe({
      next: (field) => {
        this.notice.set(`Pole „${field.label}“ je uložené.${field.required ? ' Proces bez neho nepôjde publikovať.' : ''}`);
        this.cancel();
        this.load();
      },
      error: this.fail('Pole sa nepodarilo uložiť.')
    });
  }

  toggleRequired(field: ProcessFieldDefinition): void {
    this.api.update(field.id, { required: !field.required }).subscribe({ next: () => this.load(), error: this.fail('Zmena sa nepodarila.') });
  }

  move(index: number, offset: number): void {
    const list = [...this.active()];
    const target = index + offset;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.api.reorder(list.map((field) => field.id)).subscribe({ next: () => this.load(), error: this.fail('Poradie sa nepodarilo uložiť.') });
  }

  remove(field: ProcessFieldDefinition): void {
    const question = field.usage > 0
      ? `Pole „${field.label}“ je vyplnené v ${field.usage} procesoch. Archivovať ho? Hodnoty v procesoch a verziách ostanú.`
      : `Odstrániť pole „${field.label}“?`;
    if (!window.confirm(question)) return;
    this.api.remove(field.id).subscribe({
      next: (result) => {
        this.notice.set(result?.archived ? `Pole „${field.label}“ je archivované — hodnoty ostali.` : `Pole „${field.label}“ je odstránené.`);
        this.load();
      },
      error: this.fail('Pole sa nepodarilo odstrániť.')
    });
  }

  restore(field: ProcessFieldDefinition): void {
    this.api.update(field.id, { archived: false }).subscribe({ next: () => this.load(), error: this.fail('Pole sa nepodarilo obnoviť.') });
  }
}
