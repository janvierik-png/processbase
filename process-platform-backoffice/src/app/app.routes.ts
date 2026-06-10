import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/shell/backoffice-shell.component').then((m) => m.BackofficeShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard-page.component').then((m) => m.DashboardPageComponent)
      },
      {
        path: 'organizations',
        loadComponent: () => import('./features/organizations/organizations-page.component').then((m) => m.OrganizationsPageComponent)
      },
      {
        path: 'translations',
        loadComponent: () => import('./features/translations/translations-page.component').then((m) => m.TranslationsPageComponent)
      },
      {
        path: 'integrations',
        loadComponent: () => import('./features/integrations/integrations-page.component').then((m) => m.IntegrationsPageComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
