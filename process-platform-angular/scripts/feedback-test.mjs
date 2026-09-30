/**
 * Podnety k procesu (#36 UX-01d) so syntetickymi udajmi.
 *
 * Citatel (bez prava upravovat) nahlasi chybu ku kroku platnej verzie;
 * vlastnik procesu — ten, kto dnes zastava jeho miesto, aj bez prava
 * upravovat — podnet vidi a rozhodne. Ostatni vidia len svoje podnety.
 * Po odchode z miesta uz vlastnik nerozhoduje.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/feedback-test.mjs
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
    body: { acceptTerms: true, organizationName: `Org Test podnety ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-podnet-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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

async function member(label, roleId) {
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-podnet-${label}-${STAMP}@example.test`, roleId }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}
const jana = await member('Jana', 'iso');      // citatelka bez prava upravovat
const eva = await member('Eva', 'approver');   // ina citatelka
const peter = await member('Peter', 'iso');    // zastava miesto vlastnika, bez prava upravovat
const editor = await member('Editor', 'quality');
const people = (await call(org('/people'), { token: owner })).payload ?? [];

const head = (await call(org('/positions'), { method: 'POST', body: { name: 'Vedúci skladu' }, token: owner })).payload;
const petersSeat = (await call(`/positions/${head.id}/assignments`, {
  method: 'POST', body: { personId: people.find((person) => person.name === 'Peter')?.id, validFrom: dayOffset(-30) }, token: owner
})).payload;
const proc = (await call(org('/processes'), { method: 'POST', body: { name: 'Príjem tovaru', type: 'process' }, token: owner })).payload;
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Tovar sa prijme a skontroluje.', ownerPositionId: head.id }, token: owner });
const steps = (await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Kontrola dodacieho listu' }] }, token: owner })).payload?.activities ?? [];
await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: owner });
const other = (await call(org('/processes'), { method: 'POST', body: { name: 'Iný proces', type: 'process' }, token: owner })).payload;
const otherSteps = (await call(`/processes/${other.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Cudzí krok' }] }, token: owner })).payload?.activities ?? [];
const group = (await call(org('/processes'), { method: 'POST', body: { name: 'Skupina', type: 'folder' }, token: owner })).payload;
const foreign = (await call(org('/processes', b.orgId), { method: 'POST', body: { name: 'Cudzí', type: 'process' }, token: b.token })).payload;

const report = (body, token, id = proc.id) => call(`/processes/${id}/feedback`, { method: 'POST', body, token });
const decide = (id, body, token) => call(`/feedback/${id}/decide`, { method: 'POST', body, token });

// --- nahlasenie ---
const first = await report({ kind: 'error', text: 'Dodací list sa kontroluje až po naskladnení.', activityId: steps[0]?.id }, jana);
check('citatelka nahlasi chybu ku kroku', first.status === 201 && first.payload?.status === 'open', `${first.status} ${first.payload?.message}`);
check('podnet k platnej verzii a kroku', first.payload?.revision === 1 && first.payload?.stepTitle === 'Kontrola dodacieho listu', JSON.stringify(first.payload));
check('neznamy druh → 400', (await report({ kind: 'x', text: 'a' }, jana)).status === 400);
check('prazdny text → 400', (await report({ kind: 'error', text: '  ' }, jana)).status === 400);
check('krok ineho procesu → 404', (await report({ kind: 'error', text: 'a', activityId: otherSteps[0]?.id }, jana)).status === 404);
check('skupina → 400', (await report({ kind: 'error', text: 'a' }, jana, group.id)).status === 400);
check('proces inej firmy → 404', (await report({ kind: 'error', text: 'a' }, jana, foreign.id)).status === 404);

// --- kto co vidi ---
const evasView = (await call(`/processes/${proc.id}/feedback`, { token: eva })).payload;
check('ina citatelka cudzi podnet nevidi', evasView?.canDecide === false && evasView.items.length === 0, JSON.stringify(evasView));
const janasView = (await call(`/processes/${proc.id}/feedback`, { token: jana })).payload;
check('autorka vidi svoj podnet', janasView?.items?.length === 1 && janasView.items[0].mine === true);
const petersView = (await call(`/processes/${proc.id}/feedback`, { token: peter })).payload;
check('vlastnik podla miesta vidi a rozhoduje', petersView?.canDecide === true && petersView.items.length === 1, JSON.stringify(petersView?.canDecide));
check('podnet v Moja praca vlastnika', ((await call('/me/feedback', { token: peter })).payload ?? []).some((item) => item.id === first.payload.id));
check('autorka ho v Moja praca ako vlastnicka nema', ((await call('/me/feedback', { token: jana })).payload ?? []).length === 0);

const overview = (await call('/overview', { token: owner })).payload;
const feedbackCard = overview?.categories?.find((category) => category.key === 'feedback');
check('prehlad: nevybavene podnety', feedbackCard?.count === 1 && feedbackCard.items[0].detail.includes('chyby: 1'), JSON.stringify(feedbackCard?.items));

// --- rozhodnutie ---
check('autorka nerozhoduje → 403', (await decide(first.payload.id, { status: 'accepted' }, jana)).status === 403);
check('ina firma nerozhoduje → 404', (await decide(first.payload.id, { status: 'accepted' }, b.token)).status === 404);
check('zamietnutie bez dovodu → 400', (await decide(first.payload.id, { status: 'rejected' }, peter)).status === 400);
const accepted = await decide(first.payload.id, { status: 'accepted', note: 'Upravíme poradie krokov.' }, peter);
check('vlastnik prijal podnet', accepted.status === 200 && accepted.payload?.status === 'accepted' && accepted.payload?.decidedBy === 'Peter');
check('druhe prijatie → 409', (await decide(first.payload.id, { status: 'accepted' }, peter)).status === 409);
check('prijaty ostava v Moja praca', ((await call('/me/feedback', { token: peter })).payload ?? []).some((item) => item.id === first.payload.id));
check('vybavene', (await decide(first.payload.id, { status: 'done' }, peter)).payload?.status === 'done');
check('vybaveny sa neotvara → 409', (await decide(first.payload.id, { status: 'rejected', note: 'x' }, peter)).status === 409);
const janasResult = (await call(`/processes/${proc.id}/feedback`, { token: jana })).payload?.items?.[0];
check('autorka vidi vysledok a kto rozhodol', janasResult?.status === 'done' && janasResult.decidedBy === 'Peter' && janasResult.decisionNote === 'Upravíme poradie krokov.', JSON.stringify(janasResult));
check('vybaveny zmizne z Moja praca', !((await call('/me/feedback', { token: peter })).payload ?? []).some((item) => item.id === first.payload.id));

const second = await report({ kind: 'improvement', text: 'Fotiť poškodený tovar.' }, eva);
const rejected = await decide(second.payload.id, { status: 'rejected', note: 'Rieši to reklamačný proces.' }, editor);
check('editor zamietne s dovodom', rejected.payload?.status === 'rejected' && rejected.payload?.decisionNote === 'Rieši to reklamačný proces.');

// --- po odchode z miesta vlastnik nerozhoduje ---
const third = await report({ kind: 'error', text: 'Chýba kontrola teploty.' }, jana);
await call(`/assignments/${petersSeat?.id}`, { method: 'PATCH', body: { validTo: dayOffset(-1) }, token: owner });
check('po odchode z miesta → 403', (await decide(third.payload.id, { status: 'accepted' }, peter)).status === 403);
check('po odchode nevidi cudzie podnety', ((await call(`/processes/${proc.id}/feedback`, { token: peter })).payload?.items ?? []).length === 0);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
