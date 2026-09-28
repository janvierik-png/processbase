import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';

export const appRoutes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login-page.component').then((m) => m.LoginPageComponent)
  },
  {
    path: '',
    canActivate: [adminGuard],
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
        path: 'iso',
        loadComponent: () => import('./features/iso/iso-page.component').then((m) => m.IsoPageComponent)
      },
      {
        path: 'admins',
        loadComponent: () => import('./features/admins/admins-page.component').then((m) => m.AdminsPageComponent)
      },
      {
        path: 'audit',
        loadComponent: () => import('./features/audit/audit-page.component').then((m) => m.AuditPageComponent)
      },
      {
        path: 'integrations',
        loadComponent: () => import('./features/integrations/integrations-page.component').then((m) => m.IntegrationsPageComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
