import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/landing/landing-page.component').then((m) => m.LandingPageComponent)
  },
  // #20 — odkazy z e-mailov (bez prihlásenia)
  {
    path: 'overenie-emailu',
    data: { mode: 'verify' },
    loadComponent: () => import('./features/account/account-flow-page.component').then((m) => m.AccountFlowPageComponent)
  },
  {
    path: 'zabudnute-heslo',
    data: { mode: 'forgot' },
    loadComponent: () => import('./features/account/account-flow-page.component').then((m) => m.AccountFlowPageComponent)
  },
  {
    path: 'obnova-hesla',
    data: { mode: 'reset' },
    loadComponent: () => import('./features/account/account-flow-page.component').then((m) => m.AccountFlowPageComponent)
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
        path: 'processes/:id',
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
        path: 'settings/positions',
        loadComponent: () => import('./features/settings/positions-page.component').then((m) => m.PositionsPageComponent)
      },
      {
        path: 'settings/integrations',
        loadComponent: () => import('./features/settings/integrations-page.component').then((m) => m.IntegrationsPageComponent)
      },
      // R10: backoffice sekcia bola presunuta do samostatnej aplikacie (port 4300)
      { path: 'backoffice', redirectTo: 'processes' }
    ]
  },
  { path: '**', redirectTo: '' }
];
