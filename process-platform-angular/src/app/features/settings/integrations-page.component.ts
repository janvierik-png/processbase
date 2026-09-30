import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AiImportService } from '../../core/services/ai-import.service';
import { AiSettings } from '../../core/models/import.model';

@Component({
  selector: 'pp-integrations-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './integrations-page.component.html',
  styleUrl: './integrations-page.component.scss'
})
export class IntegrationsPageComponent implements OnInit {
  readonly saved = signal(false);
  readonly hasApiKey = signal(false);
  readonly error = signal<string | null>(null);

  model = {
    autoTranslate: false,
    provider: 'deepl',
    targetLocale: 'en',
    apiKey: ''
  };

  // --- #42 AI asistent ---
  readonly ai = signal<AiSettings | null>(null);
  readonly aiMessage = signal('');
  aiKey = '';
  aiConsent = false;

  constructor(readonly auth: AuthService, private readonly aiApi: AiImportService) {}

  loadAi(): void {
    this.aiApi.settings().subscribe({ next: (settings) => this.ai.set(settings), error: () => this.ai.set(null) });
  }

  saveAi(patch: { enabled?: boolean; removeKey?: boolean }): void {
    this.aiMessage.set('');
    if (patch.enabled && !this.aiConsent && !this.ai()?.enabled) {
      this.aiMessage.set('Najprv potvrďte, že firma súhlasí so spracovaním obsahu poskytovateľom AI.');
      return;
    }
    this.aiApi.saveSettings({ ...patch, apiKey: this.aiKey.trim() || undefined }).subscribe({
      next: (settings) => {
        this.ai.set(settings);
        this.aiKey = '';
        this.aiMessage.set(settings.enabled ? (settings.available ? 'AI asistent je zapnutý.' : 'AI je zapnutá, ale chýba kľúč poskytovateľa.') : 'AI asistent je vypnutý.');
      },
      error: (error) => this.aiMessage.set(error?.error?.message ?? 'Nastavenie AI sa nepodarilo uložiť.')
    });
  }

  ngOnInit(): void {
    this.loadAi();
    this.auth.translationSettings().subscribe({
      next: (settings) => {
        this.model.autoTranslate = settings.autoTranslate;
        this.model.provider = settings.provider;
        this.model.targetLocale = settings.targetLocale;
        this.hasApiKey.set(settings.hasApiKey);
      },
      error: () => this.error.set('Nastavenia sa nepodarilo nacitat.')
    });
  }

  save(): void {
    this.saved.set(false);
    this.auth.saveTranslationSettings({
      autoTranslate: this.model.autoTranslate,
      provider: this.model.provider,
      targetLocale: this.model.targetLocale,
      apiKey: this.model.apiKey || undefined
    }).subscribe({
      next: (settings) => {
        this.hasApiKey.set(settings.hasApiKey);
        this.model.apiKey = '';
        this.saved.set(true);
        this.error.set(null);
      },
      error: () => this.error.set('Nastavenia sa nepodarilo ulozit.')
    });
  }
}
