/**
 * Import BPMN z bezplatneho modelera do workspace (#39 LINK-01, scenar 13).
 *
 * Diagram vznikne ako NAVRH s povodnym XML bez zmeny. Bez nazvu, ucelu a vlastnika
 * sa proces nevytvori a publikovat sa neda, kym nema povinne udaje (kroky).
 *
 * Spustenie:  docker exec process-platform-angular-api-1 sh -c "cd /app && node scripts/bpmn-import-test.mjs"
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const here = path.dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(path.join(here, 'fixtures', 'objednavka.bpmn'), 'utf8');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

async function call(url, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { organizationName: `Org Test import ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-import-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
  });
  return { token: reg.payload?.token, orgId: reg.payload?.organization?.id };
}

async function member(orgId, ownerToken, roleId) {
  const invitation = (await call(`/organizations/${orgId}/invitations`, { method: 'POST', body: { email: `orgtest-import-${roleId}-${STAMP}@example.test`, roleId }, token: ownerToken })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: roleId, password: 'Heslo123456' } })).payload?.token;
}

const a = await register('a');
const b = await register('b');
if (!a.token || !b.token) {
  console.error('Testovacie firmy sa nepodarilo zalozit — bezi API?');
  process.exit(2);
}
const importUrl = `/organizations/${a.orgId}/processes/import-bpmn`;
const base = { bpmnXml: xml, name: 'Spracovanie objednávky', purpose: 'Objednávka sa vybaví do 48 hodín.', sourceFileName: 'objednavka.bpmn' };

// --- povinne udaje a bezpecny vstup ---
const noPurpose = await call(importUrl, { method: 'POST', body: { ...base, purpose: '', newPositionName: 'Obchodník' }, token: a.token });
check('bez ucelu sa proces nevytvori', noPurpose.status === 400 && /ucel/.test(noPurpose.payload?.message), noPurpose.payload?.message);
const noOwner = await call(importUrl, { method: 'POST', body: base, token: a.token });
check('bez vlastnika sa proces nevytvori', noOwner.status === 400 && /vlastnik/.test(noOwner.payload?.message));
const dtd = await call(importUrl, { method: 'POST', body: { ...base, newPositionName: 'X', bpmnXml: `<!DOCTYPE x [<!ENTITY a "a">]>${xml}` }, token: a.token });
check('DTD odmietnute', dtd.status === 400);
const notBpmn = await call(importUrl, { method: 'POST', body: { ...base, newPositionName: 'X', bpmnXml: '<html></html>' }, token: a.token });
check('nie BPMN odmietnute', notBpmn.status === 400);

// --- import ako navrh s povodnym XML ---
const imported = await call(importUrl, { method: 'POST', body: { ...base, newPositionName: 'Obchodník' }, token: a.token });
const proc = imported.payload;
check('proces vytvoreny', imported.status === 201, imported.payload?.message);
check('je to navrh, nic nepublikovane', proc?.status === 'Návrh' && proc?.publication?.latestRevision === 0);
check('povodne XML bez zmeny (bajt po bajte)', proc?.bpmnXml === xml);
check('diagram typu BPMN', proc?.diagramType === 'BPMN');
check('vlastnik podla miesta', proc?.ownerPosition?.name === 'Obchodník');
check('kroky sa z diagramu nevymyslia', (proc?.activities ?? []).length === 0);
const history = (await call(`/processes/${proc?.id}/history`, { token: a.token })).payload ?? [];
check('povod importu v audite', history.some((entry) => /bezplatneho modelera \(objednavka\.bpmn\)/.test(entry.changedFields?.import?.to ?? '')));

// --- bez doplnenia povinnych udajov sa neda publikovat ---
const publish = await call(`/processes/${proc?.id}/publish`, { method: 'POST', body: {}, token: a.token });
check('publikovanie bez krokov odmietnute', publish.status === 400 && /krok/.test(publish.payload?.message), publish.payload?.message);

// --- opravnenia a izolacia ---
const approver = await member(a.orgId, a.token, 'approver');
check('schvalovatel neimportuje', (await call(importUrl, { method: 'POST', body: { ...base, ownerPositionId: proc?.ownerPosition?.id }, token: approver })).status === 403);
const quality = await member(a.orgId, a.token, 'quality');
check('manazer kvality nezaklada miesto', (await call(importUrl, { method: 'POST', body: { ...base, newPositionName: 'Nové miesto' }, token: quality })).status === 403);
check('manazer kvality importuje s existujucim miestom', (await call(importUrl, { method: 'POST', body: { ...base, ownerPositionId: proc?.ownerPosition?.id }, token: quality })).status === 201);
const foreignPosition = (await call(`/organizations/${b.orgId}/positions`, { method: 'POST', body: { name: 'Cudzie miesto' }, token: b.token })).payload;
check('miesto inej firmy ako vlastnik odmietnute', (await call(importUrl, { method: 'POST', body: { ...base, ownerPositionId: foreignPosition?.id }, token: a.token })).status === 404);
check('firma B neimportuje do firmy A', (await call(importUrl, { method: 'POST', body: { ...base, newPositionName: 'X' }, token: b.token })).status === 404);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
