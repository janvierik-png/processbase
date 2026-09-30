/**
 * Rychly proces a minimum na publikovanie (#28 CORE-02, scenar 1) so syntetickymi udajmi.
 *
 * Nova firma vytvori proces „Schvaľovanie faktúr“ s ucelom, tromi krokmi a poziciou
 * Účtovník bez zakladania celej firmy. Pred publikovanim vidi zrozumitelne,
 * co chyba. Kroky maju stabilne ID a publikovana verzia si drzi svoje kroky.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/quick-process-test.mjs
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
    body: { acceptTerms: true, organizationName: `Org Test rychly ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-rychly-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
  });
  return { token: reg.payload?.token, orgId: reg.payload?.organization?.id };
}

const a = await register('a');
const b = await register('b');
if (!a.token || !b.token) {
  console.error('Testovacie firmy sa nepodarilo zalozit — bezi API?');
  process.exit(2);
}
const t = a.token;
const proc = (await call(`/organizations/${a.orgId}/processes`, { method: 'POST', body: { name: 'Schvaľovanie faktúr', type: 'process' }, token: t })).payload;

// --- pred doplnenim: co chyba ---
const missingKeys = (proc?.readiness ?? []).filter((item) => item.required && !item.ok).map((item) => item.key).sort();
check('chyba ucel, kroky a vlastnik', JSON.stringify(missingKeys) === JSON.stringify(['activities', 'owner', 'purpose']), missingKeys.join(','));
check('spustac a vysledok su len odporucane', (proc?.readiness ?? []).filter((item) => !item.required).map((item) => item.key).includes('trigger'));
const early = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: t });
check('publikovanie bez minima odmietnute po mene',
  early.status === 400 && /účel/.test(early.payload?.message) && /krok/.test(early.payload?.message) && /vlastník/.test(early.payload?.message),
  early.payload?.message);

// --- doplnenie bez organizacnej schemy: miesto vznikne priamo pri procese ---
const accountant = (await call(`/organizations/${a.orgId}/positions`, { method: 'POST', body: { name: 'Účtovník' }, token: t })).payload;
const manager = (await call(`/organizations/${a.orgId}/positions`, { method: 'POST', body: { name: 'Vedúci účtovníctva' }, token: t })).payload;
await call(`/processes/${proc.id}`, {
  method: 'PATCH',
  body: {
    purpose: 'Faktúry sa uhradia včas a len po kontrole.',
    trigger: 'Príde faktúra od dodávateľa',
    outcome: 'Uhradená alebo vrátená faktúra',
    ownerPositionId: manager?.id,
    positionIds: [accountant?.id]
  },
  token: t
});
const emptyTitle = await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: '  ' }] }, token: t });
check('krok bez nazvu odmietnuty', emptyTitle.status === 400);

const saved = await call(`/processes/${proc.id}/activities`, {
  method: 'PUT',
  body: { activities: [
    { title: 'Účtovník faktúru skontroluje', description: 'Cena, množstvo, objednávka' },
    { title: 'Vedúci účtovníctva ju schváli' },
    { title: 'Faktúra sa uhradí alebo vráti' }
  ] },
  token: t
});
const steps = saved.payload?.activities ?? [];
check('tri kroky v poradi', steps.length === 3 && steps[0].title === 'Účtovník faktúru skontroluje' && steps[2].title.startsWith('Faktúra'));
check('minimum splnene', (saved.payload?.readiness ?? []).every((item) => !item.required || item.ok));

const v1 = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: t });
check('v1 publikovana', v1.status === 201, v1.payload?.message);

// --- zmena poradia zachova ID krokov ---
const reordered = await call(`/processes/${proc.id}/activities`, {
  method: 'PUT',
  body: { activities: [steps[2], steps[0], { ...steps[1], title: 'Vedúci účtovníctva schváli do 2 dní' }] },
  token: t
});
const after = reordered.payload?.activities ?? [];
check('presun zachova ID', after[0]?.id === steps[2].id && after[1]?.id === steps[0].id && after[2]?.id === steps[1].id);
const effective = (await call(`/processes/${proc.id}?view=effective`, { token: t })).payload;
check('platna v1 ma povodne kroky', effective?.activities?.[0]?.title === 'Účtovník faktúru skontroluje' && effective?.activities?.length === 3);
check('platna v1 ma spustac a vysledok', effective?.trigger === 'Príde faktúra od dodávateľa' && effective?.outcome === 'Uhradená alebo vrátená faktúra');
check('navrh ma zmeny oproti v1', reordered.payload?.publication?.hasDraftChanges === true);

// --- cudzie ID kroku sa neprevezme ---
const other = (await call(`/organizations/${a.orgId}/processes`, { method: 'POST', body: { name: 'Iný proces', type: 'process' }, token: t })).payload;
const hijack = await call(`/processes/${other.id}/activities`, { method: 'PUT', body: { activities: [{ id: steps[0].id, title: 'ukradnutý krok' }] }, token: t });
check('ID kroku z ineho procesu sa nezachova', hijack.payload?.activities?.[0]?.id !== steps[0].id);
const original = (await call(`/processes/${proc.id}`, { token: t })).payload;
check('povodny proces ostal nedotknuty', original?.activities?.length === 3);

// --- izolacia a opravnenia ---
check('firma B nemeni kroky A', (await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [] }, token: b.token })).status === 404);
const invitation = (await call(`/organizations/${a.orgId}/invitations`, { method: 'POST', body: { email: `orgtest-rychly-sch-${STAMP}@example.test`, roleId: 'approver' }, token: t })).payload;
const approver = (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: 'Schvalovatel', password: 'Heslo123456' } })).payload?.token;
check('schvalovatel nemeni kroky', (await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [] }, token: approver })).status === 403);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
