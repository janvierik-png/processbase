import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LanguageCode } from '../../core/models/translation.model';
import { TranslationService } from '../../core/services/translation.service';

@Component({
  selector: 'pp-translation-backoffice',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './translation-backoffice.component.html',
  styleUrl: './translation-backoffice.component.scss'
})
export class TranslationBackofficeComponent {
  section: 'translations' | 'integrations' | 'setup' = 'translations';
  model = {
    language: 'sk' as LanguageCode,
    key: '',
    value: ''
  };

  constructor(readonly i18n: TranslationService) {}

  rows(): [string, string][] {
    return Object.entries(this.i18n.translations()[this.model.language] ?? {});
  }

  edit(key: string, value: string): void {
    this.model.key = key;
    this.model.value = value;
  }

  save(): void {
    this.i18n.saveTranslation(this.model.language, this.model.key, this.model.value);
    this.model.key = '';
    this.model.value = '';
  }
}
