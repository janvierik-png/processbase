/**
 * Import dokumentov (#41 IMP-01, scenar 6) so syntetickymi dokumentmi.
 *
 * Word s nadpismi, ocislovanymi krokmi, tabulkou krokov a organizacnou schemou
 * (SmartArt „pavuk“), Excel a CSV s organizacnou strukturou, obrazok (len AI).
 * Rozbor vrati kandidatov s citaciou zdroja a zhodu s tym, co firma uz ma;
 * nic sa nevytvori, kym to clovek nepotvrdi. Potvrdenie zluci duplicity (miesto
 * s rovnakym nazvom sa nevytvori znova), procesy su len navrhy. Nebezpecne subory
 * (zip bomba, DOCTYPE, podvrhnuty format, velkost) sa odmietnu. Obsah suboru
 * sa neuklada ani nelogi (znacka LOGMARK- v dokumente — kontroluje CI).
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/document-import-test.mjs
 */
import { crc32, deflateRawSync } from 'node:zlib';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

async function analyze(fileName, data, token, query = '') {
  const response = await fetch(`${API}/import/analyze${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(fileName) },
    body: data
  });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

/** Minimálny ZIP (docx/xlsx) — uložené alebo deflate, voliteľne s falošnou veľkosťou. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressed = file.deflate ? deflateRawSync(data) : data;
    const name = Buffer.from(file.name, 'utf8');
    const size = file.declaredSize ?? data.length;
    const method = file.deflate ? 8 : 0;
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const heading = (text) => `<w:p><w:pPr><w:pStyle w:val="Nadpis1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const para = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const item = (text) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const documentXml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
const stylesXml = `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Nadpis1"><w:name w:val="heading 1"/></w:style></w:styles>`;

const box = (id, ...lines) => `<dgm:pt modelId="{${id}}"><dgm:prSet/><dgm:t><a:bodyPr/>${lines.map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join('')}</dgm:t></dgm:pt>`;
const link = (from, to, order) => `<dgm:cxn modelId="{c${from}-${to}}" srcId="{${from}}" destId="{${to}}" srcOrd="${order}" destOrd="0"/>`;
const smartArt = `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst>
<dgm:pt modelId="{0}" type="doc"><dgm:prSet/><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt>
${box(1, 'Konateľ', 'Ing. Peter Horváth')}${box(2, 'Ekonomické oddelenie')}${box(3, 'Hlavná účtovníčka', 'Jana Malá')}${box(4, 'Vedúci výroby')}${box(5, 'Majster')}
<dgm:pt modelId="{8}" type="parTrans"/><dgm:pt modelId="{9}" type="pres"><dgm:prSet/></dgm:pt>
</dgm:ptLst><dgm:cxnLst>${link(0, 1, 0)}${link(1, 2, 0)}${link(2, 3, 0)}${link(1, 4, 1)}${link(4, 5, 0)}<dgm:cxn modelId="{p}" type="presOf" srcId="{1}" destId="{9}"/></dgm:cxnLst></dgm:dataModel>`;

const docx = zip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
  { name: 'word/styles.xml', data: stylesXml },
  {
    name: 'word/document.xml',
    deflate: true,
    data: documentXml([
      heading('1. Nákup materiálu'),
      para('Proces začína, keď výroba nahlási potrebu materiálu.'),
      item('Referent nákupu pripraví objednávku.'),
      item('Ak je suma nad 1000 €, konateľ objednávku schváli, inak ju schváli vedúci výroby.'),
      item('Referent nákupu odošle objednávku dodávateľovi LOGMARK-IMPORT-7.'),
      heading('2. Príjem na sklad'),
      `<w:tbl>${row('Krok', 'Zodpovedný')}${row('Prevziať tovar', 'Skladník')}${row('Skontrolovať dodací list', 'Skladník')}${row('Zaevidovať príjem', 'Hlavná účtovníčka')}</w:tbl>`,
      heading('3. Organizačná štruktúra'),
      para('Schéma je nižšie.')
    ].join(''))
  },
  { name: 'word/diagrams/data1.xml', data: smartArt, deflate: true }
]);

const sheet = (rows) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((cells, r) =>
  `<row r="${r + 1}">${cells.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
const xlsx = zip([
  { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Organizácia" sheetId="1" r:id="rId1"/></sheets></workbook>' },
  { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
  {
    name: 'xl/worksheets/sheet1.xml',
    deflate: true,
    data: sheet([
      ['Útvar', 'Pracovné miesto', 'Nadriadený', 'Meno'],
      ['Obchod', 'Obchodný riaditeľ', 'Konateľ', 'Martin Kováč'],
      ['Obchod', 'Obchodník', 'Obchodný riaditeľ', 'Eva Nová'],
      ['Sklad', 'Skladník', 'Vedúci výroby', '']
    ])
  }
]);
const csv = Buffer.from('﻿Oddelenie;Pozícia;Podlieha;Zamestnanec\n"Personalistika";Personalistka;Konateľ;"Zuzana Biela"\n', 'utf8');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { acceptTerms: true, organizationName: `Org Test import ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-imp-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
  });
  return { token: reg.payload?.token, orgId: reg.payload?.organization?.id };
}

const a = await register('a');
const b = await register('b');
if (!a.token || !b.token) {
  console.error('Testovacie firmy sa nepodarilo zalozit — bezi API?');
  process.exit(2);
}
const owner = a.token;
const org = (path) => `/organizations/${a.orgId}${path}`;
async function member(label, roleId) {
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-imp-${label}-${STAMP}@example.test`, roleId }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}
const eva = await member('Eva', 'quality');
const jana = await member('Jana', 'approver');
const existingBoss = (await call(org('/positions'), { method: 'POST', body: { name: 'Konateľ' }, token: owner })).payload;

// --- Word: pavúk, procesy, citácie ---
const word = await analyze('Smernica nákupu.docx', docx, owner);
const w = word.payload ?? {};
check('Word rozobraný podľa pravidiel', word.status === 200 && w.format === 'docx' && w.method === 'rules', `${word.status} ${w.message}`);
const pos = Object.fromEntries((w.positions ?? []).map((item) => [item.name, item]));
check('pavúk: miesta zo SmartArt schémy', ['Konateľ', 'Hlavná účtovníčka', 'Vedúci výroby', 'Majster'].every((name) => pos[name]), JSON.stringify(Object.keys(pos)));
check('pavúk: útvar oddelený od miesta', (w.units ?? []).some((unit) => unit.name === 'Ekonomické oddelenie') && !pos['Ekonomické oddelenie']);
check('pavúk: podriadenosť a útvar', pos['Hlavná účtovníčka']?.reportsToKey === 'konatel' && pos['Hlavná účtovníčka']?.unitKey === 'ekonomicke oddelenie' && pos['Majster']?.reportsToKey === 'veduci vyroby',
  JSON.stringify(pos['Hlavná účtovníčka']));
check('pavúk: meno osoby oddelené od miesta', pos['Konateľ']?.holder === 'Ing. Peter Horváth' && pos['Hlavná účtovníčka']?.holder === 'Jana Malá');
check('zhoda s existujúcim miestom', pos['Konateľ']?.existing?.id === existingBoss.id && pos['Majster']?.existing === null);
check('citácia zdroja', pos['Majster']?.source?.file === 'Smernica nákupu.docx' && pos['Majster']?.source?.location === 'diagram 1' && pos['Majster']?.source?.quote === 'Majster');
const proc = Object.fromEntries((w.processes ?? []).map((item) => [item.draft.name, item]));
check('procesy z nadpisov (bez organizačnej časti)', proc['Nákup materiálu'] && proc['Príjem na sklad'] && (w.processes ?? []).length === 2, JSON.stringify(Object.keys(proc)));
const buying = proc['Nákup materiálu']?.draft;
check('proces: spúšťač a rozhodnutie', buying?.trigger === 'Výroba nahlási potrebu materiálu' && buying?.nodes?.some((node) => node.type === 'gateway' && node.name === 'Je suma nad 1000 €?'),
  JSON.stringify(buying?.nodes?.map((node) => node.name)));
check('proces: rola z pavúka pri vetve', buying?.nodes?.some((node) => node.name.startsWith('Schváli ju vedúci výroby') && node.role === 'Vedúci výroby'), JSON.stringify(buying?.nodes));
const receiving = proc['Príjem na sklad'];
check('proces z tabuľky krokov s rolami', receiving?.draft?.nodes?.filter((node) => node.role === 'Skladník').length === 2 && receiving?.source?.location?.startsWith('odsek'), JSON.stringify(receiving?.draft?.nodes));
check('proces: citácia sekcie', proc['Nákup materiálu']?.source?.quote?.includes('Proces začína'));

// --- Excel, CSV, obrázok ---
const excel = await analyze('organizacia.xlsx', xlsx, owner);
const xpos = Object.fromEntries((excel.payload?.positions ?? []).map((item) => [item.name, item]));
check('Excel: miesta s útvarom, nadriadeným a menom', excel.payload?.format === 'xlsx' && xpos['Obchodník']?.unitKey === 'obchod' && xpos['Obchodník']?.reportsToKey === 'obchodny riaditel' && xpos['Obchodný riaditeľ']?.holder === 'Martin Kováč',
  JSON.stringify(excel.payload?.positions ?? excel.payload));
check('Excel: nadriadený mimo tabuľky podľa názvu', xpos['Obchodný riaditeľ']?.reportsToKey === 'konatel');
check('Excel: citácia hárku a riadku', xpos['Obchodník']?.source?.location === 'hárok „Organizácia“, riadok 3');
const csvResult = await analyze('ludia.csv', csv, owner);
check('CSV so stredníkom a úvodzovkami', csvResult.payload?.positions?.[0]?.name === 'Personalistka' && csvResult.payload?.positions?.[0]?.holder === 'Zuzana Biela' && csvResult.payload?.units?.[0]?.name === 'Personalistika',
  JSON.stringify(csvResult.payload));
const image = await analyze('pavuk.png', png, owner);
check('obrázok: len s AI (upozornenie)', image.status === 200 && image.payload?.format === 'image' && image.payload?.warnings?.some((warning) => warning.includes('AI')));
check('AI bez zapnutia → 403', (await analyze('pavuk.png', png, owner, '?ai=1')).status === 403);

// --- izolácia a oprávnenia ---
const foreign = await analyze('Smernica nákupu.docx', docx, b.token);
check('iná firma: bez zhody s cudzími miestami', foreign.payload?.positions?.find((item) => item.name === 'Konateľ')?.existing === null);
check('schvaľovateľ neimportuje → 403', (await analyze('Smernica nákupu.docx', docx, jana)).status === 403);

// --- nebezpečné a neplatné súbory ---
check('neznámy formát → 400', (await analyze('virus.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]), owner)).status === 400);
check('ZIP bez dokumentu → 400', (await analyze('archiv.zip', zip([{ name: 'a.txt', data: 'x' }]), owner)).status === 400);
check('podvrhnutá prípona (PNG ako .docx) → obrázok', (await analyze('smernica.docx', png, owner)).payload?.format === 'image');
check('DOCTYPE (XXE) → 400', (await analyze('xxe.docx', zip([{ name: 'word/document.xml', data: '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><w:document><w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>' }]), owner)).status === 400);
const bomb = zip([{ name: 'word/document.xml', data: Buffer.alloc(30 * 1024 * 1024), deflate: true }]);
check('zip bomba (deklarovaná veľkosť) → 400', bomb.length < 200000 && (await analyze('bomba.docx', bomb, owner)).status === 400, `${bomb.length}`);
const liar = zip([{ name: 'word/document.xml', data: Buffer.alloc(27 * 1024 * 1024), deflate: true, declaredSize: 1000 }]);
check('zip bomba (klamlivá hlavička) → 400', (await analyze('klamar.docx', liar, owner)).status === 400);
check('súbor nad 20 MB → 413', (await analyze('velky.txt', Buffer.alloc(21 * 1024 * 1024, 0x61), owner)).status === 413);
check('prázdny súbor → 400', (await analyze('prazdny.txt', Buffer.alloc(0), owner)).status === 400);

// --- potvrdenie: nič sa nevytvorí bez neho ---
const before = (await call(org('/positions'), { token: owner })).payload ?? [];
check('rozbor nič nevytvoril', before.length === 1);
const units = [...(w.units ?? []), ...(excel.payload?.units ?? [])];
const positions = [...(w.positions ?? []), ...(excel.payload?.positions ?? [])];
check('editor nové miesta nevytvorí → 403', (await call('/import/apply', { method: 'POST', body: { positions }, token: eva })).status === 403);
const applied = await call('/import/apply', {
  method: 'POST',
  token: owner,
  body: { units, positions, createPeople: true, createMissingRoles: true, processes: (w.processes ?? []).map((item) => ({ draft: item.draft, ownerRole: 'Vedúci výroby', source: item.source })) }
});
check('import potvrdený', applied.status === 201 && applied.payload?.units?.created === 3 && applied.payload?.positions?.merged === 1 && applied.payload?.processes?.length === 2,
  `${applied.status} ${JSON.stringify(applied.payload)}`);
const after = (await call(org('/positions'), { token: owner })).payload ?? [];
const byName = Object.fromEntries(after.map((item) => [item.name, item]));
check('existujúce miesto sa nezdvojilo', after.filter((item) => item.name === 'Konateľ').length === 1);
check('podriadenosť k existujúcemu miestu', byName['Hlavná účtovníčka']?.reportsToId === existingBoss.id && byName['Obchodný riaditeľ']?.reportsToId === existingBoss.id && byName['Majster']?.reportsToId === byName['Vedúci výroby']?.id);
check('miesto v útvare', byName['Hlavná účtovníčka']?.unitName === 'Ekonomické oddelenie' && byName['Obchodník']?.unitName === 'Obchod');
check('osoby s obsadením (na výslovnú voľbu)', byName['Hlavná účtovníčka']?.holders?.[0]?.name === 'Jana Malá' && byName['Konateľ']?.holders?.[0]?.name === 'Ing. Peter Horváth');
check('chýbajúca rola z procesu ako miesto', Boolean(byName['Referent nákupu']));
const created = applied.payload?.processes?.find((item) => item.name === 'Nákup materiálu');
const detail = (await call(`/processes/${created?.id}`, { token: owner })).payload;
check('proces je len návrh', detail?.publication?.latestRevision === 0 && detail?.diagramType === 'BPMN' && detail?.ownerPosition?.name === 'Vedúci výroby', JSON.stringify(detail?.publication));
check('kroky s RACI podľa miest', detail?.activities?.find((step) => step.title.startsWith('Referent nákupu pripraví'))?.raci?.[0]?.positionId === byName['Referent nákupu']?.id);
const history = (await call(`/processes/${created?.id}/history`, { token: owner })).payload ?? [];
check('pôvod v histórii s miestom v dokumente', history.some((item) => item.changedFields?.povod?.to === 'Smernica nákupu.docx — odsek 1'), JSON.stringify(history.map((item) => item.changedFields)));

const again = await call('/import/apply', { method: 'POST', body: { units, positions, createPeople: true }, token: owner });
const afterAgain = (await call(org('/positions'), { token: owner })).payload ?? [];
const people = (await call(org('/people'), { token: owner })).payload ?? [];
check('opakovaný import zlúči (nič nové)', again.status === 201 && again.payload?.units?.created === 0 && again.payload?.positions?.created === 0 && again.payload?.people === 0 && afterAgain.length === after.length,
  JSON.stringify(again.payload));
check('osoba bez zdvojeného obsadenia', people.filter((person) => person.name === 'Jana Malá').length === 1 && people.find((person) => person.name === 'Jana Malá')?.assignments?.length === 1);
check('editor smie importovať len procesy', (await call('/import/apply', { method: 'POST', body: { processes: [{ draft: receiving.draft }] }, token: eva })).status === 201);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(55)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
