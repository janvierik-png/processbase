import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/landing/landing-page.component').then((m) => m.LandingPageComponent)
  },
  // #24 FREE-01 — bezplatný BPMN modeler, bez prihlásenia
  {
    path: 'bpmn-modeler',
    loadComponent: () => import('./features/free-modeler/free-modeler-page.component').then((m) => m.FreeModelerPageComponent)
  },
  // #21 — právne texty (bez prihlásenia)
  {
    path: 'podmienky',
    data: { doc: 'terms' },
    loadComponent: () => import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent)
  },
  {
    path: 'ochrana-osobnych-udajov',
    data: { doc: 'privacy' },
    loadComponent: () => import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent)
  },
  {
    path: 'cookies',
    data: { doc: 'cookies' },
    loadComponent: () => import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent)
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
      // #35 UX-01c — globálne vyhľadávanie
      {
        path: 'hladat',
        loadComponent: () => import('./features/search/search-page.component').then((m) => m.SearchPageComponent)
      },
      // #34 UX-01b — čo treba vo firme napraviť
      {
        path: 'prehlad',
        loadComponent: () => import('./features/overview/overview-page.component').then((m) => m.OverviewPageComponent)
      },
      {
        path: 'moja-praca',
        loadComponent: () => import('./features/my-work/my-work-page.component').then((m) => m.MyWorkPageComponent)
      },
      {
        path: 'processes',
        loadComponent: () => import('./features/processes/process-workspace.component').then((m) => m.ProcessWorkspaceComponent)
      },
      {
        path: 'processes/:id',
        loadComponent: () => import('./features/processes/process-workspace.component').then((m) => m.ProcessWorkspaceComponent)
      },
      // #42/#41 — návrh procesu z textu a import dokumentov
      {
        path: 'import',
        loadComponent: () => import('./features/import/import-page.component').then((m) => m.ImportPageComponent)
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
      // #43 — IT systémy a dopad ich zmeny
      {
        path: 'settings/systems',
        loadComponent: () => import('./features/settings/systems-page.component').then((m) => m.SystemsPageComponent)
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
