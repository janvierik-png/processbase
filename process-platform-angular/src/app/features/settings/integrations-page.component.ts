import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

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

  constructor(private readonly auth: AuthService) {}

  ngOnInit(): void {
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
