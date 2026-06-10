import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { DEFAULT_TRANSLATIONS } from '../data/default-data';
import { LanguageCode, TranslationDictionary } from '../models/translation.model';
import { StorageService } from './storage.service';
import { API_BASE_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  readonly language = signal<LanguageCode>((this.storage.readString('ngLanguage', 'sk') as LanguageCode) || 'sk');
  readonly translations = signal<TranslationDictionary>(this.storage.read<TranslationDictionary>('ngTranslations', DEFAULT_TRANSLATIONS));

  constructor(
    private readonly storage: StorageService,
    private readonly http: HttpClient
  ) {
    this.loadFromDatabase();
  }

  // Globalne preklady spravuje backoffice (port 4300); platforma ich cita z DB.
  // Pri nedostupnom API ostava localStorage cache / DEFAULT_TRANSLATIONS.
  loadFromDatabase(): void {
    this.http.get<Partial<Record<LanguageCode, Record<string, string>>>>(`${API_BASE_URL}/translations`).subscribe({
      next: (dictionary) => {
        this.translations.update((current) => ({
          sk: { ...DEFAULT_TRANSLATIONS.sk, ...current.sk, ...(dictionary.sk ?? {}) },
          en: { ...DEFAULT_TRANSLATIONS.en, ...current.en, ...(dictionary.en ?? {}) }
        }));
        this.storage.write('ngTranslations', this.translations());
      },
      error: () => {
        // offline fallback — ponechaj cache
      }
    });
  }

  t(key: string): string {
    return this.translations()[this.language()]?.[key] ?? this.translations().sk[key] ?? key;
  }

  setLanguage(language: LanguageCode): void {
    this.language.set(language);
    this.storage.writeString('ngLanguage', language);
  }

  saveTranslation(language: LanguageCode, key: string, value: string): void {
    this.translations.update((dictionary) => ({
      ...dictionary,
      [language]: {
        ...dictionary[language],
        [key]: value
      }
    }));
    this.storage.write('ngTranslations', this.translations());
    this.http.put(`${API_BASE_URL}/backoffice/translations`, { locale: language, key, value }).subscribe({
      error: () => {
        // preklad ostava aspon lokalne; DB sa dosynchronizuje pri dalsom ulozeni
      }
    });
  }
}
