import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { StorageService } from '../../core/services/storage.service';
import { TranslationService } from '../../core/services/translation.service';
import { LanguageCode } from '../../core/models/translation.model';

@Component({
  selector: 'pp-workspace-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './workspace-shell.component.html',
  styleUrl: './workspace-shell.component.scss'
})
export class WorkspaceShellComponent {
  readonly collapsed = signal(this.storage.readString('ngNavCollapsed', '0') === '1');
  readonly resendState = signal<'idle' | 'sending' | 'sent'>('idle');

  constructor(
    readonly auth: AuthService,
    readonly i18n: TranslationService,
    private readonly storage: StorageService
  ) {}

  setLanguage(value: string): void {
    this.i18n.setLanguage(value as LanguageCode);
  }

  /** #20 — nový overovací odkaz (predchádzajúci tým prestane platiť). */
  resendVerification(): void {
    this.resendState.set('sending');
    this.auth.resendVerification().subscribe({
      next: (result) => {
        if (result.alreadyVerified) this.auth.markEmailVerified();
        this.resendState.set('sent');
      },
      error: () => this.resendState.set('idle')
    });
  }

  toggleCollapse(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    this.storage.writeString('ngNavCollapsed', next ? '1' : '0');
  }

  userInitials(): string {
    const name = this.auth.currentUser()?.name ?? '';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';
  }
}
