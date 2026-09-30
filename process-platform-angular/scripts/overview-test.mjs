/**
 * Prehlad firmy (#34 UX-01b) so syntetickymi udajmi.
 *
 * Kazdy proces ma prave jeden problem a musi sa objavit prave v jeho karte
 * s citatelnym popisom, co chyba. Pocet na karte = dlzka zoznamu. Revizia po
 * termine sa overuje k buducemu dnu (?at=), lebo termin v minulosti sa zadat neda.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/overview-test.mjs
 */
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

const dayOffset = (days) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' })
  .format(new Date(Date.now() + days * 86400000));

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { acceptTerms: true, organizationName: `Org Test prehlad ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-prehlad-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
const org = (path, id = a.orgId) => `/organizations/${id}${path}`;

// obsadene miesto pre „zdrave“ procesy
const people = (await call(org('/people'), { token: owner })).payload ?? [];
const held = (await call(org('/positions'), { method: 'POST', body: { name: 'Obsadené miesto' }, token: owner })).payload;
await call(`/positions/${held.id}/assignments`, { method: 'POST', body: { personId: people[0]?.id, validFrom: dayOffset(-10) }, token: owner });
const empty = (await call(org('/positions'), { method: 'POST', body: { name: 'Prázdne miesto' }, token: owner })).payload;

async function makeProcess(name, { ownerPositionId = held.id, steps = [{ title: 'Krok' }], publish = false, publishBody = {} } = {}) {
  const proc = (await call(org('/processes'), { method: 'POST', body: { name, type: 'process' }, token: owner })).payload;
  await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: `Účel ${name}`, ...(ownerPositionId ? { ownerPositionId } : {}) }, token: owner });
  if (steps) await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: steps }, token: owner });
  if (publish) await call(`/processes/${proc.id}/publish`, { method: 'POST', body: publishBody, token: owner });
  return proc;
}

const healthy = await makeProcess('Zdravý', { publish: true });
const review = await makeProcess('Revízia', { publish: true, publishBody: { nextReviewAt: dayOffset(10) } });
const ownerless = await makeProcess('Bez vlastníka', { ownerPositionId: null });
const vacantOwner = await makeProcess('Neobsadený vlastník', { ownerPositionId: empty.id, publish: true });
const vacantStep = await makeProcess('Neobsadený krok', { publish: true, steps: [{ title: 'Kontrola', raci: [{ role: 'R', positionId: empty.id }] }] });
const draft = await makeProcess('Len návrh');
const changed = await makeProcess('Zmenený', { publish: true });
await call(`/processes/${changed.id}`, { method: 'PATCH', body: { purpose: 'Nový účel' }, token: owner });
const approval = await makeProcess('Na schválení', { publish: true });
await call(`/processes/${approval.id}`, { method: 'PATCH', body: { purpose: 'Navrhovaný účel' }, token: owner });
const submitted = await call(`/processes/${approval.id}/approval-requests`, { method: 'POST', body: { changeReason: 'Zmena účelu' }, token: owner });
check('ziadost o schvalenie odoslana', submitted.status === 201, `${submitted.status} ${submitted.payload?.message}`);
await call(org('/processes'), { method: 'POST', body: { name: 'Skupina', type: 'folder' }, token: owner });
await call(org('/processes', b.orgId), { method: 'POST', body: { name: 'Cudzí proces', type: 'process' }, token: b.token });

const overview = await call('/overview', { token: owner });
check('prehlad sa nacita', overview.status === 200, overview.payload?.message);
const byKey = Object.fromEntries((overview.payload?.categories ?? []).map((category) => [category.key, category]));
const ids = (key) => (byKey[key]?.items ?? []).map((item) => item.id);
const only = (key, expected) => {
  const got = ids(key);
  return got.length === expected.length && expected.every((proc) => got.includes(proc.id));
};

check('pocet na karte = dlzka zoznamu', Object.values(byKey).every((category) => category.count === category.items.length));
check('len procesy (bez skupin), len vlastna firma', overview.payload?.processCount === 8, `processCount ${overview.payload?.processCount}`);
check('cudzi proces nie je v ziadnej karte', !Object.values(byKey).some((category) => category.items.some((item) => item.name === 'Cudzí proces')));

check('revizia do 30 dni', only('review', [review]), JSON.stringify(ids('review')));
check('revizia ma popis s terminom', byKey.review?.items?.[0]?.detail?.includes(dayOffset(10)) && byKey.review.items[0].overdue === false, byKey.review?.items?.[0]?.detail);
check('bez vlastnika', only('ownerless', [ownerless]), JSON.stringify(ids('ownerless')));
check('neobsadene: vlastnik aj krok', only('vacant', [vacantOwner, vacantStep]), JSON.stringify(ids('vacant')));
const stepDetail = byKey.vacant?.items?.find((item) => item.id === vacantStep.id)?.detail ?? '';
check('neobsadeny krok s cislom a rolou', stepDetail.includes('Prázdne miesto') && stepDetail.includes('krok 1 (R)'), stepDetail);
check('neuplny = chyba povinny udaj', only('incomplete', [ownerless]), JSON.stringify(byKey.incomplete?.items));
check('bez platnej verzie', only('unpublished', [ownerless, draft]), JSON.stringify(ids('unpublished')));
check('zmeny cakaju na publikovanie', only('pendingChanges', [changed]), JSON.stringify(ids('pendingChanges')));
check('caka na schvalenie (nie dvakrat ako zmena)', only('pendingApproval', [approval]), JSON.stringify(ids('pendingApproval')));
check('zdravy proces v ziadnej karte', !Object.values(byKey).some((category) => category.items.some((item) => item.id === healthy.id)));

// revizia po termine k buducemu dnu
const later = (await call(`/overview?at=${dayOffset(40)}`, { token: owner })).payload;
const lateReview = later?.categories?.find((category) => category.key === 'review')?.items?.find((item) => item.id === review.id);
check('k D+40 revizia po termine', lateReview?.overdue === true && lateReview.detail.startsWith('Revízia po termíne'), lateReview?.detail);
check('neplatny datum → 400', (await call('/overview?at=zajtra', { token: owner })).status === 400);
check('bez prihlasenia → 401', (await call('/overview')).status === 401);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
