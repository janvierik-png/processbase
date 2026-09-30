/**
 * Riadene dokumenty s verziami (#31 DOC-02) so syntetickymi udajmi.
 *
 * Akceptacia: nova verzia dokumentu nezmeni snapshot v1 procesu — citatel v1
 * dostane stale verziu dokumentu, ktora platila pri publikovani. Navrh procesu
 * dostane novu verziu (a teda zmenu na publikovanie), naplanovana verzia az od
 * svojej ucinnosti. Kvota zahrna vsetky verzie.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/document-versions-test.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, { method = 'GET', body, token, headers: extra = {}, raw = false } = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const binary = body instanceof Uint8Array;
  if (body !== undefined && !binary) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : binary ? body : JSON.stringify(body) });
  const payload = raw ? Buffer.from(await response.arrayBuffer()).toString() : await response.json().catch(() => null);
  return { status: response.status, payload };
}

const dayOffset = (days) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' })
  .format(new Date(Date.now() + days * 86400000));
const file = (text) => new TextEncoder().encode(text);
const fileHeaders = (name, extra = {}) => ({ 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), 'X-File-Type': 'application/pdf', ...extra });

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { acceptTerms: true, organizationName: `Org Test dokumenty ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-dok-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-dok-peter-${STAMP}@example.test`, roleId: 'iso' }, token: owner })).payload;
const peter = (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: 'Peter', password: 'Heslo123456' } })).payload?.token;
const people = (await call(org('/people'), { token: owner })).payload ?? [];
const head = (await call(org('/positions'), { method: 'POST', body: { name: 'Vedúci kvality' }, token: owner })).payload;
await call(`/positions/${head.id}/assignments`, { method: 'POST', body: { personId: people.find((person) => person.name === 'Peter')?.id, validFrom: dayOffset(-5) }, token: owner });

const proc = (await call(org('/processes'), { method: 'POST', body: { name: 'Reklamácie', type: 'process' }, token: owner })).payload;
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Reklamácie sa vybavia včas.', ownerPositionId: head.id }, token: owner });
await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Posúdenie' }] }, token: owner });

// --- v1 dokumentu, v1 procesu ---
const v1 = (await call(`/processes/${proc.id}/documents`, { method: 'POST', body: file('obsah verzie 1'), token: owner, headers: fileHeaders('Reklamačný poriadok.pdf') })).payload;
check('nahraty dokument = verzia 1', v1?.version === 1 && v1?.documentId && v1?.effectiveFrom === dayOffset(0), JSON.stringify(v1));
check('proces v1 publikovany', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: owner })).status === 201);

// --- nova verzia dokumentu ---
const v2 = await call(`/documents/${v1.id}/versions`, {
  method: 'POST', body: file('obsah verzie 2 — nove lehoty'), token: owner,
  headers: fileHeaders('Reklamačný poriadok 2026.pdf', { 'X-Change-Note': encodeURIComponent('Nové lehoty') })
});
check('nova verzia dokumentu v2', v2.status === 201 && v2.payload?.version === 2 && v2.payload?.documentId === v1.documentId, JSON.stringify(v2.payload));

// akceptacia: snapshot v1 procesu sa nezmenil
const effective = (await call(`/processes/${proc.id}?view=effective`, { token: owner })).payload;
check('v1 procesu stale odkazuje na v1 dokumentu', effective?.documents?.length === 1 && effective.documents[0].id === v1.id && effective.documents[0].version === 1,
  JSON.stringify(effective?.documents));
check('v1 procesu vie o novsej verzii dokumentu', effective?.documents?.[0]?.newerVersion === 2);
check('stiahnutie z v1 da obsah verzie 1', (await call(`/documents/${v1.id}/download`, { token: owner, raw: true })).payload === 'obsah verzie 1');

// navrh dostal novu verziu
const draftDocs = (await call(`/processes/${proc.id}/documents`, { token: owner })).payload ?? [];
check('navrh ma platnu verziu v2 (jeden dokument)', draftDocs.length === 1 && draftDocs[0].id === v2.payload.id && draftDocs[0].versionCount === 2, JSON.stringify(draftDocs));
check('navrh ma zmenu na publikovanie', (await call(`/processes/${proc.id}`, { token: owner })).payload?.publication?.hasDraftChanges === true);

const overview = (await call('/overview', { token: owner })).payload;
const stale = overview?.categories?.find((category) => category.key === 'staleDocuments');
check('prehlad: dokument po ucinnosti', stale?.items?.some((item) => item.id === proc.id && item.detail.includes('v1, platí v2')), JSON.stringify(stale?.items));

let petersBox = null;
for (let attempt = 0; attempt < 30; attempt++) {
  petersBox = (await call('/me/notifications', { token: peter })).payload;
  if ((petersBox?.items ?? []).some((item) => item.type === 'DocumentSuperseded')) break;
  await sleep(200);
}
check('upozornenie vlastnikovi: nova verzia dokumentu', (petersBox?.items ?? []).some((item) => item.type === 'DocumentSuperseded' && item.body?.includes('odkazuje na v1')),
  JSON.stringify(petersBox?.items?.map((item) => item.title)));

// --- verzie dokumentu ---
const versions = (await call(`/documents/${v2.payload.id}/versions`, { token: owner })).payload;
const byVersion = Object.fromEntries((versions?.versions ?? []).map((item) => [item.version, item]));
check('zoznam verzii so stavom', byVersion[2]?.state === 'current' && byVersion[1]?.state === 'superseded' && byVersion[2]?.changeNote === 'Nové lehoty');
check('v1 dokumentu pouziva v1 procesu', byVersion[1]?.usedIn?.some((use) => use.revision === 1 && use.processName === 'Reklamácie'));

// --- prevzatie a naplanovana verzia ---
check('proces v2 prevzal novu verziu', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { changeReason: 'Nový reklamačný poriadok' }, token: owner })).status === 201);
const v3 = await call(`/documents/${v1.id}/versions`, { method: 'POST', body: file('verzia 3'), token: owner, headers: fileHeaders('Poriadok v3.pdf', { 'X-Effective-From': dayOffset(5) }) });
check('naplanovana verzia v3', v3.status === 201 && v3.payload?.effectiveFrom === dayOffset(5));
check('naplanovana verzia nemeni navrh', (await call(`/processes/${proc.id}`, { token: owner })).payload?.publication?.hasDraftChanges === false);
const listed = (await call(`/processes/${proc.id}/documents`, { token: owner })).payload?.[0];
check('zoznam: plati v2, naplanovana v3', listed?.version === 2 && listed?.nextVersion?.version === 3 && listed.nextVersion.effectiveFrom === dayOffset(5), JSON.stringify(listed));

// --- validacia a opravnenia ---
check('ucinnost v minulosti → 400', (await call(`/documents/${v1.id}/versions`, { method: 'POST', body: file('x'), token: owner, headers: fileHeaders('x.pdf', { 'X-Effective-From': dayOffset(-1) }) })).status === 400);
check('skor nez posledna verzia → 400', (await call(`/documents/${v1.id}/versions`, { method: 'POST', body: file('x'), token: owner, headers: fileHeaders('x.pdf', { 'X-Effective-From': dayOffset(2) }) })).status === 400);
check('ina firma → 404', (await call(`/documents/${v1.id}/versions`, { method: 'POST', body: file('x'), token: b.token, headers: fileHeaders('x.pdf') })).status === 404);
check('ina firma verzie nevidi → 404', (await call(`/documents/${v1.id}/versions`, { token: b.token })).status === 404);
check('ISO auditor novu verziu nenahra → 403', (await call(`/documents/${v1.id}/versions`, { method: 'POST', body: file('x'), token: peter, headers: fileHeaders('x.pdf') })).status === 403);

// --- kvota a mazanie ---
const storage = (await call(org('/storage'), { token: owner })).payload;
const expected = ['obsah verzie 1', 'obsah verzie 2 — nove lehoty', 'verzia 3'].reduce((sum, text) => sum + file(text).length, 0);
check('kvota zahrna vsetky verzie', storage?.usedBytes === expected, `${storage?.usedBytes} vs ${expected}`);
check('verziu v publikovanom procese zmazat nejde → 409', (await call(`/documents/${v1.id}`, { method: 'DELETE', token: owner })).status === 409);
check('naplanovanu verziu zmazat ide', (await call(`/documents/${v3.payload.id}`, { method: 'DELETE', token: owner })).status === 204);
check('archivacia dokumentu', (await call(`/documents/${v2.payload.id}`, { method: 'PATCH', body: { status: 'archived', ownerPositionId: head.id }, token: owner })).status === 200);
check('archivovany nove verzie nedostava → 409', (await call(`/documents/${v1.id}/versions`, { method: 'POST', body: file('x'), token: owner, headers: fileHeaders('x.pdf') })).status === 409);
const archived = (await call(`/documents/${v1.id}/versions`, { token: owner })).payload;
check('stav a vlastnik dokumentu', archived?.status === 'archived' && archived?.ownerPosition?.name === 'Vedúci kvality');

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(48)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
