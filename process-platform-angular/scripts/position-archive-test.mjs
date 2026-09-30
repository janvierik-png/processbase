/**
 * Dopad zmeny miesta a archivacia (#43 GRAPH-01, scenar 8) so syntetickymi udajmi.
 *
 * Pred archivaciou sa ukazu dotknute procesy (vlastnik, vykonavatel, RACI kroku),
 * platne verzie, ludia a dokumenty. Archivacia vlastnika ticho nezmaze — proces
 * ostane s archivovanym (neobsadenym) miestom a ukaze sa v Prehlade. Historicke
 * schvalenia ostavaju dostupne auditorovi. Pouzite miesto sa nemaze.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/position-archive-test.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, { method = 'GET', body, token, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const binary = body instanceof Uint8Array;
  if (body !== undefined && !binary) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : binary ? body : JSON.stringify(body) });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

const dayOffset = (days) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' })
  .format(new Date(Date.now() + days * 86400000));

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { acceptTerms: true, organizationName: `Org Test archivacia ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-arch-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-arch-${label}-${STAMP}@example.test`, roleId }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}
const jana = await member('Jana', 'approver');
const eva = await member('Eva', 'quality');
const auditor = await member('Auditor', 'iso');
const people = (await call(org('/people'), { token: owner })).payload ?? [];
const personId = (name) => people.find((person) => person.name === name)?.id;

const head = (await call(org('/positions'), { method: 'POST', body: { name: 'Vedúci skladu' }, token: owner })).payload;
const unused = (await call(org('/positions'), { method: 'POST', body: { name: 'Nepoužité miesto' }, token: owner })).payload;
const other = (await call(org('/positions'), { method: 'POST', body: { name: 'Skladník' }, token: owner })).payload;
await call(`/positions/${head.id}/assignments`, { method: 'POST', body: { personId: personId('Jana'), validFrom: dayOffset(-30) }, token: owner });
await call(`/positions/${head.id}/assignments`, { method: 'POST', body: { personId: personId('Eva'), validFrom: dayOffset(10) }, token: owner });

async function makeProcess(name, patch, steps = [{ title: 'Krok' }]) {
  const proc = (await call(org('/processes'), { method: 'POST', body: { name, type: 'process' }, token: owner })).payload;
  await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: `Účel ${name}`, ...patch }, token: owner });
  await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: steps }, token: owner });
  return proc;
}
const owned = await makeProcess('Príjem tovaru', { ownerPositionId: head.id });
const performed = await makeProcess('Inventúra', { ownerPositionId: other.id, positionIds: [head.id] });
const stepOnly = await makeProcess('Expedícia', { ownerPositionId: other.id }, [{ title: 'Kontrola balenia', raci: [{ role: 'R', positionId: head.id }] }]);
const later = await makeProcess('Reklamácie', { ownerPositionId: other.id });

// v1 cez schvalenie — Jana rozhoduje ako Vedúci skladu
await call(org(''), { method: 'PATCH', body: { requireApproval: true }, token: owner });
const request = (await call(`/processes/${owned.id}/approval-requests`, { method: 'POST', body: {}, token: eva })).payload;
check('v1 schvalena Janou', (await call(`/approval-requests/${request?.id}/approve`, { method: 'POST', body: { comment: 'OK' }, token: jana })).status === 200);

const doc = (await call(`/processes/${owned.id}/documents`, {
  method: 'POST', token: owner, body: new TextEncoder().encode('obsah'),
  headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('Postup príjmu.pdf'), 'X-File-Type': 'application/pdf' }
})).payload;
await call(`/documents/${doc.id}`, { method: 'PATCH', body: { ownerPositionId: head.id }, token: owner });

// --- dopad pred archivaciou ---
const impact = (await call(`/positions/${head.id}/impact`, { token: owner })).payload;
const roles = Object.fromEntries((impact?.processes ?? []).map((item) => [item.name, item.roles.join(', ')]));
check('dopad: vlastnik, vykonavatel aj krok', roles['Príjem tovaru'] === 'vlastník' && roles['Inventúra'] === 'vykonávateľ' && roles['Expedícia']?.includes('krok 1 „Kontrola balenia“ (R)'),
  JSON.stringify(roles));
check('dopad: kto ostane bez vlastnika', JSON.stringify(impact?.ownerless) === JSON.stringify(['Príjem tovaru']), JSON.stringify(impact?.ownerless));
check('dopad: platna verzia s miestom', impact?.versions?.some((item) => item.name === 'Príjem tovaru' && item.revision === 1));
check('dopad: kto miesto dnes zastava', impact?.holders?.map((holder) => holder.name).join() === 'Jana');
check('dopad: dokument, ktoreho je vlastnikom', impact?.documents?.some((item) => item.id === doc.documentId));
check('ina firma dopad nevidi → 404', (await call(`/positions/${head.id}/impact`, { token: b.token })).status === 404);

// --- pouzite miesto sa nemaze ---
check('pouzite miesto zmazat nejde → 409', (await call(`/positions/${head.id}`, { method: 'DELETE', token: owner })).status === 409);
check('nepouzite miesto zmazat ide', (await call(`/positions/${unused.id}`, { method: 'DELETE', token: owner })).status === 204);

// --- archivacia az po potvrdeni ---
check('bez potvrdenia → 400', (await call(`/positions/${head.id}/archive`, { method: 'POST', body: {}, token: owner })).status === 400);
check('ina firma nearchivuje → 404', (await call(`/positions/${head.id}/archive`, { method: 'POST', body: { confirm: true }, token: b.token })).status === 404);
check('editor procesov nearchivuje → 403', (await call(`/positions/${head.id}/archive`, { method: 'POST', body: { confirm: true }, token: eva })).status === 403);
const archived = await call(`/positions/${head.id}/archive`, { method: 'POST', body: { confirm: true }, token: owner });
check('archivovane po potvrdeni', archived.status === 200 && archived.payload?.position?.archived === true, `${archived.status} ${archived.payload?.message}`);

const positions = (await call(org('/positions'), { token: owner })).payload ?? [];
const headAfter = positions.find((item) => item.id === head.id);
check('miesto oznacene ako archivovane a dnes neobsadene', headAfter?.archived === true && headAfter?.vacant === true, JSON.stringify(headAfter));
const peopleAfter = (await call(org('/people'), { token: owner })).payload ?? [];
const evaAfter = peopleAfter.find((person) => person.name === 'Eva');
const janaAfter = peopleAfter.find((person) => person.name === 'Jana');
check('buduce obsadenie zrusene', evaAfter && !(evaAfter.assignments ?? []).some((item) => item.positionId === head.id), JSON.stringify(evaAfter?.assignments));
check('Janino obsadenie ukoncene vcerajskom (historia ostava)', (janaAfter?.assignments ?? []).some((item) => item.positionId === head.id && item.validTo === dayOffset(-1)), JSON.stringify(janaAfter?.assignments));

// vlastnik sa ticho nestratil
const detail = (await call(`/processes/${owned.id}`, { token: owner })).payload;
check('proces ma stale vlastnika — archivovane miesto', detail?.ownerPosition?.id === head.id && detail.ownerPosition.archived === true && detail.ownerPosition.vacant === true,
  JSON.stringify(detail?.ownerPosition));
const effective = (await call(`/processes/${owned.id}?view=effective`, { token: owner })).payload;
check('platna verzia ukazuje nazov miesta', effective?.ownerPosition?.name === 'Vedúci skladu');
const overview = (await call('/overview', { token: owner })).payload;
const vacant = overview?.categories?.find((category) => category.key === 'vacant')?.items ?? [];
check('prehlad: neobsadeny vlastnik s archivovanym miestom', vacant.some((item) => item.id === owned.id && item.detail.includes('Vedúci skladu (archivované miesto) — vlastník')),
  JSON.stringify(vacant.map((item) => item.detail)));

// historicke schvalenie pre auditora
const approvals = (await call(`/processes/${owned.id}/approval-requests`, { token: auditor })).payload ?? [];
check('auditor vidi historicke schvalenie s miestom', approvals.some((item) => item.decision?.by === 'Jana' && item.decision?.positions === 'Vedúci skladu'), JSON.stringify(approvals.map((item) => item.decision)));

let evasBox = null;
for (let attempt = 0; attempt < 30; attempt++) {
  evasBox = (await call('/me/notifications', { token: eva })).payload;
  if ((evasBox?.items ?? []).some((item) => item.type === 'PositionArchived')) break;
  await sleep(200);
}
check('editorom upozornenie o archivacii', (evasBox?.items ?? []).some((item) => item.type === 'PositionArchived' && item.body?.includes('bez vlastníka: Príjem tovaru')));

// --- archivovane miesto nove vazby nedostava ---
await call(org(''), { method: 'PATCH', body: { requireApproval: false }, token: owner });
check('novy vlastnik = archivovane miesto → 400', (await call(`/processes/${later.id}`, { method: 'PATCH', body: { ownerPositionId: head.id }, token: owner })).status === 400);
check('existujuca vazba sa da ulozit znova', (await call(`/processes/${owned.id}`, { method: 'PATCH', body: { ownerPositionId: head.id, purpose: 'Upravený účel' }, token: owner })).status === 200);
check('nove RACI na archivovane miesto → 400', (await call(`/processes/${later.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'X', raci: [{ role: 'R', positionId: head.id }] }] }, token: owner })).status === 400);
check('existujuce RACI kroku ostava', (await call(`/processes/${stepOnly.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Kontrola balenia', raci: [{ role: 'R', positionId: head.id }] }] }, token: owner })).status === 200);
check('obsadit archivovane miesto → 409', (await call(`/positions/${head.id}/assignments`, { method: 'POST', body: { personId: personId('Jana') }, token: owner })).status === 409);

// --- obnovenie ---
check('obnovenie miesta', (await call(`/positions/${head.id}/restore`, { method: 'POST', body: {}, token: owner })).payload?.archived === false);
check('po obnoveni sa da obsadit', (await call(`/positions/${head.id}/assignments`, { method: 'POST', body: { personId: personId('Jana') }, token: owner })).status === 201);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(50)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
