import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DEFAULT_TRANSLATION_ITEMS } from '../../core/data/default-translations';
import { TranslationEntry } from '../../core/models/backoffice.model';
import { BackofficeApiService } from '../../core/services/backoffice-api.service';

@Component({
  selector: 'bo-translations-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './translations-page.component.html',
  styleUrl: './translations-page.component.scss'
})
export class TranslationsPageComponent implements OnInit {
  readonly entries = signal<TranslationEntry[]>([]);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  model = {
    locale: 'sk',
    key: '',
    value: ''
  };

  readonly visibleEntries = computed(() => this.entries().filter((entry) => entry.locale === this.model.locale));

  constructor(private readonly api: BackofficeApiService) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.translations().subscribe({
      next: (entries) => this.entries.set(entries),
      error: () => this.error.set('Preklady sa nepodarilo nacitat.')
    });
  }

  edit(entry: TranslationEntry): void {
    this.model.key = entry.key;
    this.model.value = entry.value;
  }

  save(): void {
    if (!this.model.key || !this.model.value) return;
    this.saving.set(true);
    this.api.saveTranslation(this.model.locale, this.model.key, this.model.value).subscribe({
      next: (saved) => {
        this.entries.update((entries) => {
          const without = entries.filter((entry) => entry.id !== saved.id);
          return [...without, saved].sort((a, b) => a.locale.localeCompare(b.locale) || a.key.localeCompare(b.key));
        });
        this.model.key = '';
        this.model.value = '';
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Preklad sa nepodarilo ulozit.');
        this.saving.set(false);
      }
    });
  }

  remove(entry: TranslationEntry, event: Event): void {
    event.stopPropagation();
    this.api.deleteTranslation(entry.id).subscribe({
      next: () => this.entries.update((entries) => entries.filter((item) => item.id !== entry.id)),
      error: () => this.error.set('Preklad sa nepodarilo vymazat.')
    });
  }

  importDefaults(): void {
    this.saving.set(true);
    this.api.importTranslations(DEFAULT_TRANSLATION_ITEMS).subscribe({
      next: () => {
        this.saving.set(false);
        this.reload();
      },
      error: () => {
        this.error.set('Import predvolenych prekladov zlyhal.');
        this.saving.set(false);
      }
    });
  }
}
