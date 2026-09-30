/**
 * Vlastne polia procesu (#45 CFG-01) so syntetickymi udajmi.
 *
 * Firma si v nastaveniach definuje polia (text, dlhy text, cislo, datum, vyber,
 * zaskrtnutie) a ci su povinne. Povinne pole blokuje publikovanie, nie ulozenie
 * navrhu; ukaze sa v zozname chybajucich udajov aj v Prehlade. Hodnoty su
 * sucast verzie (odtlacok procesov bez hodnot sa nemeni), v historii a v hladani.
 * Pole s hodnotami sa nemaze, len archivuje. Cudzia firma pole nevidi ani nevyplni.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/custom-fields-test.mjs
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

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { organizationName: `Org Test polia ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-cf-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-cf-eva-${STAMP}@example.test`, roleId: 'quality' }, token: owner })).payload;
const eva = (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: 'Eva', password: 'Heslo123456' } })).payload?.token;

// proces publikovany este pred zavedenim poli — jeho odtlacok sa nesmie zmenit
const clerk = (await call(org('/positions'), { method: 'POST', body: { name: 'Referent' }, token: owner })).payload;
async function makeProcess(name) {
  const proc = (await call(org('/processes'), { method: 'POST', body: { name, type: 'process' }, token: owner })).payload;
  await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: `Účel ${name}`, ownerPositionId: clerk.id }, token: owner });
  await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Krok' }] }, token: owner });
  return proc;
}
const legacy = await makeProcess('Starší proces');
check('proces pred zavedenim poli publikovany', [200, 201].includes((await call(`/processes/${legacy.id}/publish`, { method: 'POST', body: {}, token: owner })).status));

// --- definicia poli ---
const fieldPath = org('/process-fields');
const number = await call(fieldPath, { method: 'POST', body: { label: 'Číslo smernice', type: 'text', required: true, helpText: 'napr. SM-12' }, token: owner });
check('povinne textove pole zalozene', number.status === 201 && number.payload?.required === true, JSON.stringify(number.payload));
const level = (await call(fieldPath, { method: 'POST', body: { label: 'Stupeň dôvernosti', type: 'select', options: ['Verejné', 'Interné', 'Dôverné', 'Interné'] }, token: owner })).payload;
check('vyber bez duplicitnych moznosti', JSON.stringify(level?.options) === JSON.stringify(['Verejné', 'Interné', 'Dôverné']));
const budget = (await call(fieldPath, { method: 'POST', body: { label: 'Náklady (€)', type: 'number' }, token: owner })).payload;
const training = (await call(fieldPath, { method: 'POST', body: { label: 'Dátum školenia', type: 'date' }, token: owner })).payload;
const gdpr = (await call(fieldPath, { method: 'POST', body: { label: 'Osobné údaje posúdené', type: 'checkbox', required: true }, token: owner })).payload;
const notes = (await call(fieldPath, { method: 'POST', body: { label: 'Poznámka auditu', type: 'longText' }, token: owner })).payload;
check('neznamy typ → 400', (await call(fieldPath, { method: 'POST', body: { label: 'X', type: 'html' }, token: owner })).status === 400);
check('vyber bez moznosti → 400', (await call(fieldPath, { method: 'POST', body: { label: 'Prázdny výber', type: 'select', options: [] }, token: owner })).status === 400);
check('duplicitny nazov → 409', (await call(fieldPath, { method: 'POST', body: { label: 'číslo SMERNICE', type: 'text' }, token: owner })).status === 409);
check('editor procesov pole nezalozi → 403', (await call(fieldPath, { method: 'POST', body: { label: 'Iné', type: 'text' }, token: eva })).status === 403);
check('editor procesov polia vidi', ((await call(fieldPath, { token: eva })).payload ?? []).length === 6);
check('ina firma polia nevidi', ((await call(`/organizations/${b.orgId}/process-fields`, { token: b.token })).payload ?? []).length === 0);
check('ina firma pole neupravi → 404', (await call(`/process-fields/${level.id}`, { method: 'PATCH', body: { label: 'X' }, token: b.token })).status === 404);
check('typ pola sa nemeni → 400', (await call(`/process-fields/${budget.id}`, { method: 'PATCH', body: { type: 'text' }, token: owner })).status === 400);

// --- starsi proces sa zavedenim poli nezmenil ---
const legacyAfter = (await call(`/processes/${legacy.id}`, { token: owner })).payload;
check('odtlacok starsej verzie bez zmeny', legacyAfter?.publication?.hasDraftChanges === false);
check('povinne polia v zozname chybajucich udajov', ['Číslo smernice', 'Osobné údaje posúdené'].every((label) => legacyAfter?.readiness?.some((item) => item.label === label && item.required && !item.ok)),
  JSON.stringify(legacyAfter?.readiness));

// --- vyplnanie a kontroly typov ---
const proc = await makeProcess('Nákup materiálu');
const draftOnly = await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [budget.id]: '1200,5' } }, token: owner });
check('navrh sa ulozi aj bez povinnych poli (cislo s ciarkou)', draftOnly.status === 200 && draftOnly.payload?.customFields?.[budget.id] === 1200.5, `${draftOnly.status} ${JSON.stringify(draftOnly.payload?.customFields)}`);
const blocked = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: owner });
check('bez povinnych poli nepublikuje → 400', blocked.status === 400 && blocked.payload?.message?.includes('číslo smernice'), `${blocked.status} ${blocked.payload?.message}`);
check('zle cislo → 400', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [budget.id]: 'veľa' } }, token: owner })).status === 400);
check('zly datum → 400', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [training.id]: '2026-02-30' } }, token: owner })).status === 400);
check('moznost mimo zoznamu → 400', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [level.id]: 'Tajné' } }, token: owner })).status === 400);
check('zaskrtnutie len ano/nie → 400', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [gdpr.id]: 'ano' } }, token: owner })).status === 400);
const foreignField = (await call(`/organizations/${b.orgId}/process-fields`, { method: 'POST', body: { label: 'Cudzie', type: 'text' }, token: b.token })).payload;
check('pole inej firmy → 404', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [foreignField.id]: 'x' } }, token: owner })).status === 404);
check('customFields ako zoznam → 400', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: ['x'] }, token: owner })).status === 400);

const filled = await call(`/processes/${proc.id}`, {
  method: 'PATCH',
  token: owner,
  body: { customFields: { [number.payload.id]: '  SM-12  ', [level.id]: 'Interné', [training.id]: '2026-10-15', [gdpr.id]: true, [notes.id]: 'Kontrola dodávateľov raz ročne' } }
});
const values = filled.payload?.customFields ?? {};
check('hodnoty ulozene podla typu', values[number.payload.id] === 'SM-12' && values[level.id] === 'Interné' && values[training.id] === '2026-10-15' && values[gdpr.id] === true && values[budget.id] === 1200.5,
  JSON.stringify(values));
check('zmena len poslanych poli (ostatne ostali)', values[budget.id] === 1200.5);
check('po vyplneni nic povinne nechyba', (filled.payload?.readiness ?? []).filter((item) => item.required && !item.ok).length === 0, JSON.stringify(filled.payload?.readiness));
const history = (await call(`/processes/${proc.id}/history`, { token: owner })).payload ?? [];
check('zmena poli v historii citatelne', history.some((item) => (item.changedFields?.vlastnePolia?.to ?? []).includes('Stupeň dôvernosti: Interné')), JSON.stringify(history.map((item) => item.changedFields?.vlastnePolia)));

const v1 = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: eva });
check('s povinnymi poliami publikuje', [200, 201].includes(v1.status), `${v1.status} ${v1.payload?.message}`);
const effective = (await call(`/processes/${proc.id}?view=effective`, { token: owner })).payload;
check('platna verzia si pamata hodnoty', effective?.customFields?.[number.payload.id] === 'SM-12' && effective?.customFields?.[gdpr.id] === true);

// zrusenie zaskrtnutia = bez hodnoty; povinne zase chyba
const unchecked = (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [gdpr.id]: false } }, token: owner })).payload;
check('nezaskrtnute povinne pole chyba', unchecked?.customFields?.[gdpr.id] === undefined && unchecked?.readiness?.some((item) => item.label === 'Osobné údaje posúdené' && !item.ok));
check('navrh sa lisi od verzie', unchecked?.publication?.hasDraftChanges === true);
const overview = (await call('/overview', { token: owner })).payload;
const incomplete = overview?.categories?.find((category) => category.key === 'incomplete')?.items ?? [];
check('prehlad: neuplny kvoli povinnemu polu', incomplete.some((item) => item.id === proc.id && item.detail.includes('osobné údaje posúdené')), JSON.stringify(incomplete));
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [gdpr.id]: true } }, token: owner });

// --- hladanie ---
const search = (await call(`/search?q=${encodeURIComponent('dodavatelov')}`, { token: owner })).payload;
check('hladanie v hodnotach poli (bez diakritiky)', (search?.processes ?? []).some((item) => item.id === proc.id), JSON.stringify(search?.processes));
const idSearch = (await call(`/search?q=${encodeURIComponent(level.id.slice(0, 8))}`, { token: owner })).payload;
check('hladanie nenajde ID pola', !(idSearch?.processes ?? []).some((item) => item.id === proc.id));

// --- povinnost sa da vypnut; pole s hodnotami sa nemaze ---
const relaxed = await call(`/process-fields/${number.payload.id}`, { method: 'PATCH', body: { required: false }, token: owner });
check('povinnost vypnuta', relaxed.payload?.required === false && relaxed.payload?.usage === 1, JSON.stringify(relaxed.payload));
const removed = await call(`/process-fields/${level.id}`, { method: 'DELETE', token: owner });
check('pole s hodnotami sa archivuje, nemaze', removed.status === 200 && removed.payload?.archived === true, `${removed.status} ${JSON.stringify(removed.payload)}`);
const afterArchive = (await call(`/processes/${proc.id}`, { token: owner })).payload;
check('hodnota archivovaneho pola ostala', afterArchive?.customFields?.[level.id] === 'Interné');
check('archivovane pole — novu hodnotu nie → 400', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [level.id]: 'Verejné' } }, token: owner })).status === 400);
check('archivovane pole — vymazat hodnotu ide', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { customFields: { [level.id]: null } }, token: owner })).payload?.customFields?.[level.id] === undefined);
check('pole vo verzii sa stale nemaze (archivuje)', (await call(`/process-fields/${level.id}`, { method: 'DELETE', token: owner })).payload?.archived === true);
const unused = (await call(fieldPath, { method: 'POST', body: { label: 'Nepoužité', type: 'text' }, token: owner })).payload;
check('nepouzite pole sa zmaze', (await call(`/process-fields/${unused.id}`, { method: 'DELETE', token: owner })).status === 204);

// --- poradie ---
const active = ((await call(fieldPath, { token: owner })).payload ?? []).filter((field) => !field.archived).map((field) => field.id);
const reversed = [...active].reverse();
check('poradie poli', (await call(org('/process-fields/order'), { method: 'PUT', body: { ids: reversed }, token: owner })).status === 204
  && JSON.stringify(((await call(fieldPath, { token: owner })).payload ?? []).filter((field) => !field.archived).map((field) => field.id)) === JSON.stringify(reversed));
check('poradie s cudzim polom → 404', (await call(org('/process-fields/order'), { method: 'PUT', body: { ids: [foreignField.id] }, token: owner })).status === 404);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(55)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
