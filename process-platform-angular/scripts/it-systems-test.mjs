/**
 * IT systemy a dopad ich zmeny (#43 GRAPH-01) so syntetickymi udajmi.
 *
 * System patri firme; proces ho pouziva celkovo alebo pri kroku. Pred vyradenim
 * sa ukaze, ktore procesy, kroky a platne verzie zasiahne. Vyradeny system sa
 * neponuka na nove vazby, existujuce ostavaju a proces sa ukaze v Prehlade.
 * Pouzity system sa nemaze. Verzia procesu si system pamata (odtlacok starsich
 * verzii bez systemov sa nemeni). Cudzia firma system nevidi ani nepripoji.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/it-systems-test.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { acceptTerms: true, organizationName: `Org Test systemy ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-sys-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-sys-${label}-${STAMP}@example.test`, roleId }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}
const eva = await member('Eva', 'quality');
const jana = await member('Jana', 'approver');

// --- register systemov ---
const it = (await call(org('/positions'), { method: 'POST', body: { name: 'Správca IT' }, token: owner })).payload;
const erp = await call(org('/systems'), { method: 'POST', body: { name: 'Účtovný systém', code: 'erp', vendor: 'Dodávateľ s.r.o.', url: 'https://erp.example.test/login', ownerPositionId: it.id }, token: owner });
check('system zaradeny s vlastnikom podla miesta', erp.status === 201 && erp.payload?.code === 'ERP' && erp.payload?.ownerPosition?.name === 'Správca IT', JSON.stringify(erp.payload));
const bank = (await call(org('/systems'), { method: 'POST', body: { name: 'Internet banking' }, token: eva })).payload;
check('editor procesov smie zaradit system', Boolean(bank?.id));
check('schvalovatel nezaradi system → 403', (await call(org('/systems'), { method: 'POST', body: { name: 'Iný' }, token: jana })).status === 403);
check('duplicitny nazov (bez ohladu na velkost) → 409', (await call(org('/systems'), { method: 'POST', body: { name: 'účtovný SYSTÉM' }, token: owner })).status === 409);
check('odkaz javascript: → 400', (await call(org('/systems'), { method: 'POST', body: { name: 'Zlý', url: 'javascript:alert(1)' }, token: owner })).status === 400);
check('bez nazvu → 400', (await call(org('/systems'), { method: 'POST', body: { name: '  ' }, token: owner })).status === 400);
const foreignOwner = (await call(`/organizations/${b.orgId}/positions`, { method: 'POST', body: { name: 'Cudzie miesto' }, token: b.token })).payload;
check('vlastnik z inej firmy → 404', (await call(org('/systems'), { method: 'POST', body: { name: 'Cudzí vlastník', ownerPositionId: foreignOwner.id }, token: owner })).status === 404);
const unused = (await call(org('/systems'), { method: 'POST', body: { name: 'Nepoužitý' }, token: owner })).payload;

// --- izolacia firiem ---
const foreignList = (await call(`/organizations/${b.orgId}/systems`, { token: b.token })).payload ?? [];
check('ina firma systemy nevidi', foreignList.length === 0);
check('ina firma dopad nevidi → 404', (await call(`/systems/${erp.payload.id}/impact`, { token: b.token })).status === 404);
check('ina firma neupravi → 404', (await call(`/systems/${erp.payload.id}`, { method: 'PATCH', body: { name: 'X' }, token: b.token })).status === 404);
const foreignProcess = (await call(`/organizations/${b.orgId}/processes`, { method: 'POST', body: { name: 'Cudzí proces', type: 'process' }, token: b.token })).payload;
check('cudzi system k procesu nepripoji → 404', (await call(`/processes/${foreignProcess.id}`, { method: 'PATCH', body: { systemIds: [erp.payload.id] }, token: b.token })).status === 404);

// --- pouzitie v procese a kroku ---
const invoices = (await call(org('/processes'), { method: 'POST', body: { name: 'Faktúry', type: 'process' }, token: owner })).payload;
const legacy = (await call(org('/processes'), { method: 'POST', body: { name: 'Bez systémov', type: 'process' }, token: owner })).payload;
const clerk = (await call(org('/positions'), { method: 'POST', body: { name: 'Účtovník' }, token: owner })).payload;
for (const proc of [invoices, legacy]) {
  await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Účel', ownerPositionId: clerk.id }, token: owner });
}
await call(`/processes/${legacy.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Ručne' }] }, token: owner });
const legacyV1 = await call(`/processes/${legacy.id}/publish`, { method: 'POST', body: {}, token: owner });
check('proces bez systemov publikovany', legacyV1.status === 201 || legacyV1.status === 200, `${legacyV1.status} ${legacyV1.payload?.message}`);
const legacyDraft = (await call(`/processes/${legacy.id}`, { token: owner })).payload;
check('proces bez systemov nema zmeny po nasadeni (odtlacok)', legacyDraft?.publication?.hasDraftChanges === false);

const patched = await call(`/processes/${invoices.id}`, { method: 'PATCH', body: { systemIds: [erp.payload.id, erp.payload.id] }, token: owner });
check('system pripojeny k procesu (bez duplicit)', JSON.stringify(patched.payload?.systemIds) === JSON.stringify([erp.payload.id]), JSON.stringify(patched.payload?.systemIds));
const steps = await call(`/processes/${invoices.id}/activities`, {
  method: 'PUT',
  token: owner,
  body: { activities: [{ title: 'Kontrola faktúry' }, { title: 'Úhrada', systemIds: [bank.id] }] }
});
check('system pri kroku', steps.payload?.activities?.[1]?.systemIds?.[0] === bank.id && steps.payload?.activities?.[0]?.systemIds?.length === 0, JSON.stringify(steps.payload?.activities));
const keep = await call(`/processes/${invoices.id}/activities`, {
  method: 'PUT',
  token: owner,
  body: { activities: steps.payload.activities.map((step) => ({ id: step.id, title: step.title })) }
});
check('starsi klient bez systemIds systemy kroku nezmaze', keep.payload?.activities?.[1]?.systemIds?.[0] === bank.id);
check('cudzi system pri kroku → 404', (await call(`/processes/${invoices.id}/activities`, { method: 'PUT', token: owner, body: { activities: [{ title: 'X', systemIds: [crypto.randomUUID()] }] } })).status === 404);

const history = (await call(`/processes/${invoices.id}/history`, { token: owner })).payload ?? [];
check('zmena systemov v historii citatelne', history.some((item) => JSON.stringify(item.changedFields?.systemy?.to) === JSON.stringify(['Účtovný systém']))
  && history.some((item) => (item.changedFields?.systemyKrokov?.to ?? []).includes('2. Úhrada: Internet banking')), JSON.stringify(history.map((item) => item.changedFields)));

const v1 = await call(`/processes/${invoices.id}/publish`, { method: 'POST', body: {}, token: owner });
check('verzia so systemami publikovana', v1.status === 201 || v1.status === 200, `${v1.status} ${v1.payload?.message}`);
const effective = (await call(`/processes/${invoices.id}?view=effective`, { token: owner })).payload;
check('platna verzia si pamata systemy procesu aj kroku', effective?.systemIds?.[0] === erp.payload.id && effective?.activities?.[1]?.systemIds?.[0] === bank.id);

// --- zoznam s pouzitim a hladanie ---
const list = (await call(org('/systems'), { token: eva })).payload ?? [];
const erpRow = list.find((item) => item.id === erp.payload.id);
const bankRow = list.find((item) => item.id === bank.id);
check('zoznam: kolko procesov a krokov system pouziva', erpRow?.processCount === 1 && erpRow?.stepCount === 0 && bankRow?.processCount === 1 && bankRow?.stepCount === 1,
  JSON.stringify(list.map((item) => [item.name, item.processCount, item.stepCount])));
const search = (await call(`/search?q=${encodeURIComponent('uctovny')}`, { token: owner })).payload;
check('hladanie najde system bez diakritiky', (search?.systems ?? []).some((item) => item.id === erp.payload.id), JSON.stringify(search?.systems));
const foreignSearch = (await call(`/search?q=${encodeURIComponent('uctovny')}`, { token: b.token })).payload;
check('hladanie v inej firme system nenajde', (foreignSearch?.systems ?? []).length === 0);

// --- dopad a vyradenie ---
const impact = (await call(`/systems/${bank.id}/impact`, { token: owner })).payload;
check('dopad: proces a krok', impact?.processes?.[0]?.name === 'Faktúry' && impact.processes[0].wholeProcess === false && impact.processes[0].steps[0] === '2. Úhrada',
  JSON.stringify(impact?.processes));
check('dopad: platna verzia', impact?.versions?.some((item) => item.name === 'Faktúry' && item.revision === 1));
check('pouzity system zmazat nejde → 409', (await call(`/systems/${bank.id}`, { method: 'DELETE', token: owner })).status === 409);
check('nepouzity system zmazat ide', (await call(`/systems/${unused.id}`, { method: 'DELETE', token: owner })).status === 204);
check('vyradenie bez potvrdenia → 400', (await call(`/systems/${bank.id}/archive`, { method: 'POST', body: {}, token: owner })).status === 400);
check('editor procesov nevyradi → 403', (await call(`/systems/${bank.id}/archive`, { method: 'POST', body: { confirm: true }, token: eva })).status === 403);
const retired = await call(`/systems/${bank.id}/archive`, { method: 'POST', body: { confirm: true }, token: owner });
check('vyradeny po potvrdeni', retired.status === 200 && retired.payload?.system?.archived === true, `${retired.status} ${retired.payload?.message}`);

const detail = (await call(`/processes/${invoices.id}`, { token: owner })).payload;
check('vazba pri kroku ostala', detail?.activities?.[1]?.systemIds?.[0] === bank.id);
const overview = (await call('/overview', { token: owner })).payload;
const retiredCard = overview?.categories?.find((category) => category.key === 'retiredSystems')?.items ?? [];
check('prehlad: proces s vyradenym systemom', retiredCard.length === 1 && retiredCard[0].id === invoices.id && retiredCard[0].detail.includes('Internet banking'), JSON.stringify(retiredCard));

let evasBox = null;
for (let attempt = 0; attempt < 30; attempt++) {
  evasBox = (await call('/me/notifications', { token: eva })).payload;
  if ((evasBox?.items ?? []).some((item) => item.type === 'SystemArchived')) break;
  await sleep(200);
}
check('editorom upozornenie o vyradeni', (evasBox?.items ?? []).some((item) => item.type === 'SystemArchived' && item.body?.includes('Faktúry')), JSON.stringify(evasBox?.items?.map((item) => item.body)));

check('vyradeny system k novemu procesu → 400', (await call(`/processes/${legacy.id}`, { method: 'PATCH', body: { systemIds: [bank.id] }, token: owner })).status === 400);
check('vyradeny system k novemu kroku → 400', (await call(`/processes/${legacy.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'X', systemIds: [bank.id] }] }, token: owner })).status === 400);
check('existujuca vazba sa da ulozit znova', (await call(`/processes/${invoices.id}/activities`, {
  method: 'PUT', token: owner, body: { activities: detail.activities.map((step) => ({ id: step.id, title: step.title, systemIds: step.systemIds })) }
})).status === 200);
const removed = await call(`/processes/${invoices.id}/activities`, {
  method: 'PUT', token: owner, body: { activities: detail.activities.map((step) => ({ id: step.id, title: step.title, systemIds: [] })) }
});
check('odobratie vyradeneho systemu', removed.status === 200 && removed.payload?.activities?.every((step) => step.systemIds.length === 0));
const overviewAfter = (await call('/overview', { token: owner })).payload;
const stillRetired = overviewAfter?.categories?.find((category) => category.key === 'retiredSystems')?.items ?? [];
check('prehlad: platna verzia ho este pouziva, kym ju nenahradi nova', stillRetired.some((item) => item.id === invoices.id));

check('obnovenie systemu', (await call(`/systems/${bank.id}/restore`, { method: 'POST', body: {}, token: owner })).payload?.archived === false);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(55)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
