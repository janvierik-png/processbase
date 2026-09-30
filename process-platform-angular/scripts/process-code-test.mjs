/**
 * Kod procesu (#30 CORE-04) so syntetickymi udajmi.
 *
 * Kod je sucast navrhu aj publikovanej verzie, normalizuje sa na velke pismena
 * a vo firme je jedinecny: pri ulozeni ho nesmie mat iny navrh, pri publikovani
 * ani platna ci naplanovana verzia ineho procesu. Ina firma ma vlastne kody.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/process-code-test.mjs
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
    body: { acceptTerms: true, organizationName: `Org Test kod ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-kod-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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

const clerk = (await call(org('/positions'), { method: 'POST', body: { name: 'Referent' }, token: owner })).payload;
async function readyProcess(name, extra = {}) {
  const created = await call(org('/processes'), { method: 'POST', body: { name, type: 'process', ...extra }, token: owner });
  const proc = created.payload;
  await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: `Účel ${name}`, ownerPositionId: clerk.id }, token: owner });
  await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Krok' }] }, token: owner });
  return { created, proc };
}
const patch = (id, body) => call(`/processes/${id}`, { method: 'PATCH', body, token: owner });
const publish = (id, body = {}) => call(`/processes/${id}/publish`, { method: 'POST', body, token: owner });

// --- ukladanie navrhu ---
const { proc: p1 } = await readyProcess('Reklamácie');
const { proc: p2 } = await readyProcess('Objednávky');
const saved = await patch(p1.id, { code: '  pr-07 ' });
check('kod normalizovany na velke pismena', saved.status === 200 && saved.payload?.code === 'PR-07', `${saved.status} ${saved.payload?.code}`);
check('rovnaky kod iny navrh → 409', (await patch(p2.id, { code: 'PR-07' })).status === 409);
check('rovnaky kod malymi pismenami → 409', (await patch(p2.id, { code: 'pr-07' })).status === 409);
check('kod s medzerou → 400', (await patch(p2.id, { code: 'PR 07' })).status === 400);
check('prilis dlhy kod → 400', (await patch(p2.id, { code: 'X'.repeat(33) })).status === 400);
check('ina firma moze mat rovnaky kod', (await call(org('/processes', b.orgId), {
  method: 'POST', body: { name: 'Iná firma', type: 'process', code: 'PR-07' }, token: b.token
})).status === 201);
check('ulozenie vlastneho kodu znova je v poriadku', (await patch(p1.id, { code: 'PR-07' })).status === 200);

const { created: withCode } = await readyProcess('Nákup', { code: 'nk-01' });
check('kod pri zalozeni procesu', withCode.status === 201 && withCode.payload?.code === 'NK-01', withCode.payload?.code);
check('duplicitny kod pri zalozeni → 409', (await call(org('/processes'), {
  method: 'POST', body: { name: 'Duplicitný', type: 'process', code: 'NK-01' }, token: owner
})).status === 409);
check('vymazanie kodu', (await patch(withCode.payload.id, { code: '' })).payload?.code === '');

const history = (await call(`/processes/${p1.id}/history`, { token: owner })).payload ?? [];
check('zmena kodu v historii', history.some((change) => change.changedFields?.code?.to === 'PR-07'));

// --- publikovanie: kod je sucast verzie ---
check('p1 v1 publikovana', (await publish(p1.id)).status === 201);
const v1View = (await call(`/processes/${p1.id}?view=effective`, { token: owner })).payload;
check('platna verzia ukazuje kod', v1View?.code === 'PR-07', v1View?.code);

// p1 zmeni kod len v navrhu — v1 ho stale ukazuje
await patch(p1.id, { code: 'PR-08' });
check('navrh so zmenenym kodom ma zmeny', (await call(`/processes/${p1.id}`, { token: owner })).payload?.publication?.hasDraftChanges === true);
check('kod uvolneny v navrhoch', (await patch(p2.id, { code: 'PR-07' })).status === 200);
const clash = await publish(p2.id);
check('publikovanie s kodom platnej verzie ineho procesu → 409', clash.status === 409, `${clash.status} ${clash.payload?.message}`);
check('platna verzia p1 stale s PR-07', (await call(`/processes/${p1.id}?view=effective`, { token: owner })).payload?.code === 'PR-07');

// p1 publikuje v2 s novym kodom od zajtra — v1 plati do dnes, p2 moze od zajtra
check('p1 v2 s PR-08 od zajtra', (await publish(p1.id, { effectiveFrom: dayOffset(1), changeReason: 'Nový kód' })).status === 201);
check('p2 s PR-07 od dnes stale koliduje', (await publish(p2.id)).status === 409);
const p2Later = await publish(p2.id, { effectiveFrom: dayOffset(1) });
check('p2 s PR-07 od zajtra', p2Later.status === 201, `${p2Later.status} ${p2Later.payload?.message}`);

// verzia nahradena v ten isty den nikdy neplatila — kod neblokuje
const { proc: p3 } = await readyProcess('Sklad');
await patch(p3.id, { code: 'SK-01' });
await publish(p3.id, { effectiveFrom: dayOffset(3) });
await patch(p3.id, { code: 'SK-02' });
await publish(p3.id, { effectiveFrom: dayOffset(3), changeReason: 'Iný kód v ten istý deň' });
const { proc: p4 } = await readyProcess('Expedícia');
await patch(p4.id, { code: 'SK-01' });
const freed = await publish(p4.id, { effectiveFrom: dayOffset(3) });
check('kod verzie nahradenej v ten isty den neblokuje', freed.status === 201, `${freed.status} ${freed.payload?.message}`);

// procesy bez kodu: verzie sa neporovnavaju a odtlacok sa nemeni
const { proc: plain } = await readyProcess('Bez kódu');
await publish(plain.id);
check('proces bez kodu po publikovani bez zmien', (await call(`/processes/${plain.id}`, { token: owner })).payload?.publication?.hasDraftChanges === false);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(56)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
