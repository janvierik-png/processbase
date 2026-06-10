import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/landing/landing-page.component').then((m) => m.LandingPageComponent)
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./features/workspace/workspace-shell.component').then((m) => m.WorkspaceShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'processes' },
      {
        path: 'processes',
        loadComponent: () => import('./features/processes/process-workspace.component').then((m) => m.ProcessWorkspaceComponent)
      },
      {
        path: 'documents',
        loadComponent: () => import('./features/documents/documents-page.component').then((m) => m.DocumentsPageComponent)
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/company-settings.component').then((m) => m.CompanySettingsComponent)
      },
      {
        path: 'backoffice',
        loadComponent: () => import('./features/backoffice/translation-backoffice.component').then((m) => m.TranslationBackofficeComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
