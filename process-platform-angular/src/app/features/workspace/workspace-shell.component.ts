import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
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
  constructor(
    readonly auth: AuthService,
    readonly i18n: TranslationService
  ) {}

  setLanguage(value: string): void {
    this.i18n.setLanguage(value as LanguageCode);
  }
}
