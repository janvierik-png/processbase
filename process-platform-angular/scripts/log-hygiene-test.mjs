/**
 * Logy servera bez obsahu (#32 SEC-01f) so syntetickymi udajmi.
 *
 * Posiela poziadavky s oznacenym obsahom (LOGMARK-…) do ciest, ktore koncia
 * chybou — 4xx aj 500 z Prismy. Klient dostane pri 500 len vseobecnu spravu a
 * ID poziadavky; obsah ani cast dotazu sa nevrati. Ze sa oznaceny obsah
 * nedostal ani do logu servera, overuje CI (grep v api.log) a lokalne
 * `docker logs process-platform-angular-api-1 | grep LOGMARK` — oboje musi byt prazdne.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/log-hygiene-test.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const MARK = `LOGMARK-${STAMP}`;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

async function call(path, { method = 'GET', body, token, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* nie JSON */ }
  return { status: response.status, payload, text, requestId: response.headers.get('x-request-id') };
}

const reg = await call('/register', {
  method: 'POST',
  body: { organizationName: `Org Test logy ${STAMP}`, ownerName: 'Vlastnik logy', email: `orgtest-logy-${STAMP}@example.test`, password: 'Heslo123456' }
});
const token = reg.payload?.token;
if (!token) {
  console.error('Testovaciu firmu sa nepodarilo zalozit — bezi API?');
  process.exit(2);
}
const orgId = reg.payload.organization.id;
const proc = (await call(`/organizations/${orgId}/processes`, { method: 'POST', body: { name: 'Proces', type: 'process' }, token })).payload;

// --- kazda odpoved ma ID poziadavky ---
const ok = await call(`/processes/${proc.id}`, { token });
check('odpoved ma X-Request-Id', /^[A-Za-z0-9._-]{8,64}$/.test(ok.requestId ?? ''), ok.requestId);
const forwarded = await call(`/processes/${proc.id}`, { token, headers: { 'X-Request-Id': 'proxy-abc12345' } });
check('ID od reverznej proxy sa prevezme', forwarded.requestId === 'proxy-abc12345', forwarded.requestId);
const injected = await call(`/processes/${proc.id}`, { token, headers: { 'X-Request-Id': `zly id ${MARK}` } });
check('neplatne ID sa nahradi vlastnym', injected.requestId && !injected.requestId.includes('LOGMARK'), injected.requestId);

// --- 500 z Prismy: obsah neodide klientovi ---
// nevalidny typ v tele by v Prisme skoncil chybou so zapisom celych dat vratane nazvu
const crash = await call(`/processes/${proc.id}`, {
  method: 'PATCH', body: { name: `${MARK}-nazov`, descriptionText: `${MARK}-popis`, sortOrder: { bad: MARK } }, token
});
check('chybny vstup → 400 alebo 500 bez obsahu', crash.status === 400 || crash.status === 500, `status ${crash.status}`);
check('odpoved neobsahuje odoslany obsah', !crash.text.includes(MARK), crash.text.slice(0, 200));
if (crash.status === 500) {
  check('500 vracia ID poziadavky na nahlasenie', crash.payload?.requestId && crash.payload.requestId === crash.requestId);
}

// --- 4xx so spravou o obsahu: klient ju dostane, log nie (overi CI) ---
await call(`/organizations/${orgId}/processes`, { method: 'POST', body: { name: `${MARK}-kod`, type: 'process', code: 'LG-01' }, token });
const duplicate = await call(`/organizations/${orgId}/processes`, { method: 'POST', body: { name: 'Druhý', type: 'process', code: 'LG-01' }, token });
check('4xx sprava pre pouzivatela ostava', duplicate.status === 409 && duplicate.payload?.message?.includes(MARK));

// --- neexistujuca cesta s obsahom v URL ---
const missing = await call(`/processes/${proc.id}/nieco-${MARK}`, { token });
check('neznama cesta → 404', missing.status === 404, `status ${missing.status}`);

// --- format zapisu (server/log.ts) — Node 22.18+ nacita .ts priamo ---
try {
  const { pathToFileURL } = await import('node:url');
  const log = await import(new URL('server/log.ts', pathToFileURL(`${process.cwd()}/`)).href);
  const leaky = new Error(`Invalid value ${MARK}-hodnota\n    at podvrh (/${MARK}/x.ts:1:1)`);
  Object.assign(leaky, { code: 'P2002', meta: { target: MARK } });
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try { log.logError('test', leaky, 'req-12345678'); } finally { console.error = original; }
  check('zapis chyby bez spravy a meta', lines.length === 1 && !lines[0].includes(MARK), lines[0]);
  check('zapis ma druh, kod a ID poziadavky', /\[test\] req=req-12345678 Error P2002/.test(lines[0] ?? ''), lines[0]);
  check('ID od proxy s novym riadkom sa neprevezme', log.acceptRequestId('abcdefgh\nfalosny', () => 'nove-id-123') === 'nove-id-123');
} catch (error) {
  check('server/log.ts sa da nacitat', false, String(error?.code ?? error?.name));
}

console.log(`MARK=${MARK}`);
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
