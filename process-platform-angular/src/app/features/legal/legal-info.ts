/**
 * #21 — údaje pre právne texty na jednom mieste. Hodnoty v hranatých
 * zátvorkách doplní prevádzkovateľ; texty sú NÁVRH a pred zverejnením
 * ich má skontrolovať právnik (nie sú právnym poradenstvom).
 */

/** Verzia podmienok — mení sa pri podstatnej zmene; server si pamätá, ktorú verziu kto prijal. */
export const TERMS_VERSION = '2026-10-01';

export const LEGAL_DRAFT = true;

export const OPERATOR = {
  name: '[obchodné meno prevádzkovateľa]',
  address: '[sídlo]',
  companyId: '[IČO]',
  vatId: '[DIČ / IČ DPH]',
  register: '[zápis v obchodnom registri: súd, oddiel, vložka]',
  email: '[kontaktný e-mail]',
  privacyEmail: '[e-mail pre ochranu osobných údajov]',
  web: 'processbase.klomproject.sk',
  effectiveFrom: '[dátum účinnosti]'
};

export interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
  /** kedy sa údaje odovzdávajú */
  when: string;
}

/** Sprostredkovatelia — zoznam musí zodpovedať skutočnej prevádzke. */
export const SUBPROCESSORS: Subprocessor[] = [
  { name: 'Hetzner Online GmbH', purpose: 'hosting servera, databázy a záloh', location: 'Nemecko (EÚ)', when: 'vždy' },
  {
    name: 'Anthropic PBC (Claude)',
    purpose: 'AI asistent — návrh procesu z textu a rozbor dokumentov',
    location: 'USA — prenos na základe [rámca EÚ – USA na ochranu údajov / štandardných zmluvných doložiek — overiť]',
    when: 'len ak firma AI zapne a používateľ ju pri akcii výslovne zvolí'
  },
  {
    name: 'DeepL SE alebo Google (podľa voľby firmy)',
    purpose: 'automatický preklad názvu a popisu procesu',
    location: 'DeepL: Nemecko (EÚ); Google: [overiť]',
    when: 'len ak firma zapne automatický preklad s vlastným kľúčom'
  },
  {
    name: 'JGraph Ltd. (diagrams.net)',
    purpose: 'editor flowchartov vložený do stránky',
    location: 'Spojené kráľovstvo',
    when: 'len keď používateľ otvorí editor flowchartu a potvrdí načítanie'
  },
  { name: '[poskytovateľ e-mailov — doplní sa (#20)]', purpose: 'overovacie a systémové e-maily', location: '[doplniť]', when: 'po spustení e-mailov' }
];

/** Čo aplikácia ukladá v prehliadači — všetko technicky nevyhnutné alebo na výslovnú voľbu. */
export const BROWSER_STORAGE = [
  { key: 'ngSessionToken, ngCurrentUser, ngCurrentOrganization', purpose: 'prihlásenie (relácia) a aktuálna firma', kind: 'nevyhnutné', duration: 'do odhlásenia, relácia platí najviac 12 hodín' },
  { key: 'ngProcessTree, ngActiveProcessId', purpose: 'rýchle zobrazenie stromu procesov po prihlásení', kind: 'nevyhnutné', duration: 'do odhlásenia alebo zmeny firmy' },
  { key: 'ngLanguage, ngTranslations', purpose: 'jazyk rozhrania a preklady textov aplikácie', kind: 'nevyhnutné (predvoľba)', duration: 'kým ich nezmažete' },
  { key: 'ngTreePanel, ngNavCollapsed', purpose: 'rozloženie obrazovky (šírka panelov)', kind: 'nevyhnutné (predvoľba)', duration: 'kým ich nezmažete' },
  { key: 'pbFreeModelerDraft', purpose: 'rozpracovaný diagram v bezplatnom modeleri — neposiela sa na server', kind: 'nevyhnutné (funkcia)', duration: 'kým diagram nezahodíte' },
  { key: 'pbConsent', purpose: 'vaše rozhodnutie o externých službách a o tomto oznámení', kind: 'nevyhnutné', duration: '12 mesiacov' }
];
