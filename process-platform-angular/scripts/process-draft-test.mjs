/**
 * Navrh procesu z textu (#42 AI-01) so syntetickymi udajmi.
 *
 * Bez AI podla pravidiel: kroky, kto ich robi (aj pri inom tvare slova ako
 * pracovne miesto firmy), rozhodnutie „Ak …, … inak …“ ako gateway s vetvami.
 * Navrh sa neuklada; az potvrdenie vytvori proces ako NAVRH (nic sa
 * nepublikuje) s krokmi, RACI, vlastnikom a platnym BPMN diagramom s drahami.
 * AI sa da pouzit len ak ju firma zapla (spravou firmy) a je kluc; kluc sa
 * nikdy nevracia. Miesta inej firmy sa nikdy nepriradia.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/process-draft-test.mjs
 */
import { BpmnModdle } from 'bpmn-moddle';

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
    body: { organizationName: `Org Test navrh ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-draft-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-draft-${label}-${STAMP}@example.test`, roleId }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}
const eva = await member('Eva', 'quality');
const jana = await member('Jana', 'approver');

const clerk = (await call(org('/positions'), { method: 'POST', body: { name: 'Účtovník' }, token: owner })).payload;
const head = (await call(org('/positions'), { method: 'POST', body: { name: 'Vedúci oddelenia' }, token: owner })).payload;
await call(`/organizations/${b.orgId}/positions`, { method: 'POST', body: { name: 'Konateľ' }, token: b.token });

const TEXT = `Spracovanie prijatej faktúry
Účel: faktúry sú uhradené včas a správne zaúčtované.
Proces začína, keď príde faktúra od dodávateľa.
1. Asistentka zaeviduje faktúru do knihy došlých faktúr.
2. Účtovníčka skontroluje faktúru voči objednávke.
3. Ak je faktúra v poriadku, vedúci oddelenia ju schváli, inak ju účtovníčka vráti dodávateľovi.
4. Účtovníčka faktúru zaúčtuje a pripraví platobný príkaz.
5. Konateľ podpíše platobný príkaz v banke.
Výsledok: uhradená a zaúčtovaná faktúra.`;

// --- navrh podla pravidiel ---
const drafted = await call('/process-drafts/from-text', { method: 'POST', body: { text: TEXT }, token: eva });
const draft = drafted.payload?.draft;
check('navrh podla pravidiel (bez AI)', drafted.status === 200 && drafted.payload?.method === 'rules', `${drafted.status} ${drafted.payload?.message}`);
check('nazov, ucel, spustac, vysledok', draft?.name === 'Spracovanie prijatej faktúry' && draft?.purpose.startsWith('faktúry sú uhradené') && draft?.trigger === 'Príde faktúra od dodávateľa' && draft?.outcome.startsWith('uhradená'),
  JSON.stringify({ name: draft?.name, purpose: draft?.purpose, trigger: draft?.trigger, outcome: draft?.outcome }));
const tasks = (draft?.nodes ?? []).filter((node) => node.type === 'task');
check('kroky z ocislovaneho zoznamu', tasks.length === 6, tasks.map((task) => task.name).join(' | '));
const gateway = (draft?.nodes ?? []).find((node) => node.type === 'gateway');
const branches = (draft?.flows ?? []).filter((flow) => flow.from === gateway?.id).map((flow) => flow.label).sort();
check('rozhodnutie s vetvami Ano/Nie', gateway?.name === 'Je faktúra v poriadku?' && JSON.stringify(branches) === JSON.stringify(['Nie', 'Áno']), `${gateway?.name} ${JSON.stringify(branches)}`);
check('rola pri inom tvare slova = miesto firmy', tasks.find((task) => task.name.startsWith('Účtovníčka skontroluje'))?.role === 'Účtovník');
const matches = Object.fromEntries((drafted.payload?.roleMatches ?? []).map((item) => [item.role, item.positionId]));
check('zhoda roly s miestom firmy', matches['Účtovník'] === clerk.id && matches['Vedúci oddelenia'] === head.id, JSON.stringify(drafted.payload?.roleMatches));
check('miesto inej firmy sa nepriradi', matches['Konateľ'] === null, JSON.stringify(matches));
check('kroky pre kartu procesu s rozhodnutim', (drafted.payload?.steps ?? []).some((step) => step.title === 'Rozhodnutie: Je faktúra v poriadku?' && step.description.includes('Áno')));
const prose = (await call('/process-drafts/from-text', { method: 'POST', body: { text: 'Zákazník pošle objednávku. Skladník pripraví tovar a potom ho odošle kuriérom.' }, token: eva })).payload?.draft;
check('pokracovanie vety robi ten isty clovek', prose?.nodes?.find((node) => node.name === 'Odošle ho kuriérom')?.role === 'Skladník', JSON.stringify(prose?.nodes));
check('upozornenie na chybajuci nazov a ucel', prose?.warnings?.some((warning) => warning.includes('názov')) && prose?.warnings?.some((warning) => warning.includes('účel')));
check('prilis kratky text → 400', (await call('/process-drafts/from-text', { method: 'POST', body: { text: 'krátko' }, token: eva })).status === 400);
check('schvalovatel navrh nerobi → 403', (await call('/process-drafts/from-text', { method: 'POST', body: { text: TEXT }, token: jana })).status === 403);

// --- AI: len ak ju firma zapne a je kluc ---
check('AI bez zapnutia → 403', (await call('/process-drafts/from-text', { method: 'POST', body: { text: TEXT, useAi: true }, token: eva })).status === 403);
check('AI zapina len sprava firmy → 403', (await call(org('/settings/ai'), { method: 'POST', body: { enabled: true }, token: eva })).status === 403);
check('neplatny kluc → 400', (await call(org('/settings/ai'), { method: 'POST', body: { enabled: true, apiKey: 'abc' }, token: owner })).status === 400);
const withKey = await call(org('/settings/ai'), { method: 'POST', body: { enabled: true, apiKey: `sk-ant-test-${'x'.repeat(30)}` }, token: owner });
check('vlastny kluc ulozeny, nevracia sa', withKey.payload?.hasOrgKey === true && withKey.payload?.available === true && !JSON.stringify(withKey.payload).includes('sk-ant'), JSON.stringify(withKey.payload));
const status = (await call('/ai/status', { token: jana })).payload;
check('stav AI vidi kazdy clen (bez kluca)', status?.available === true && status?.provider?.includes('Anthropic') && !JSON.stringify(status).includes('sk-ant'), JSON.stringify(status));
const removed = (await call(org('/settings/ai'), { method: 'POST', body: { enabled: false, removeKey: true }, token: owner })).payload;
check('kluc odstraneny, AI vypnuta', removed?.hasOrgKey === false && removed?.enabled === false);

// --- potvrdenie: proces ako navrh ---
check('schvalovatel proces nevytvori → 403', (await call('/import/apply', { method: 'POST', body: { processes: [{ draft }] }, token: jana })).status === 403);
check('editor nove miesta nevytvori → 403', (await call('/import/apply', { method: 'POST', body: { processes: [{ draft }], createMissingRoles: true }, token: eva })).status === 403);
const applied = await call('/import/apply', { method: 'POST', body: { processes: [{ draft, ownerRole: 'Účtovník' }] }, token: eva });
check('proces vytvoreny z navrhu', applied.status === 201 && applied.payload?.processes?.length === 1, `${applied.status} ${applied.payload?.message}`);
const processId = applied.payload?.processes?.[0]?.id;
const detail = (await call(`/processes/${processId}`, { token: owner })).payload;
check('nic sa nepublikovalo', detail?.publication?.effective === null && detail?.publication?.latestRevision === 0, JSON.stringify(detail?.publication));
check('kroky, ucel a spustac v navrhu', detail?.activities?.length === 7 && detail?.purpose?.startsWith('faktúry') && detail?.trigger === 'Príde faktúra od dodávateľa', `${detail?.activities?.length}`);
check('RACI kroku podla miesta', detail?.activities?.find((step) => step.title.startsWith('Účtovníčka skontroluje'))?.raci?.[0]?.positionId === clerk.id);
check('vlastnik podla miesta', detail?.ownerPosition?.id === clerk.id);
check('krok s neznamou rolou bez RACI', detail?.activities?.find((step) => step.title.startsWith('Asistentka'))?.raci?.length === 0);
const moddle = new BpmnModdle();
const parsed = await moddle.fromXML(detail?.bpmnXml ?? '').catch((error) => ({ error }));
const lanes = parsed.rootElement?.rootElements?.find((element) => element.$type === 'bpmn:Process')?.laneSets?.[0]?.lanes?.map((lane) => lane.name) ?? [];
check('BPMN diagram platny, dráhy podla roli', detail?.diagramType === 'BPMN' && !parsed.error && parsed.warnings?.length === 0 && lanes.includes('Účtovník') && lanes.includes('Vedúci oddelenia'),
  `${parsed.error?.message ?? ''} ${JSON.stringify(parsed.warnings?.slice(0, 2))} ${JSON.stringify(lanes)}`);
const history = (await call(`/processes/${processId}/history`, { token: owner })).payload ?? [];
check('povod v historii', history.some((item) => item.description?.includes('Návrh z textu')));
check('ina firma proces nevidi → 404', (await call(`/processes/${processId}`, { token: b.token })).status === 404);

// --- chybajuce roly ako nove miesta (sprava firmy) ---
const withRoles = await call('/import/apply', { method: 'POST', body: { processes: [{ draft }], createMissingRoles: true }, token: owner });
const positions = (await call(org('/positions'), { token: owner })).payload ?? [];
check('chybajuce roly zalozene ako miesta', withRoles.status === 201 && positions.some((item) => item.name === 'Asistentka') && positions.filter((item) => item.name === 'Účtovník').length === 1,
  JSON.stringify(positions.map((item) => item.name)));

// --- nebezpecny alebo neplatny navrh sa ocisti ---
const hostile = {
  name: '<script>alert(1)</script>',
  nodes: [
    { id: 'x', type: 'task', name: 'Krok <b>&</b> "úvodzovky"' },
    ...Array.from({ length: 150 }, (_, index) => ({ id: `n${index}`, type: 'weird', name: `Krok ${index}` }))
  ],
  flows: [{ from: 'x', to: 'nikam' }, { from: 'x', to: 'x' }]
};
const hostileApplied = await call('/import/apply', { method: 'POST', body: { processes: [{ draft: hostile }] }, token: eva });
const hostileDetail = (await call(`/processes/${hostileApplied.payload?.processes?.[0]?.id}`, { token: owner })).payload;
const hostileParsed = await moddle.fromXML(hostileDetail?.bpmnXml ?? '').catch((error) => ({ error }));
check('navrh obmedzeny a ocisteny, XML platne', hostileApplied.status === 201 && (hostileDetail?.activities?.length ?? 0) <= 80 && !hostileParsed.error
  && hostileDetail?.bpmnXml?.includes('&lt;script&gt;') && !hostileDetail?.bpmnXml?.includes('<script>'), `${hostileApplied.status} ${hostileParsed.error?.message ?? ''}`);
check('prazdne potvrdenie → 400', (await call('/import/apply', { method: 'POST', body: {}, token: owner })).status === 400);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(55)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
