/**
 * #46 DEMO-01 — ukážková firma „Modrá Hora Strojárne s.r.o. (ukážka)“ so syntetickými údajmi:
 * 25 zamestnancov (+1 bývalý), 8 útvarov, 23 pracovných miest, 8 IT systémov,
 * 3 vlastné polia a 50 procesov — 38 úplných (publikovaných), 12 čiastočných,
 * 25 s BPMN diagramom. K tomu história verzií, nepublikované zmeny, čakajúce
 * schválenia, podnety, záznamy o vykonaní, dokumenty a vyradený systém, aby
 * Prehľad a Moja práca ukazovali realistický obraz.
 *
 * Firma aj ľudia sú vymyslení; e-maily sú na rezervovanej doméne .example.
 * Údaje vznikajú cez API (rovnaké kontroly ako v aplikácii); dátumy verzií
 * sa na konci posunú do minulosti priamo v DB, aby história vyzerala reálne.
 * Heslá účtov sa zapíšu do storage/demo-company.txt (mimo gitu).
 *
 * Spustenie:  docker exec process-platform-angular-api-1 sh -c "cd /app && npx tsx scripts/seed-demo-company.ts"
 * Znova od nuly:  ... npx tsx scripts/seed-demo-company.ts --reset
 */
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../server/prisma';
import { draftSteps, foldName } from '../src/app/shared/process-draft/draft';
import { parseProcessText } from '../src/app/shared/process-draft/text-parser';
import { draftToBpmnXml } from '../src/app/shared/process-draft/bpmn-layout';

const API = process.env['API_URL'] ?? 'http://localhost:3000/api';
const ORG_NAME = 'Modrá Hora Strojárne s.r.o. (ukážka)';
const DOMAIN = 'modra-hora.example';
const DAY = 24 * 60 * 60 * 1000;
const today = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bratislava' }) + 'T00:00:00Z');
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);

// --- API ---

let token = '';
async function call<T = any>(pathname: string, options: { method?: string; body?: unknown; as?: string; raw?: Buffer; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const auth = options.as ?? token;
  if (auth) headers['Authorization'] = `Bearer ${auth}`;
  let body: any;
  if (options.raw) body = options.raw;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${API}${pathname}`, { method: options.method ?? (body ? 'POST' : 'GET'), headers, body });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${options.method ?? 'POST'} ${pathname} → ${response.status} ${payload?.message ?? ''}`);
  return payload as T;
}

// --- organizácia ---

const UNITS: Array<[string, string | null]> = [
  ['Vedenie spoločnosti', null],
  ['Ekonomické oddelenie', 'Vedenie spoločnosti'],
  ['Obchod a marketing', 'Vedenie spoločnosti'],
  ['Nákup', 'Vedenie spoločnosti'],
  ['Výroba', 'Vedenie spoločnosti'],
  ['Logistika a sklad', 'Vedenie spoločnosti'],
  ['Kvalita', 'Vedenie spoločnosti'],
  ['IT a personalistika', 'Vedenie spoločnosti']
];

const POSITIONS: Array<[string, string, string | null, string]> = [
  ['Konateľ', 'Vedenie spoločnosti', null, 'Riadi firmu, schvaľuje rozpočet, zmluvy a väčšie výdavky.'],
  ['Asistentka konateľa', 'Vedenie spoločnosti', 'Konateľ', 'Administratíva vedenia, došlá pošta, zápisy z porád.'],
  ['Hlavná účtovníčka', 'Ekonomické oddelenie', 'Konateľ', 'Zodpovedá za účtovníctvo, platby a finančné výkazy.'],
  ['Účtovník', 'Ekonomické oddelenie', 'Hlavná účtovníčka', 'Účtuje doklady, páruje úhrady, vedie pokladňu.'],
  ['Mzdová účtovníčka', 'Ekonomické oddelenie', 'Hlavná účtovníčka', 'Mzdy, odvody a výkazy pre poisťovne.'],
  ['Fakturantka', 'Ekonomické oddelenie', 'Hlavná účtovníčka', 'Vystavuje faktúry zákazníkom.'],
  ['Obchodný riaditeľ', 'Obchod a marketing', 'Konateľ', 'Obchodný plán, ceny, kľúčoví zákazníci.'],
  ['Obchodník', 'Obchod a marketing', 'Obchodný riaditeľ', 'Dopyty, ponuky a starostlivosť o zákazníkov.'],
  ['Marketingová špecialistka', 'Obchod a marketing', 'Obchodný riaditeľ', 'Kampane, web, veľtrhy.'],
  ['Referent zákazníckeho servisu', 'Obchod a marketing', 'Obchodný riaditeľ', 'Objednávky, reklamácie a komunikácia so zákazníkmi.'],
  ['Referent nákupu', 'Nákup', 'Konateľ', 'Objednávky materiálu a služieb, dodávatelia.'],
  ['Vedúci výroby', 'Výroba', 'Konateľ', 'Riadi výrobu, kapacity a termíny zákaziek.'],
  ['Majster výroby', 'Výroba', 'Vedúci výroby', 'Prideľuje prácu na zmene a sleduje stav zákaziek.'],
  ['Technológ', 'Výroba', 'Vedúci výroby', 'Technologické postupy a programy pre CNC.'],
  ['Operátor CNC', 'Výroba', 'Majster výroby', 'Obsluha CNC strojov.'],
  ['Technik údržby', 'Výroba', 'Vedúci výroby', 'Údržba a opravy strojov.'],
  ['Vedúci skladu', 'Logistika a sklad', 'Konateľ', 'Riadi sklad, príjem a expedíciu.'],
  ['Skladník', 'Logistika a sklad', 'Vedúci skladu', 'Príjem, vyskladnenie a balenie.'],
  ['Dispečer dopravy', 'Logistika a sklad', 'Vedúci skladu', 'Objednáva dopravu a sleduje zásielky.'],
  ['Manažér kvality', 'Kvalita', 'Konateľ', 'Systém riadenia kvality, audity, nápravné opatrenia.'],
  ['Kontrolór kvality', 'Kvalita', 'Manažér kvality', 'Vstupná, medzioperačná a výstupná kontrola.'],
  ['Správca IT', 'IT a personalistika', 'Konateľ', 'Počítače, siete, prístupy a zálohy.'],
  ['Personalistka', 'IT a personalistika', 'Konateľ', 'Nábor, nástupy, školenia a pracovné zmluvy.']
];

/** [meno, miesto, od, účet (rola)] — Technológ je dnes neobsadený (Pavol Kučera odišiel). */
const PEOPLE: Array<[string, string, string, string?]> = [
  ['Peter Kováč', 'Konateľ', '2019-01-01', 'owner'],
  ['Lucia Baranová', 'Asistentka konateľa', '2021-09-01'],
  ['Zuzana Mikulová', 'Hlavná účtovníčka', '2019-03-01'],
  ['Tomáš Hudák', 'Účtovník', '2022-02-01'],
  ['Eva Šimková', 'Mzdová účtovníčka', '2020-05-01'],
  ['Katarína Poláková', 'Fakturantka', '2023-04-01'],
  ['Martin Oravec', 'Obchodný riaditeľ', '2019-06-01'],
  ['Jakub Sedlák', 'Obchodník', '2021-01-11'],
  ['Michal Blaško', 'Obchodník', '2024-03-01'],
  ['Veronika Kráľová', 'Marketingová špecialistka', '2022-08-15'],
  ['Simona Černá', 'Referent zákazníckeho servisu', '2023-01-02'],
  ['Andrej Molnár', 'Referent nákupu', '2020-10-01'],
  ['Juraj Tóth', 'Vedúci výroby', '2019-02-01', 'approver'],
  ['Ladislav Benko', 'Majster výroby', '2019-02-01'],
  ['Marek Gregor', 'Operátor CNC', '2021-05-03'],
  ['Rastislav Hric', 'Operátor CNC', '2024-09-02'],
  ['Roman Pavlík', 'Technik údržby', '2020-01-06'],
  ['Ivan Mráz', 'Vedúci skladu', '2019-04-01'],
  ['Dávid Urban', 'Skladník', '2022-06-01'],
  ['Filip Švec', 'Skladník', '2025-02-03'],
  ['Stanislav Horák', 'Dispečer dopravy', '2021-11-01'],
  ['Jana Novotná', 'Manažér kvality', '2020-02-01', 'quality'],
  ['Monika Vargová', 'Kontrolór kvality', '2021-03-01', 'iso'],
  ['Lukáš Farkaš', 'Správca IT', '2022-01-10'],
  ['Petra Kollárová', 'Personalistka', '2023-06-01']
];

const SYSTEMS: Array<[string, string, string, string, string]> = [
  ['ERP – ekonomický systém', 'ERP', 'Hlavná účtovníčka', 'Účtovníctvo, faktúry, zákazky a sklad v číslach.', 'Dodávateľ softvéru s.r.o.'],
  ['CRM – zákazníci a obchod', 'CRM', 'Obchodný riaditeľ', 'Dopyty, ponuky, kontakty a história so zákazníkmi.', 'Cloudová služba'],
  ['Skladový systém', 'WMS', 'Vedúci skladu', 'Príjem, lokácie, vyskladnenie a inventúry.', ''],
  ['Mzdový a dochádzkový systém', 'HRS', 'Mzdová účtovníčka', 'Dochádzka, mzdy a personálna agenda.', ''],
  ['Internet banking', 'BANK', 'Hlavná účtovníčka', 'Platby a výpisy.', 'Banka'],
  ['E-mail a kalendár', 'MAIL', 'Správca IT', 'Firemná pošta a kalendáre.', ''],
  ['CAD/CAM', 'CAD', 'Technológ', 'Výkresy a programy pre CNC stroje.', ''],
  ['Starý výrobný informačný systém', 'MIS', 'Vedúci výroby', 'Pôvodná evidencia výroby — nahrádza ho modul ERP.', '']
];

const SYSTEM_KEYWORDS: Array<[string, RegExp]> = [
  ['ERP', /faktúr|zaúčt|ERP|závierk|pohľadáv|záväz|pokladn|zákazku v|výkaz/i],
  ['CRM', /dopyt|ponuk|CRM|kampa|zmluv|kľúčov/i],
  ['WMS', /sklad|naskladn|vyskladn|inventúr|zásob/i],
  ['HRS', /mzd|dochádz|nástup v mzdovom/i],
  ['BANK', /platobn|internet bank|platby|autorizuje platbu/i],
  ['MAIL', /e-mail/i],
  ['CAD', /program pre CNC|technologick/i]
];

// --- procesy ---

type Proc = {
  code: string;
  name: string;
  group: string;
  owner?: string;
  full: boolean;
  bpmn?: boolean;
  purpose?: string;
  trigger?: string;
  outcome?: string;
  steps?: string[];
  measure?: string;
  risks?: string;
  evidence?: string[];
};

const PROCESSES: Proc[] = [
  // --- riadiace ---
  {
    code: 'RP-01', name: 'Strategické plánovanie', group: 'Riadiace procesy', owner: 'Konateľ', full: true, bpmn: true,
    purpose: 'Firma má na každý rok jasné ciele, rozpočet a zodpovedných za ich splnenie.',
    trigger: 'Začiatok októbra — príprava plánu na ďalší rok', outcome: 'Schválený ročný plán a rozpočet',
    steps: ['Konateľ: vyhodnotí plnenie cieľov za aktuálny rok.', 'Obchodný riaditeľ: pripraví odhad tržieb a obchodný plán.', 'Vedúci výroby: pripraví plán kapacít a investícií.',
      'Hlavná účtovníčka: zostaví návrh rozpočtu.', 'Ak rozpočet nie je vyrovnaný, Konateľ: určí úsporné opatrenia, inak Konateľ: schváli plán a rozpočet.',
      'Asistentka konateľa: oznámi ciele zamestnancom e-mailom.'],
    measure: 'Ciele a rozpočet schválené do 15. decembra.', risks: 'Nereálne ciele — plán vychádza z výsledkov a kapacít, nie z prianí.', evidence: ['Schválený ročný plán']
  },
  {
    code: 'RP-02', name: 'Hodnotenie spokojnosti zákazníkov', group: 'Riadiace procesy', owner: 'Manažér kvality', full: true,
    purpose: 'Vieme, ako sú zákazníci spokojní, a zlepšujeme to, čo ich trápi.', trigger: 'Raz za polrok', outcome: 'Správa o spokojnosti s opatreniami',
    steps: ['Manažér kvality: pripraví dotazník spokojnosti.', 'Referent zákazníckeho servisu: pošle dotazník kľúčovým zákazníkom e-mailom.',
      'Manažér kvality: vyhodnotí odpovede a reklamácie za obdobie.', 'Obchodný riaditeľ: prerokuje výsledky s obchodníkmi.', 'Manažér kvality: navrhne opatrenia na zlepšenie.'],
    measure: 'Priemerné hodnotenie aspoň 4 z 5.'
  },
  {
    code: 'RP-03', name: 'Interný audit', group: 'Riadiace procesy', owner: 'Manažér kvality', full: true, bpmn: true,
    purpose: 'Overiť, či postupy vo firme fungujú tak, ako sú opísané.', trigger: 'Podľa ročného plánu auditov', outcome: 'Správa z auditu a zoznam zistení',
    steps: ['Manažér kvality: pripraví plán auditu a oznámi ho vedúcim.', 'Kontrolór kvality: vykoná audit na pracovisku.', 'Kontrolór kvality: zapíše zistenia do správy z auditu.',
      'Ak audit zistil nezhodu, Manažér kvality: založí nápravné opatrenie, inak Manažér kvality: uzavrie audit.', 'Konateľ: prevezme správu z auditu.'],
    measure: 'Každý proces auditovaný aspoň raz za 3 roky.', evidence: ['Správa z interného auditu']
  },
  {
    code: 'RP-04', name: 'Preskúmanie manažmentom', group: 'Riadiace procesy', owner: 'Konateľ', full: true,
    purpose: 'Vedenie raz ročne posúdi, či systém riadenia firmy prináša výsledky.', trigger: 'Raz ročne v januári', outcome: 'Záznam z preskúmania s rozhodnutiami',
    steps: ['Manažér kvality: pripraví podklady — audity, reklamácie, ciele.', 'Konateľ: zvolá poradu vedenia.', 'Konateľ: posúdi plnenie cieľov a rizík s vedúcimi.',
      'Asistentka konateľa: zapíše rozhodnutia a úlohy.', 'Manažér kvality: sleduje plnenie úloh.'],
    evidence: ['Záznam z preskúmania manažmentom']
  },
  {
    code: 'RP-05', name: 'Riadenie dokumentácie', group: 'Riadiace procesy', owner: 'Manažér kvality', full: true, bpmn: true,
    purpose: 'Každý pracuje podľa platnej verzie smernice a starú verziu nepoužíva.', trigger: 'Treba vydať novú alebo zmenenú smernicu', outcome: 'Platná smernica dostupná zamestnancom',
    steps: ['Manažér kvality: pripraví návrh smernice.', 'Vedúci výroby: pripomienkuje návrh.',
      'Ak sú pripomienky, Manažér kvality: zapracuje pripomienky, inak Konateľ: schváli smernicu.', 'Manažér kvality: zverejní smernicu v Process Base.',
      'Personalistka: zaznamená oboznámenie zamestnancov.']
  },
  {
    code: 'RP-06', name: 'Riadenie rizík a príležitostí', group: 'Riadiace procesy', owner: 'Manažér kvality', full: false,
    purpose: 'Riziká poznáme skôr, než sa z nich stanú problémy.'
  },
  {
    code: 'RP-07', name: 'Nápravné opatrenia', group: 'Riadiace procesy', owner: 'Manažér kvality', full: true, bpmn: true,
    purpose: 'Príčina problému sa odstráni, aby sa neopakoval.', trigger: 'Zistená nezhoda, reklamácia alebo zistenie z auditu', outcome: 'Overené účinné opatrenie',
    steps: ['Manažér kvality: zaeviduje nezhodu a určí riešiteľa.', 'Vedúci výroby: analyzuje príčinu metódou 5 prečo.', 'Vedúci výroby: navrhne a zavedie opatrenie.',
      'Kontrolór kvality: po troch mesiacoch overí účinnosť.', 'Ak opatrenie nie je účinné, Vedúci výroby: navrhne nové opatrenie, inak Manažér kvality: uzavrie nápravné opatrenie.'],
    risks: 'Opatrenie rieši následok, nie príčinu — preto analýza 5 prečo a overenie účinnosti.'
  },
  // --- obchod ---
  {
    code: 'OB-01', name: 'Spracovanie dopytu', group: 'Obchod', owner: 'Obchodný riaditeľ', full: true, bpmn: true,
    purpose: 'Každý dopyt zákazníka dostane odpoveď do dvoch pracovných dní.', trigger: 'Príde dopyt od zákazníka', outcome: 'Zákazník dostal odpoveď alebo ponuku',
    steps: ['Referent zákazníckeho servisu: zaeviduje dopyt v CRM.', 'Obchodník: posúdi, či vieme požiadavku splniť.',
      'Ak vieme požiadavku splniť, Obchodník: odovzdá dopyt na tvorbu ponuky, inak Obchodník: pošle zákazníkovi zdvorilé odmietnutie e-mailom.',
      'Obchodný riaditeľ: skontroluje stav dopytov raz týždenne.'],
    measure: '95 % dopytov s odpoveďou do 2 pracovných dní.'
  },
  {
    code: 'OB-02', name: 'Tvorba cenovej ponuky', group: 'Obchod', owner: 'Obchodný riaditeľ', full: true, bpmn: true,
    purpose: 'Ponuka je cenovo správna, vyrobiteľná a odoslaná včas.', trigger: 'Dopyt je odovzdaný na tvorbu ponuky', outcome: 'Odoslaná cenová ponuka',
    steps: ['Obchodník: pripraví technické zadanie.', 'Technológ: odhadne čas výroby a spotrebu materiálu.', 'Obchodník: vypočíta cenu a pripraví ponuku v CRM.',
      'Ak je hodnota ponuky nad 10 000 €, Konateľ: schváli ponuku, inak Obchodný riaditeľ: schváli ponuku.', 'Obchodník: pošle ponuku zákazníkovi e-mailom.'],
    measure: 'Úspešnosť ponúk aspoň 30 %.', risks: 'Podcenená ponuka — cenu počítame z odhadu technológa, nie odhadom obchodníka.'
  },
  {
    code: 'OB-03', name: 'Prijatie objednávky', group: 'Obchod', owner: 'Referent zákazníckeho servisu', full: true, bpmn: true,
    purpose: 'Objednávka je potvrdená so správnym termínom a cenou.', trigger: 'Zákazník pošle objednávku', outcome: 'Potvrdená objednávka a zákazka vo výrobe',
    steps: ['Referent zákazníckeho servisu: skontroluje objednávku voči ponuke.', 'Vedúci výroby: potvrdí termín dodania.',
      'Referent zákazníckeho servisu: založí zákazku v ERP.', 'Referent zákazníckeho servisu: pošle potvrdenie objednávky zákazníkovi e-mailom.']
  },
  {
    code: 'OB-04', name: 'Uzavretie zmluvy so zákazníkom', group: 'Obchod', owner: 'Obchodný riaditeľ', full: true,
    purpose: 'Rámcová zmluva chráni firmu a jasne určuje podmienky dodávok.', trigger: 'Nový stály zákazník alebo zmena podmienok', outcome: 'Podpísaná zmluva uložená v CRM',
    steps: ['Obchodník: dohodne obchodné podmienky so zákazníkom.', 'Obchodný riaditeľ: pripraví návrh zmluvy zo vzoru.', 'Hlavná účtovníčka: posúdi platobné podmienky.',
      'Konateľ: podpíše zmluvu.', 'Asistentka konateľa: uloží zmluvu a nastaví upozornenie na koniec platnosti.']
  },
  {
    code: 'OB-05', name: 'Riešenie reklamácie', group: 'Obchod', owner: 'Referent zákazníckeho servisu', full: true, bpmn: true,
    purpose: 'Reklamácia je vybavená do 30 dní a zákazník vie, v akom je stave.', trigger: 'Zákazník nahlási reklamáciu', outcome: 'Vybavená reklamácia a informovaný zákazník',
    steps: ['Referent zákazníckeho servisu: zaeviduje reklamáciu a potvrdí jej prijatie.', 'Kontrolór kvality: posúdi reklamovaný výrobok.',
      'Ak je reklamácia oprávnená, Vedúci výroby: zabezpečí opravu alebo náhradu, inak Referent zákazníckeho servisu: pripraví zdôvodnenie zamietnutia.',
      'Referent zákazníckeho servisu: informuje zákazníka o výsledku e-mailom.', 'Manažér kvality: vyhodnotí, či treba nápravné opatrenie.'],
    measure: 'Reklamácie vybavené do 30 dní.', evidence: ['Protokol o reklamácii']
  },
  {
    code: 'OB-06', name: 'Marketingová kampaň', group: 'Obchod', owner: 'Marketingová špecialistka', full: true, bpmn: true,
    purpose: 'Kampaň prinesie nové dopyty za rozumnú cenu.', trigger: 'Schválený marketingový plán', outcome: 'Vyhodnotená kampaň',
    steps: ['Marketingová špecialistka: pripraví cieľ, rozpočet a obsah kampane.', 'Obchodný riaditeľ: schváli kampaň.',
      'Marketingová špecialistka: spustí kampaň na webe a v sociálnych sieťach.', 'Obchodník: zaeviduje dopyty z kampane v CRM.', 'Marketingová špecialistka: vyhodnotí náklady a počet dopytov.']
  },
  {
    code: 'OB-07', name: 'Účasť na veľtrhu', group: 'Obchod', full: false,
    purpose: 'Na veľtrhu získame nové kontakty a stretneme stálych zákazníkov.',
    steps: ['Marketingová špecialistka: vyberie veľtrh a rezervuje stánok.', 'Obchodník: pripraví vzorky a materiály.', 'Obchodník: zaeviduje kontakty z veľtrhu v CRM.']
  },
  {
    code: 'OB-08', name: 'Správa kľúčových zákazníkov', group: 'Obchod', owner: 'Obchodný riaditeľ', full: false,
    steps: ['Obchodný riaditeľ: určí kľúčových zákazníkov.', 'Obchodník: raz za štvrťrok navštívi zákazníka.', 'Obchodník: zapíše záznam z návštevy do CRM.']
  },
  // --- nákup ---
  {
    code: 'NA-01', name: 'Nákup materiálu', group: 'Nákup', owner: 'Referent nákupu', full: true, bpmn: true,
    purpose: 'Materiál je na sklade včas, v správnej kvalite a za dohodnutú cenu.', trigger: 'Výroba alebo sklad nahlási potrebu materiálu', outcome: 'Objednaný materiál s potvrdeným termínom',
    steps: ['Majster výroby: nahlási potrebu materiálu.', 'Referent nákupu: vyberie dodávateľa zo zoznamu schválených.', 'Referent nákupu: pripraví objednávku v ERP.',
      'Ak je suma objednávky nad 5 000 €, Konateľ: schváli objednávku, inak Vedúci výroby: schváli objednávku.', 'Referent nákupu: pošle objednávku dodávateľovi e-mailom.',
      'Referent nákupu: sleduje potvrdenie a termín dodania.'],
    measure: 'Výroba nestojí pre chýbajúci materiál.'
  },
  {
    code: 'NA-02', name: 'Výber a hodnotenie dodávateľov', group: 'Nákup', owner: 'Referent nákupu', full: true, bpmn: true,
    purpose: 'Nakupujeme len od dodávateľov, ktorí spĺňajú požiadavky na kvalitu a termíny.', trigger: 'Nový dodávateľ alebo ročné hodnotenie', outcome: 'Aktualizovaný zoznam schválených dodávateľov',
    steps: ['Referent nákupu: zhromaždí údaje o dodávkach, reklamáciách a cenách.', 'Kontrolór kvality: ohodnotí kvalitu dodávok.', 'Referent nákupu: vypočíta celkové hodnotenie dodávateľa.',
      'Ak je hodnotenie pod 60 bodov, Referent nákupu: dohodne s dodávateľom nápravu, inak Referent nákupu: ponechá dodávateľa v zozname.', 'Manažér kvality: schváli zoznam dodávateľov.'],
    evidence: ['Hodnotenie dodávateľov']
  },
  {
    code: 'NA-03', name: 'Nákup služieb', group: 'Nákup', owner: 'Referent nákupu', full: true,
    purpose: 'Služby (doprava, servis, poradenstvo) objednávame transparentne a podľa rozpočtu.', trigger: 'Potreba služby od externej firmy', outcome: 'Objednaná a prevzatá služba',
    steps: ['Vedúci výroby: popíše požadovanú službu.', 'Referent nákupu: získa aspoň dve ponuky.', 'Referent nákupu: porovná ponuky a navrhne dodávateľa.',
      'Konateľ: schváli objednávku služby.', 'Vedúci výroby: prevezme službu a potvrdí faktúru.']
  },
  {
    code: 'NA-04', name: 'Reklamácia u dodávateľa', group: 'Nákup', owner: 'Referent nákupu', full: false,
    purpose: 'Chybný materiál dodávateľ vymení alebo dobropisuje.',
    steps: ['Zaevidovať nezhodu materiálu.', 'Poslať reklamáciu dodávateľovi.', 'Sledovať vybavenie reklamácie.']
  },
  // --- výroba ---
  {
    code: 'VY-01', name: 'Plánovanie výroby', group: 'Výroba', owner: 'Vedúci výroby', full: true, bpmn: true,
    purpose: 'Zákazky sú vyrobené v potvrdených termínoch pri dobrom využití strojov.', trigger: 'Nová zákazka alebo týždenné plánovanie', outcome: 'Týždenný plán výroby',
    steps: ['Vedúci výroby: skontroluje nové zákazky a termíny.', 'Majster výroby: overí dostupnosť materiálu a strojov.', 'Vedúci výroby: zostaví týždenný plán výroby.',
      'Ak hrozí meškanie, Obchodný riaditeľ: dohodne so zákazníkom nový termín, inak Majster výroby: pridelí práce operátorom.', 'Majster výroby: denne aktualizuje stav zákaziek.'],
    measure: 'Aspoň 95 % zákaziek dodaných v termíne.'
  },
  {
    code: 'VY-02', name: 'Príprava výroby a technológia', group: 'Výroba', owner: 'Vedúci výroby', full: true, bpmn: true,
    purpose: 'Každá zákazka má pred začatím výroby platný výkres, technologický postup a program.', trigger: 'Zákazka je zaradená do plánu', outcome: 'Výrobná dokumentácia pripravená na pracovisku',
    steps: ['Technológ: pripraví technologický postup.', 'Technológ: vytvorí program pre CNC stroj.', 'Majster výroby: skontroluje úplnosť dokumentácie.', 'Majster výroby: odovzdá dokumentáciu operátorovi.']
  },
  {
    code: 'VY-03', name: 'Výroba na CNC strojoch', group: 'Výroba', owner: 'Majster výroby', full: true, bpmn: true,
    purpose: 'Diely sú vyrobené podľa výkresu na prvý raz, bez zbytočného odpadu.', trigger: 'Pridelená práca a pripravená dokumentácia', outcome: 'Vyrobené diely odovzdané na kontrolu',
    steps: ['Operátor CNC: pripraví stroj a upne obrobok.', 'Operátor CNC: vyrobí prvý kus.', 'Kontrolór kvality: skontroluje prvý kus.',
      'Ak prvý kus nevyhovuje, Operátor CNC: upraví nastavenie stroja, inak Operátor CNC: vyrobí celú sériu.', 'Operátor CNC: zapíše výrobu a odovzdá diely na kontrolu.'],
    measure: 'Podiel nepodarkov pod 1,5 %.', risks: 'Chybné nastavenie stroja — prvý kus vždy kontroluje kontrolór.'
  },
  {
    code: 'VY-04', name: 'Výstupná kontrola', group: 'Výroba', owner: 'Kontrolór kvality', full: true, bpmn: true,
    purpose: 'K zákazníkovi odchádzajú len diely, ktoré spĺňajú požiadavky.', trigger: 'Diely sú odovzdané na kontrolu', outcome: 'Uvoľnené diely alebo označená nezhoda',
    steps: ['Kontrolór kvality: premeria diely podľa kontrolného plánu.', 'Kontrolór kvality: zapíše výsledky do protokolu.',
      'Ak diely vyhovujú, Kontrolór kvality: uvoľní diely na expedíciu, inak Kontrolór kvality: označí nezhodný výrobok.', 'Majster výroby: prevezme informáciu o výsledku.'],
    measure: 'Žiadna reklamácia rozmerov od zákazníka.', evidence: ['Protokol z výstupnej kontroly']
  },
  {
    code: 'VY-05', name: 'Preventívna údržba strojov', group: 'Výroba', owner: 'Technik údržby', full: true,
    purpose: 'Stroje nemajú neplánované odstávky kvôli zanedbanej údržbe.', trigger: 'Termín podľa plánu údržby', outcome: 'Vykonaná a zapísaná údržba',
    steps: ['Technik údržby: pripraví plán údržby na mesiac.', 'Majster výroby: uvoľní stroj na údržbu.', 'Technik údržby: vykoná údržbu podľa kontrolného zoznamu.', 'Technik údržby: zapíše údržbu do knihy stroja.'],
    evidence: ['Záznam o údržbe stroja']
  },
  {
    code: 'VY-06', name: 'Oprava poruchy stroja', group: 'Výroba', owner: 'Technik údržby', full: true, bpmn: true,
    purpose: 'Porucha je odstránená čo najrýchlejšie a bezpečne.', trigger: 'Operátor nahlási poruchu stroja', outcome: 'Opravený stroj uvoľnený do výroby',
    steps: ['Operátor CNC: zastaví stroj a nahlási poruchu.', 'Technik údržby: posúdi poruchu.', 'Ak treba náhradný diel, Referent nákupu: objedná náhradný diel.',
      'Technik údržby: opraví stroj.', 'Technik údržby: otestuje stroj.', 'Majster výroby: uvoľní stroj do výroby.']
  },
  {
    code: 'VY-07', name: 'Riadenie nezhodného výrobku', group: 'Výroba', owner: 'Manažér kvality', full: true,
    purpose: 'Nezhodný výrobok sa nedostane k zákazníkovi omylom.', trigger: 'Označený nezhodný výrobok', outcome: 'Rozhodnutie o nezhodnom výrobku a jeho vykonanie',
    steps: ['Kontrolór kvality: označí a oddelí nezhodný výrobok.', 'Manažér kvality: zvolá posúdenie s vedúcim výroby.', 'Vedúci výroby: rozhodne o oprave, prepracovaní alebo šrotovaní.',
      'Majster výroby: vykoná rozhodnutie.', 'Manažér kvality: zapíše nezhodu do evidencie.']
  },
  { code: 'VY-08', name: 'Kalibrácia meradiel', group: 'Výroba', owner: 'Kontrolór kvality', full: false, purpose: 'Meradlá merajú presne a majú platnú kalibráciu.' },
  {
    code: 'VY-09', name: 'Zmena technológie', group: 'Výroba', owner: 'Technológ', full: false,
    purpose: 'Zmena postupu je overená skôr, než sa použije v sériovej výrobe.',
    steps: ['Technológ: navrhne zmenu postupu.', 'Vedúci výroby: schváli zmenu.', 'Majster výroby: overí zmenu na skúšobnej sérii.']
  },
  // --- logistika ---
  {
    code: 'LO-01', name: 'Príjem materiálu na sklad', group: 'Logistika', owner: 'Vedúci skladu', full: true, bpmn: true,
    purpose: 'Na sklad prijímame len objednaný a nepoškodený materiál.', trigger: 'Príde dodávka od dodávateľa', outcome: 'Materiál naskladnený v skladovom systéme',
    steps: ['Skladník: prevezme dodávku a skontroluje dodací list.', 'Skladník: skontroluje množstvo a poškodenie obalov.',
      'Ak je dodávka v poriadku, Skladník: naskladní materiál v skladovom systéme, inak Vedúci skladu: spíše zápis o nezhode.',
      'Kontrolór kvality: vykoná vstupnú kontrolu vybraných dielov.', 'Referent nákupu: potvrdí prijatie dodávky.'],
    evidence: ['Príjemka']
  },
  {
    code: 'LO-02', name: 'Expedícia tovaru', group: 'Logistika', owner: 'Vedúci skladu', full: true, bpmn: true,
    purpose: 'Zákazník dostane správny tovar v dohodnutom termíne.', trigger: 'Diely sú uvoľnené na expedíciu', outcome: 'Odoslaný tovar s dodacím listom',
    steps: ['Skladník: vyskladní tovar podľa zákazky.', 'Skladník: zabalí tovar a označí ho štítkom.', 'Dispečer dopravy: objedná dopravu.', 'Vedúci skladu: vystaví dodací list.',
      'Referent zákazníckeho servisu: informuje zákazníka o odoslaní.'],
    measure: 'Aspoň 98 % zásielok odoslaných v termíne.'
  },
  {
    code: 'LO-03', name: 'Inventúra', group: 'Logistika', owner: 'Vedúci skladu', full: true,
    purpose: 'Stav skladu v systéme zodpovedá skutočnosti.', trigger: 'Koniec roka alebo mimoriadna inventúra', outcome: 'Inventúrny zápis a opravený stav skladu',
    steps: ['Hlavná účtovníčka: vyhlási inventúru a určí komisiu.', 'Skladník: spočíta zásoby podľa lokácií.', 'Vedúci skladu: porovná skutočný stav so skladovým systémom.',
      'Hlavná účtovníčka: zaúčtuje inventúrne rozdiely.', 'Konateľ: podpíše inventúrny zápis.']
  },
  {
    code: 'LO-04', name: 'Objednanie dopravy', group: 'Logistika', owner: 'Dispečer dopravy', full: true,
    purpose: 'Doprava je objednaná včas a za primeranú cenu.', trigger: 'Tovar je pripravený na odoslanie', outcome: 'Potvrdená doprava',
    steps: ['Dispečer dopravy: zistí rozmery a hmotnosť zásielky.', 'Dispečer dopravy: vyberie dopravcu zo zmluvných partnerov.', 'Dispečer dopravy: objedná dopravu e-mailom.',
      'Vedúci skladu: odovzdá zásielku dopravcovi.']
  },
  {
    code: 'LO-05', name: 'Vrátenie tovaru od zákazníka', group: 'Logistika', owner: 'Vedúci skladu', full: false, bpmn: true,
    purpose: 'Vrátený tovar je rýchlo posúdený a správne zaevidovaný.',
    steps: ['Referent zákazníckeho servisu: schváli vrátenie tovaru.', 'Skladník: prevezme vrátený tovar.', 'Kontrolór kvality: posúdi stav tovaru.',
      'Ak je tovar nepoškodený, Skladník: vráti tovar na sklad, inak Vedúci skladu: odpíše tovar.']
  },
  // --- ekonomika ---
  {
    code: 'EK-01', name: 'Spracovanie prijatej faktúry', group: 'Ekonomika', owner: 'Hlavná účtovníčka', full: true, bpmn: true,
    purpose: 'Faktúry sú uhradené včas a správne zaúčtované.', trigger: 'Príde faktúra od dodávateľa', outcome: 'Uhradená a zaúčtovaná faktúra',
    steps: ['Asistentka konateľa: zaeviduje faktúru do knihy došlých faktúr.', 'Účtovník: skontroluje faktúru voči objednávke a príjemke.',
      'Ak je faktúra v poriadku, Vedúci výroby: schváli faktúru, inak Účtovník: vráti faktúru dodávateľovi.', 'Účtovník: zaúčtuje faktúru v ERP.',
      'Hlavná účtovníčka: pripraví platobný príkaz v internet bankingu.', 'Konateľ: autorizuje platbu.'],
    measure: 'Žiadna faktúra uhradená po splatnosti.', risks: 'Úhrada neobjednaného plnenia — faktúru schvaľuje ten, kto objednával.'
  },
  {
    code: 'EK-02', name: 'Vystavenie faktúry', group: 'Ekonomika', owner: 'Fakturantka', full: true, bpmn: true,
    purpose: 'Každá dodávka je vyfakturovaná do troch dní a bez chýb.', trigger: 'Tovar bol odoslaný zákazníkovi', outcome: 'Faktúra odoslaná zákazníkovi',
    steps: ['Fakturantka: prevezme dodací list a zákazku.', 'Fakturantka: vystaví faktúru v ERP.', 'Hlavná účtovníčka: skontroluje faktúry nad 20 000 €.', 'Fakturantka: pošle faktúru zákazníkovi e-mailom.']
  },
  {
    code: 'EK-03', name: 'Úhrada záväzkov', group: 'Ekonomika', owner: 'Hlavná účtovníčka', full: true,
    purpose: 'Záväzky platíme v splatnosti a bez zbytočných poplatkov.', trigger: 'Dvakrát týždenne — platobný deň', outcome: 'Uhradené záväzky',
    steps: ['Účtovník: pripraví zoznam splatných faktúr z ERP.', 'Hlavná účtovníčka: navrhne poradie úhrad podľa hotovosti.', 'Konateľ: schváli zoznam úhrad.',
      'Hlavná účtovníčka: zadá platby v internet bankingu.', 'Účtovník: spáruje úhrady v ERP.']
  },
  {
    code: 'EK-04', name: 'Vymáhanie pohľadávok', group: 'Ekonomika', owner: 'Hlavná účtovníčka', full: true, bpmn: true,
    purpose: 'Zákazníci platia včas a nedobytných pohľadávok je minimum.', trigger: 'Faktúra je po splatnosti', outcome: 'Uhradená pohľadávka alebo odovzdanie na vymáhanie',
    steps: ['Účtovník: týždenne pripraví zoznam pohľadávok po splatnosti.', 'Obchodník: telefonicky pripomenie platbu zákazníkovi.', 'Hlavná účtovníčka: pošle upomienku e-mailom.',
      'Ak zákazník nezaplatí do 30 dní, Konateľ: rozhodne o vymáhaní, inak Účtovník: spáruje úhradu v ERP.']
  },
  {
    code: 'EK-05', name: 'Mesačná účtovná závierka', group: 'Ekonomika', owner: 'Hlavná účtovníčka', full: true,
    purpose: 'Vedenie má do 10. dňa v mesiaci spoľahlivé čísla za predchádzajúci mesiac.', trigger: 'Koniec mesiaca', outcome: 'Mesačný výkaz pre vedenie',
    steps: ['Účtovník: zaúčtuje všetky doklady za mesiac.', 'Mzdová účtovníčka: odovzdá podklady o mzdách.', 'Hlavná účtovníčka: skontroluje zostatky účtov.',
      'Hlavná účtovníčka: pripraví mesačný výkaz.', 'Konateľ: prerokuje výkaz s vedúcimi.'],
    evidence: ['Mesačný výkaz']
  },
  {
    code: 'EK-06', name: 'Spracovanie miezd', group: 'Ekonomika', owner: 'Mzdová účtovníčka', full: true,
    purpose: 'Zamestnanci dostanú správnu mzdu načas.', trigger: 'Koniec mesiaca', outcome: 'Vyplatené mzdy a odvody',
    steps: ['Majster výroby: odovzdá dochádzku a príplatky.', 'Personalistka: odovzdá zmeny v zmluvách a nástupy.', 'Mzdová účtovníčka: vypočíta mzdy v mzdovom systéme.',
      'Hlavná účtovníčka: skontroluje súhrn miezd.', 'Mzdová účtovníčka: pripraví platby miezd a odvodov v internet bankingu.', 'Mzdová účtovníčka: pošle výplatné pásky zamestnancom e-mailom.']
  },
  {
    code: 'EK-07', name: 'Pokladňa', group: 'Ekonomika', full: false,
    purpose: 'Hotovosť je pod kontrolou a každý pohyb má doklad.',
    steps: ['Účtovník: vydá hotovosť na preddavok.', 'Účtovník: zaúčtuje pokladničný doklad.', 'Hlavná účtovníčka: mesačne skontroluje stav pokladne.']
  },
  {
    code: 'EK-08', name: 'Cestovné náhrady', group: 'Ekonomika', owner: 'Účtovník', full: false, bpmn: true,
    steps: ['Personalistka: schváli pracovnú cestu.', 'Obchodník: vyúčtuje pracovnú cestu do 10 dní.', 'Účtovník: skontroluje vyúčtovanie.', 'Mzdová účtovníčka: preplatí náhrady so mzdou.']
  },
  // --- personalistika ---
  {
    code: 'HR-01', name: 'Nábor zamestnanca', group: 'Personalistika', owner: 'Personalistka', full: true, bpmn: true,
    purpose: 'Voľné miesto obsadíme vhodným človekom do 60 dní.', trigger: 'Vedúci požiada o obsadenie miesta', outcome: 'Podpísaná pracovná zmluva s novým zamestnancom',
    steps: ['Vedúci výroby: pošle požiadavku na obsadenie miesta.', 'Konateľ: schváli otvorenie pozície.', 'Personalistka: zverejní inzerát a vyberie uchádzačov.',
      'Vedúci výroby: vedie pohovory s uchádzačmi.', 'Ak je vybraný uchádzač, Personalistka: pripraví pracovnú zmluvu, inak Personalistka: zopakuje výber uchádzačov.', 'Konateľ: podpíše pracovnú zmluvu.'],
    measure: 'Miesto obsadené do 60 dní.'
  },
  {
    code: 'HR-02', name: 'Nástup nového zamestnanca', group: 'Personalistika', owner: 'Personalistka', full: true,
    purpose: 'Nový kolega má v prvý deň všetko potrebné a vie, čo ho čaká.', trigger: 'Podpísaná pracovná zmluva', outcome: 'Zaškolený zamestnanec',
    steps: ['Personalistka: pripraví nástupný balík a vstupné školenia.', 'Správca IT: zriadi prístupy do systémov.', 'Personalistka: vykoná školenie bezpečnosti práce.',
      'Majster výroby: zaškolí zamestnanca na pracovisku.', 'Personalistka: zaeviduje nástup v mzdovom systéme.']
  },
  {
    code: 'HR-03', name: 'Ukončenie pracovného pomeru', group: 'Personalistika', owner: 'Personalistka', full: true,
    purpose: 'Odchod zamestnanca je zákonný, bez straty vedomostí a prístupov.', trigger: 'Výpoveď alebo dohoda o skončení', outcome: 'Ukončený pomer a zrušené prístupy',
    steps: ['Personalistka: pripraví dohodu alebo potvrdí výpoveď.', 'Vedúci výroby: zabezpečí odovzdanie práce.', 'Správca IT: zruší prístupy k poslednému dňu.',
      'Mzdová účtovníčka: vypočíta poslednú mzdu.', 'Personalistka: vydá potvrdenie o zamestnaní.']
  },
  {
    code: 'HR-04', name: 'Školenia a rozvoj', group: 'Personalistika', owner: 'Personalistka', full: true,
    purpose: 'Zamestnanci majú platné povinné školenia a rozvíjajú sa podľa plánu.', trigger: 'Ročný plán školení', outcome: 'Absolvované školenia s evidenciou',
    steps: ['Personalistka: zostaví plán školení s vedúcimi.', 'Konateľ: schváli rozpočet na školenia.', 'Personalistka: objedná školenia a pozve zamestnancov.',
      'Personalistka: zaeviduje absolvovanie a platnosť osvedčení.'],
    evidence: ['Prezenčná listina zo školenia']
  },
  { code: 'HR-05', name: 'Hodnotenie zamestnancov', group: 'Personalistika', owner: 'Konateľ', full: false },
  // --- IT ---
  {
    code: 'IT-01', name: 'Správa prístupov do systémov', group: 'IT', owner: 'Správca IT', full: true,
    purpose: 'Každý má prístup len k tomu, čo potrebuje na prácu.', trigger: 'Nástup, zmena pozície alebo odchod zamestnanca', outcome: 'Nastavené prístupy',
    steps: ['Vedúci výroby: požiada o prístup pre zamestnanca.', 'Správca IT: overí požiadavku podľa pracovného miesta.', 'Správca IT: nastaví prístup do systémov.',
      'Správca IT: raz za štvrťrok preverí zoznam prístupov.']
  },
  {
    code: 'IT-02', name: 'Riešenie IT požiadaviek', group: 'IT', owner: 'Správca IT', full: true,
    purpose: 'IT problémy sú vyriešené rýchlo a nič sa nestratí.', trigger: 'Zamestnanec nahlási problém', outcome: 'Vyriešená požiadavka',
    steps: ['Asistentka konateľa: zaeviduje požiadavku.', 'Správca IT: posúdi naliehavosť.', 'Správca IT: vyrieši požiadavku alebo objedná servis.',
      'Správca IT: informuje zamestnanca o vyriešení e-mailom.']
  },
  {
    code: 'IT-03', name: 'Zálohovanie údajov', group: 'IT', owner: 'Správca IT', full: false, bpmn: true,
    purpose: 'Po výpadku alebo chybe vieme obnoviť údaje najviac z predchádzajúceho dňa.',
    steps: ['Správca IT: nastaví denné zálohovanie serverov.', 'Správca IT: týždenne skontroluje úspešnosť záloh.', 'Správca IT: raz za štvrťrok otestuje obnovu zo zálohy.']
  },
  { code: 'IT-04', name: 'Obnova po výpadku systému', group: 'IT', full: false }
];

const GROUPS: Array<[string, string | null]> = [
  ['Riadiace procesy', null],
  ['Hlavné procesy', null],
  ['Obchod', 'Hlavné procesy'],
  ['Nákup', 'Hlavné procesy'],
  ['Výroba', 'Hlavné procesy'],
  ['Logistika', 'Hlavné procesy'],
  ['Podporné procesy', null],
  ['Ekonomika', 'Podporné procesy'],
  ['Personalistika', 'Podporné procesy'],
  ['IT', 'Podporné procesy']
];

/** nadväznosť hlavného toku hodnoty */
const CHAIN: Array<[string, string]> = [
  ['OB-01', 'OB-02'], ['OB-02', 'OB-03'], ['OB-03', 'VY-01'], ['VY-01', 'VY-02'], ['VY-02', 'VY-03'], ['VY-03', 'VY-04'],
  ['VY-04', 'LO-02'], ['LO-02', 'EK-02'], ['NA-01', 'LO-01'], ['LO-01', 'EK-01'], ['OB-05', 'RP-07'], ['HR-01', 'HR-02']
];

const V2 = new Set(['OB-02', 'EK-01', 'VY-03', 'LO-01', 'HR-01']);
const PENDING_CHANGES = new Set(['RP-05', 'NA-01', 'EK-04', 'VY-05']);
const PENDING_APPROVAL = new Set(['OB-05', 'LO-02']);
const REVIEW_SOON: Record<string, number> = { 'RP-03': 12, 'VY-04': 21, 'EK-06': 27 };
const REVIEW_OVERDUE: Record<string, number> = { 'RP-04': -9, 'HR-03': -24 };
const DOCUMENTS: Record<string, string> = {
  'RP-05': 'Smernica o riadení dokumentácie.pdf',
  'EK-01': 'Postup spracovania faktúr.pdf',
  'VY-04': 'Kontrolný plán výstupnej kontroly.pdf',
  'HR-02': 'Nástupný kontrolný zoznam.pdf',
  'LO-01': 'Pokyn pre príjem materiálu.pdf',
  'NA-02': 'Kritériá hodnotenia dodávateľov.pdf'
};

/** Jednoduchý PDF dokument (text bez diakritiky — štandardné písmo PDF ju nepozná). */
function pdf(title: string, lines: string[]): Buffer {
  const ascii = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[()\\]/g, (m) => `\\${m}`);
  const text = [`BT /F1 18 Tf 60 780 Td (${ascii(title)}) Tj ET`, ...lines.map((line, index) => `BT /F1 11 Tf 60 ${740 - index * 18} Td (${ascii(line)}) Tj ET`)].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function asciiEmail(name: string): string {
  return `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.')}@${DOMAIN}`;
}

async function reset(): Promise<void> {
  const organizations = await prisma.organization.findMany({ where: { name: ORG_NAME }, select: { id: true } });
  for (const organization of organizations) {
    await prisma.organization.delete({ where: { id: organization.id } });
    rmSync(path.join(process.env['UPLOAD_DIR'] ?? 'storage/uploads', organization.id), { recursive: true, force: true });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  console.log(`Zmazané: ${organizations.length} ukážkové firmy.`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--reset')) await reset();
  if (await prisma.organization.findFirst({ where: { name: ORG_NAME } })) {
    console.error(`Firma „${ORG_NAME}“ už existuje — spustite so --reset.`);
    process.exit(1);
  }
  const password = `Demo-${randomBytes(9).toString('base64url')}`;

  // --- účty ---
  const registered = await call('/register', {
    as: '',
    body: { acceptTerms: true, organizationName: ORG_NAME, ownerName: 'Peter Kováč', email: `konatel@${DOMAIN}`, password }
  });
  token = registered.token;
  const orgId: string = registered.organization.id;
  const org = (suffix: string) => `/organizations/${orgId}${suffix}`;
  const accounts: Record<string, { email: string; token: string }> = { owner: { email: `konatel@${DOMAIN}`, token } };
  const accountEmails: Record<string, string> = { quality: `kvalita@${DOMAIN}`, approver: `vyroba@${DOMAIN}`, iso: `kontrola@${DOMAIN}` };
  for (const [name, , , role] of PEOPLE) {
    if (!role || role === 'owner') continue;
    const invitation = await call(org('/invitations'), { body: { email: accountEmails[role], roleId: role } });
    const accepted = await call(`/invitations/${invitation.token}/accept`, { as: '', body: { name, password } });
    accounts[role] = { email: accountEmails[role], token: accepted.token };
  }

  // --- útvary, miesta ---
  const unitId: Record<string, string> = {};
  for (const [name, parent] of UNITS) {
    unitId[name] = (await call(org('/units'), { body: { name, description: '', parentId: parent ? unitId[parent] : null } })).id;
  }
  const positionId: Record<string, string> = {};
  for (const [name, unit, , description] of POSITIONS) {
    positionId[name] = (await call(org('/positions'), { body: { name, unitId: unitId[unit], description } })).id;
  }
  for (const [name, , reportsTo] of POSITIONS) {
    if (reportsTo) await call(`/positions/${positionId[name]}`, { method: 'PATCH', body: { reportsToId: positionId[reportsTo] } });
  }

  // --- ľudia a obsadenie (osoby s účtom už založilo prijatie pozvánky) ---
  const existing: Array<{ id: string; name: string }> = await call(org('/people'));
  const personId: Record<string, string> = Object.fromEntries(existing.map((person) => [person.name, person.id]));
  for (const [name, position, from] of PEOPLE) {
    if (!personId[name]) {
      personId[name] = (await call(org('/people'), { body: { name, email: asciiEmail(name), phone: `+421 9${String(10 + Object.keys(personId).length).padStart(2, '0')} 555 ${String(100 + Object.keys(personId).length)}` } })).id;
    }
    await call(`/positions/${positionId[position]}/assignments`, { body: { personId: personId[name], validFrom: from } });
  }
  // bývalý technológ — miesto je dnes neobsadené
  const former = (await call(org('/people'), { body: { name: 'Pavol Kučera', email: asciiEmail('Pavol Kučera'), note: 'Odišiel k 30. 6. 2026.' } })).id;
  await call(`/positions/${positionId['Technológ']}/assignments`, { body: { personId: former, validFrom: '2021-02-01' } });
  await call(`/people/${former}/leave`, { body: { date: '2026-06-30' } });

  // --- IT systémy, vlastné polia, profil kvality ---
  const systemId: Record<string, string> = {};
  for (const [name, code, owner, description, vendor] of SYSTEMS) {
    systemId[code] = (await call(org('/systems'), { body: { name, code, ownerPositionId: positionId[owner], description, vendor } })).id;
  }
  const fieldNumber = (await call(org('/process-fields'), { body: { label: 'Číslo smernice', type: 'text', required: true, helpText: 'Označenie v systéme dokumentácie, napr. SM-EK-01' } })).id;
  const fieldLevel = (await call(org('/process-fields'), { body: { label: 'Stupeň dôvernosti', type: 'select', options: ['Verejné', 'Interné', 'Dôverné'] } })).id;
  const fieldTraining = (await call(org('/process-fields'), { body: { label: 'Dátum posledného školenia', type: 'date' } })).id;
  await call(org(''), { method: 'PATCH', body: { qualityProfile: true } });

  // --- skupiny procesov ---
  const groupId: Record<string, string> = {};
  for (const [index, [name, parent]] of GROUPS.entries()) {
    groupId[name] = (await call(org('/processes'), { body: { name, type: 'folder', parentId: parent ? groupId[parent] : null, sortOrder: index * 10 } })).id;
  }

  // --- procesy ---
  const positionNames = POSITIONS.map(([name]) => name);
  const created: Record<string, { id: string; proc: Proc; activityIds: string[] }> = {};
  for (const [index, proc] of PROCESSES.entries()) {
    const node = await call(org('/processes'), { body: { name: proc.name, type: 'process', code: proc.code, parentId: groupId[proc.group], sortOrder: index * 10 } });
    const text = [proc.name, proc.purpose ? `Účel: ${proc.purpose}` : '', proc.trigger ? `Spúšťač: ${proc.trigger}` : '', proc.outcome ? `Výsledok: ${proc.outcome}` : '',
      ...(proc.steps ?? []).map((step, number) => `${number + 1}. ${step}`)].filter(Boolean).join('\n');
    const draft = parseProcessText(text, { knownRoles: positionNames });
    const steps = proc.steps?.length ? draftSteps(draft) : [];
    const stepText = (title: string) => proc.steps?.find((item) => foldName(item).includes(foldName(title).slice(0, 20))) ?? title;

    const systemsOf = (value: string) => SYSTEM_KEYWORDS.filter(([, pattern]) => pattern.test(value)).map(([code]) => systemId[code]);
    const processSystems = new Set<string>();
    if (proc.group === 'Obchod') processSystems.add(systemId['CRM']);
    if (proc.group === 'Ekonomika') processSystems.add(systemId['ERP']);
    if (proc.group === 'Logistika') processSystems.add(systemId['WMS']);
    if (proc.code === 'VY-01' || proc.code === 'VY-03') processSystems.add(systemId['MIS']);

    const patch: Record<string, unknown> = {
      purpose: proc.purpose,
      trigger: proc.trigger,
      outcome: proc.outcome,
      ownerPositionId: proc.owner ? positionId[proc.owner] : undefined,
      systemIds: [...processSystems]
    };
    if (proc.full) {
      Object.assign(patch, {
        inputs: proc.trigger ? [proc.trigger] : [],
        outputs: proc.outcome ? [proc.outcome] : [],
        successMeasure: proc.measure ?? '',
        risks: proc.risks ?? '',
        resources: 'Kvalifikovaní ľudia na pracovných miestach, systémy uvedené pri krokoch.',
        evidenceRequirements: proc.evidence ?? [],
        customFields: {
          [fieldNumber]: `SM-${proc.code}`,
          [fieldLevel]: /^(EK|HR)/.test(proc.code) ? 'Dôverné' : /^RP/.test(proc.code) ? 'Interné' : index % 3 === 0 ? 'Verejné' : 'Interné',
          [fieldTraining]: iso(addDays(today, -30 - (index * 11) % 300))
        }
      });
    } else if (proc.purpose && index % 2 === 0) {
      patch['customFields'] = { [fieldLevel]: 'Interné' };
    }
    await call(`/processes/${node.id}`, { method: 'PATCH', body: patch });

    if (steps.length > 0) {
      const ownerPosition = proc.owner ? positionId[proc.owner] : null;
      const saved = await call(`/processes/${node.id}/activities`, {
        method: 'PUT',
        body: {
          activities: steps.map((step) => {
            const responsible = step.role ? positionId[positionNames.find((name) => foldName(name) === foldName(step.role!)) ?? ''] : undefined;
            const raci: Array<{ role: string; positionId: string }> = [];
            if (responsible) raci.push({ role: 'R', positionId: responsible });
            // vlastník procesu zodpovedá (A) za kroky, ktoré sám nevykonáva
            if (ownerPosition && ownerPosition !== responsible && proc.full) raci.push({ role: 'A', positionId: ownerPosition });
            return { title: step.title, description: step.description, raci, systemIds: [...new Set(systemsOf(stepText(step.title)))] };
          })
        }
      });
      created[proc.code] = { id: node.id, proc, activityIds: saved.activities.map((activity: any) => activity.id) };
    } else {
      created[proc.code] = { id: node.id, proc, activityIds: [] };
    }
    if (proc.bpmn && steps.length > 0) {
      await call(`/processes/${node.id}`, { method: 'PATCH', body: { bpmnXml: draftToBpmnXml({ ...draft, name: proc.name }), diagramType: 'BPMN' } });
    }
  }

  // nadväznosť procesov
  for (const [from, to] of CHAIN) {
    const upstream = CHAIN.filter(([, target]) => target === to).map(([source]) => created[source].id);
    const downstream = CHAIN.filter(([source]) => source === from).map(([, target]) => created[target].id);
    await call(`/processes/${created[to].id}`, { method: 'PATCH', body: { upstreamProcessIds: upstream } });
    await call(`/processes/${created[from].id}`, { method: 'PATCH', body: { downstreamProcessIds: downstream } });
  }

  // dokumenty (pred publikovaním — patria do verzie)
  for (const [code, fileName] of Object.entries(DOCUMENTS)) {
    const proc = created[code].proc;
    const content = pdf(fileName.replace(/\.pdf$/, ''), [`Proces: ${proc.code} ${proc.name}`, `Ucel: ${proc.purpose ?? ''}`, 'Ukazkovy dokument - synteticke udaje.', ...(proc.steps ?? []).map((step, i) => `${i + 1}. ${step}`)]);
    await call(`/processes/${created[code].id}/documents`, {
      raw: content,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(fileName), 'X-File-Type': 'application/pdf' }
    });
  }

  // --- publikovanie úplných procesov ---
  for (const [index, proc] of PROCESSES.entries()) {
    if (!proc.full) continue;
    await call(`/processes/${created[proc.code].id}/publish`, { body: { nextReviewAt: iso(addDays(today, 200 + (index * 7) % 160)) } });
  }
  // druhé verzie so zmenou
  for (const code of V2) {
    const { id, proc } = created[code];
    await call(`/processes/${id}`, { method: 'PATCH', body: { outcome: `${proc.outcome}; výsledok zapísaný v systéme` } });
    await call(`/processes/${id}/publish`, { body: { changeReason: 'Doplnený záznam výsledku v systéme po internom audite.', nextReviewAt: iso(addDays(today, 330)) } });
  }
  // nepublikované zmeny návrhu
  for (const code of PENDING_CHANGES) {
    const { id, proc } = created[code];
    await call(`/processes/${id}`, { method: 'PATCH', body: { purpose: `${proc.purpose} Pripravuje sa úprava podľa nových požiadaviek.` } });
  }

  // vyradený systém — procesy ho ešte majú
  await call(`/systems/${systemId['MIS']}/archive`, { body: { confirm: true } });

  // povinné schvaľovanie a dve čakajúce žiadosti
  await call(org(''), { method: 'PATCH', body: { requireApproval: true } });
  for (const code of PENDING_APPROVAL) {
    const { id, proc } = created[code];
    await call(`/processes/${id}`, { method: 'PATCH', body: { outcome: `${proc.outcome} (potvrdené zákazníkovi)` }, as: accounts['quality'].token });
    await call(`/processes/${id}/approval-requests`, { body: { changeReason: 'Zákazník dostane potvrdenie o výsledku.', nextReviewAt: iso(addDays(today, 365)) }, as: accounts['quality'].token });
  }

  // podnety
  const feedback: Array<[string, 'error' | 'improvement', string, string, number]> = [
    ['EK-01', 'error', 'approver', 'Pri faktúrach za služby nie je jasné, kto ich schvaľuje — výroba ich neobjednáva.', 2],
    ['VY-03', 'improvement', 'iso', 'Navrhujem zapisovať nameraný prvý kus priamo do protokolu v tablete, nie na papier.', 2],
    ['OB-03', 'improvement', 'approver', 'Termín dodania by sme vedeli potvrdzovať rýchlejšie, keby sme videli vyťaženie strojov.', 1],
    ['LO-01', 'error', 'iso', 'Vstupná kontrola sa robí aj pri spojovacom materiáli, čo nie je potrebné.', 3],
    ['HR-02', 'improvement', 'quality', 'Do nástupu doplniť prehliadku firmy a predstavenie kolegov.', 0]
  ];
  for (const [code, kind, account, text, step] of feedback) {
    const { id, activityIds } = created[code];
    await call(`/processes/${id}/feedback`, { body: { kind, text, activityId: activityIds[step] }, as: accounts[account].token });
  }

  // záznamy o vykonaní
  const evidence: Array<[string, number, string]> = [
    ['VY-04', -3, 'Zákazka Z-2026-118, 40 ks'], ['VY-04', -17, 'Zákazka Z-2026-104'], ['RP-03', -430, 'Audit výroby'],
    ['VY-05', -12, 'CNC stroj č. 2'], ['HR-04', -45, 'Školenie BOZP'], ['EK-05', -20, 'Výkaz za minulý mesiac'], ['NA-02', -150, 'Ročné hodnotenie']
  ];
  for (const [code, offset, note] of evidence) {
    const { id, proc } = created[code];
    await call(`/processes/${id}/evidence`, { body: { requirement: proc.evidence![0], performedOn: iso(addDays(today, offset)), note } });
  }

  // --- história: verzie posunuté do minulosti ---
  for (const [index, proc] of PROCESSES.entries()) {
    if (!proc.full) continue;
    const versions = await prisma.processVersion.findMany({ where: { processNodeId: created[proc.code].id }, orderBy: { revision: 'asc' } });
    const first = addDays(new Date('2025-01-13T00:00:00Z'), (index * 13) % 420);
    if (versions.length === 1) {
      await prisma.processVersion.update({ where: { id: versions[0].id }, data: { effectiveFrom: first, publishedAt: new Date(first.getTime() - DAY + 9 * 3600 * 1000) } });
    } else {
      const second = addDays(new Date('2026-03-02T00:00:00Z'), (index * 5) % 150);
      await prisma.processVersion.update({ where: { id: versions[0].id }, data: { effectiveFrom: first, effectiveTo: addDays(second, -1), publishedAt: new Date(first.getTime() - DAY + 9 * 3600 * 1000) } });
      await prisma.processVersion.update({ where: { id: versions[1].id }, data: { effectiveFrom: second, publishedAt: new Date(second.getTime() - DAY + 10 * 3600 * 1000) } });
    }
    const last = versions[versions.length - 1];
    const review = REVIEW_SOON[proc.code] ?? REVIEW_OVERDUE[proc.code];
    if (review !== undefined) await prisma.processVersion.update({ where: { id: last.id }, data: { nextReviewAt: addDays(today, review) } });
  }
  // upozornenia zo zakladania sú prečítané; ostanú len tie, na ktoré treba reagovať
  await prisma.notification.updateMany({
    where: { organizationId: orgId, type: { notIn: ['ApprovalRequested', 'FeedbackSubmitted', 'SystemArchived'] } },
    data: { readAt: new Date() }
  });

  const credentials = [
    `Ukážková firma: ${ORG_NAME}`,
    `Vytvorené: ${new Date().toISOString()}`,
    `Heslo pre všetky účty: ${password}`,
    '',
    `Vlastník (konateľ, Peter Kováč):          ${accounts['owner'].email}`,
    `Manažérka kvality (Jana Novotná):          ${accounts['quality'].email}`,
    `Schvaľovateľ (vedúci výroby, Juraj Tóth):  ${accounts['approver'].email}`,
    `ISO audítorka (Monika Vargová):            ${accounts['iso'].email}`,
    ''
  ].join('\n');
  writeFileSync(path.join('storage', 'demo-company.txt'), credentials, { mode: 0o600 });

  const full = PROCESSES.filter((proc) => proc.full).length;
  const withBpmn = PROCESSES.filter((proc) => proc.bpmn && proc.steps?.length).length;
  console.log(`Hotovo: ${PROCESSES.length} procesov (úplné ${full}, čiastočné ${PROCESSES.length - full}, s BPMN ${withBpmn}), ` +
    `${PEOPLE.length} zamestnancov, ${POSITIONS.length} miest, ${SYSTEMS.length} systémov. Prihlasovacie údaje: storage/demo-company.txt`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
