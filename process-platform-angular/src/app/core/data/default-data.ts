import { Role } from '../models/user.model';
import { TranslationDictionary } from '../models/translation.model';

export const DEFAULT_ROLES: Role[] = [
  { id: 'owner', name: 'Owner firmy', permissions: ['organization:write', 'user:invite', 'process:write', 'export:process'] },
  { id: 'admin', name: 'Administrator', permissions: ['organization:write', 'user:invite', 'user:write', 'process:write', 'iso:write', 'approval:approve', 'export:all'] },
  { id: 'quality', name: 'Manazer kvality', permissions: ['process:write', 'iso:write', 'approval:approve'] },
  { id: 'approver', name: 'Schvalovatel', permissions: ['process:read', 'approval:approve'] },
  { id: 'iso', name: 'ISO auditor', permissions: ['process:read', 'iso:write', 'export:process'] }
];

export const DEFAULT_TRANSLATIONS: TranslationDictionary = {
  sk: {
    'app.title': 'Procesna kniznica',
    'nav.processes': 'Procesy',
    'nav.settings': 'Nastavenia firmy',
    'nav.backoffice': 'Backoffice',
    'auth.register': 'Registracia firmy',
    'auth.login': 'Login',
    'actions.save': 'Ulozit',
    'actions.logout': 'Logout'
  },
  en: {
    'app.title': 'Process Library',
    'nav.processes': 'Processes',
    'nav.settings': 'Company settings',
    'nav.backoffice': 'Backoffice',
    'auth.register': 'Register company',
    'auth.login': 'Login',
    'actions.save': 'Save',
    'actions.logout': 'Logout'
  }
};
