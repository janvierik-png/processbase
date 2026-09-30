/**
 * RACI na kroku procesu (#29 CORE-03) so syntetickymi udajmi.
 *
 * Zodpovednost pri kroku patri pracovnemu miestu; kto ho zastava, sa odvodzuje
 * z obsadenia v case (scenar 2 — Jana do D, Peter od D+1). Konkretna osoba je
 * len vynimka a je tak oznacena. RACI je sucast publikovanej verzie a
 * „Moja praca" ukaze proces aj tomu, kto je zodpovedny len za krok.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/step-raci-test.mjs
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
    body: { acceptTerms: true, organizationName: `Org Test RACI ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-raci-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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

async function member(label) {
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-raci-${label}-${STAMP}@example.test`, roleId: 'iso' }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}
const jana = await member('Jana');
const peter = await member('Peter');
const people = (await call(org('/people'), { token: owner })).payload ?? [];
const personId = (name) => people.find((person) => person.name === name)?.id;
const external = (await call(org('/people'), { method: 'POST', body: { name: 'Externý daňový poradca' }, token: owner })).payload;

const accountant = (await call(org('/positions'), { method: 'POST', body: { name: 'Účtovník' }, token: owner })).payload;
const head = (await call(org('/positions'), { method: 'POST', body: { name: 'Vedúca kvality' }, token: owner })).payload;
// scenar 2: Jana zastava miesto Uctovnik do D (= o 2 dni), Peter od D+1
await call(`/positions/${accountant.id}/assignments`, { method: 'POST', body: { personId: personId('Jana'), validFrom: dayOffset(-30), validTo: dayOffset(2) }, token: owner });
await call(`/positions/${accountant.id}/assignments`, { method: 'POST', body: { personId: personId('Peter'), validFrom: dayOffset(3) }, token: owner });

const proc = (await call(org('/processes'), { method: 'POST', body: { name: 'Úhrada faktúr', type: 'process' }, token: owner })).payload;
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Faktúry sa uhradia včas.', ownerPositionId: head.id }, token: owner });
const put = (activities, token = owner) => call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities }, token });

// --- ulozenie RACI ---
const saved = await put([
  { title: 'Kontrola faktúry', raci: [{ role: 'R', positionId: accountant.id }, { role: 'A', positionId: head.id }] },
  { title: 'Konzultácia DPH', raci: [{ role: 'R', positionId: accountant.id }, { role: 'C', personId: external.id }] }
]);
check('kroky s RACI ulozene', saved.status === 200, `${saved.status} ${saved.payload?.message}`);
const steps = saved.payload?.activities ?? [];
const r1 = steps[0]?.raci ?? [];
check('R ukazuje dnesneho cloveka na mieste', r1.find((item) => item.role === 'R')?.holders?.join() === 'Jana', JSON.stringify(r1));
check('A na neobsadenom mieste je oznacene', r1.find((item) => item.role === 'A')?.vacant === true);
const c2 = (steps[1]?.raci ?? []).find((item) => item.role === 'C');
check('osoba ako vynimka je oznacena', c2?.exception === true && c2?.name === 'Externý daňový poradca', JSON.stringify(c2));

// --- validacia ---
const step = (raci) => [{ id: steps[0].id, title: 'Kontrola faktúry', raci }];
check('dve A na kroku → 400', (await put(step([{ role: 'A', positionId: head.id }, { role: 'A', positionId: accountant.id }]))).status === 400);
check('miesto aj osoba naraz → 400', (await put(step([{ role: 'R', positionId: head.id, personId: external.id }]))).status === 400);
check('bez miesta aj osoby → 400', (await put(step([{ role: 'R' }]))).status === 400);
check('neznama rola → 400', (await put(step([{ role: 'X', positionId: head.id }]))).status === 400);
const foreignPosition = (await call(org('/positions', b.orgId), { method: 'POST', body: { name: 'Cudzie miesto' }, token: b.token })).payload;
const foreignPerson = (await call(org('/people', b.orgId), { method: 'POST', body: { name: 'Cudzia osoba' }, token: b.token })).payload;
check('miesto inej firmy → 404', (await put(step([{ role: 'R', positionId: foreignPosition.id }]))).status === 404);
check('osoba inej firmy → 404', (await put(step([{ role: 'C', personId: foreignPerson.id }]))).status === 404);
check('ISO auditor kroky nemeni', (await put(step([]), jana)).status === 403);
const afterInvalid = (await call(`/processes/${proc.id}`, { token: owner })).payload;
check('neplatne ulozenia nic nezmenili', (afterInvalid?.activities?.[0]?.raci ?? []).length === 2);

// --- starsi klient bez `raci` zodpovednosti nezmaze ---
const legacy = await put([
  { id: steps[0].id, title: 'Kontrola faktúry do 2 dní' },
  { id: steps[1].id, title: 'Konzultácia DPH' }
]);
check('bez kluca raci ostava RACI kroku', (legacy.payload?.activities?.[0]?.raci ?? []).length === 2, JSON.stringify(legacy.payload?.activities?.[0]?.raci));

const history = (await call(`/processes/${proc.id}/history`, { token: owner })).payload ?? [];
const raciChange = history.find((change) => change.changedFields?.zodpovednostiKrokov);
check('zmena RACI v historii citatelne', (raciChange?.changedFields?.zodpovednostiKrokov?.to ?? []).some((line) => line.includes('R Účtovník') && line.includes('A Vedúca kvality')),
  JSON.stringify(raciChange?.changedFields?.zodpovednostiKrokov?.to));

// --- publikovanie: RACI je sucast verzie ---
check('v1 publikovana', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: owner })).status === 201);
check('po publikovani bez zmien', (await call(`/processes/${proc.id}`, { token: owner })).payload?.publication?.hasDraftChanges === false);
const today = (await call(`/processes/${proc.id}?view=effective`, { token: owner })).payload;
check('verzia: dnes vykonava Jana', today?.activities?.[0]?.raci?.find((item) => item.role === 'R')?.holders?.join() === 'Jana');
const later = (await call(`/processes/${proc.id}?view=effective&at=${dayOffset(5)}`, { token: owner })).payload;
check('verzia k D+3: vykonava Peter (scenar 2)', later?.activities?.[0]?.raci?.find((item) => item.role === 'R')?.holders?.join() === 'Peter',
  JSON.stringify(later?.activities?.[0]?.raci));

// --- Moja praca: aj zodpovednost len za krok ---
const petersWork = (await call(`/me/work?at=${dayOffset(5)}`, { token: peter })).payload;
const petersItem = petersWork?.processes?.find((item) => item.id === proc.id);
check('Peter vidi proces cez krok', petersItem?.roles?.some((role) => role.role === 'STEP' && role.raci === 'R' && role.step === 'Kontrola faktúry do 2 dní'), JSON.stringify(petersItem?.roles));
const janasWorkLater = (await call(`/me/work?at=${dayOffset(5)}`, { token: jana })).payload;
check('Jana ho po odchode z miesta nevidi', !janasWorkLater?.processes?.some((item) => item.id === proc.id));

// vynimka: krok priradeny priamo Petrovi (bez miesta) — vidi ho aj dnes
await put([
  { id: steps[0].id, title: 'Kontrola faktúry do 2 dní', raci: [{ role: 'R', positionId: accountant.id }, { role: 'A', positionId: head.id }] },
  { id: steps[1].id, title: 'Konzultácia DPH', raci: [{ role: 'R', positionId: accountant.id }, { role: 'C', personId: personId('Peter') }] }
]);
const petersToday = (await call('/me/work', { token: peter })).payload?.processes?.find((item) => item.id === proc.id);
check('priame priradenie osobe sa ukaze v Moja praca', petersToday?.roles?.some((role) => role.raci === 'C' && role.positionName === ''), JSON.stringify(petersToday?.roles));
check('zmena RACI = zmena navrhu', (await call(`/processes/${proc.id}`, { token: owner })).payload?.publication?.hasDraftChanges === true);

// --- vymazanie ---
const cleared = await put([{ id: steps[0].id, title: 'Kontrola faktúry do 2 dní', raci: [] }]);
check('prazdny zoznam RACI vymaze', (cleared.payload?.activities?.[0]?.raci ?? []).length === 0 && cleared.payload?.activities?.length === 1);
check('v1 si RACI pamata', ((await call(`/processes/${proc.id}?view=effective`, { token: owner })).payload?.activities?.[1]?.raci ?? []).length === 2);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(48)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
