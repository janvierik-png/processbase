/**
 * „Moja práca“ podla platneho obsadenia (#33 UX-01a, scenar 2) so syntetickymi udajmi.
 *
 * Jana zastava miesto Účtovník do dna D („30. 11.“), Peter od D+1 („1. 12.“).
 * K dnu D+2 („2. 12.“) ukaze Moja praca proces Petrovi a Jane uz nie; k dnesku
 * naopak. Zdroj zodpovednosti (miesto a rola) je pri kazdom procese.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/my-work-test.mjs
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

const reg = await call('/register', {
  method: 'POST',
  body: { organizationName: `Org Test praca ${STAMP}`, ownerName: 'Vlastnik', email: `orgtest-praca-${STAMP}@example.test`, password: 'Heslo123456' }
});
const t = reg.payload?.token;
const orgId = reg.payload?.organization?.id;
if (!t) {
  console.error('Testovaciu firmu sa nepodarilo zalozit — bezi API?');
  process.exit(2);
}
const org = (path) => `/organizations/${orgId}${path}`;

async function member(label) {
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-praca-${label}-${STAMP}@example.test`, roleId: 'approver' }, token: t })).payload;
  const accepted = (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload;
  return accepted?.token;
}

const jana = await member('Jana');
const peter = await member('Peter');
const people = (await call(org('/people'), { token: t })).payload ?? [];
const personOf = (name) => people.find((person) => person.name === name)?.id;

const accountant = (await call(org('/positions'), { method: 'POST', body: { name: 'Účtovník' }, token: t })).payload;
const head = (await call(org('/positions'), { method: 'POST', body: { name: 'Vedúci účtovníctva' }, token: t })).payload;
const D = 10; // „30. 11.“ = dnes + 10 dni

await call(`/positions/${accountant.id}/assignments`, { method: 'POST', body: { personId: personOf('Jana'), validFrom: dayOffset(-60), validTo: dayOffset(D) }, token: t });
await call(`/positions/${accountant.id}/assignments`, { method: 'POST', body: { personId: personOf('Peter'), validFrom: dayOffset(D + 1) }, token: t });
// Jana je zaroven veducou (druhe miesto) — zlucenie a zdroj zodpovednosti
await call(`/positions/${head.id}/assignments`, { method: 'POST', body: { personId: personOf('Jana'), validFrom: dayOffset(-60) }, token: t });

const invoices = (await call(org('/processes'), { method: 'POST', body: { name: 'Schvaľovanie faktúr', type: 'process' }, token: t })).payload;
await call(`/processes/${invoices.id}`, { method: 'PATCH', body: { purpose: 'Faktúry sa uhradia včas.', ownerPositionId: head.id, positionIds: [accountant.id] }, token: t });
await call(`/processes/${invoices.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Kontrola' }] }, token: t });
await call(`/processes/${invoices.id}/publish`, { method: 'POST', body: { nextReviewAt: dayOffset(20) }, token: t });
const other = (await call(org('/processes'), { method: 'POST', body: { name: 'Nesúvisiaci proces', type: 'process' }, token: t })).payload;

// --- dnes: Jana (ucetnik + veduca), Peter nic ---
const janaToday = (await call('/me/work', { token: jana })).payload;
const invoiceForJana = janaToday?.processes?.find((process) => process.id === invoices.id);
check('Jana dnes vidi proces', Boolean(invoiceForJana));
check('zlucene role z dvoch miest', invoiceForJana?.roles?.length === 2
  && invoiceForJana.roles.some((role) => role.role === 'OWNER' && role.positionName === 'Vedúci účtovníctva')
  && invoiceForJana.roles.some((role) => role.role === 'PERFORMER' && role.positionName === 'Účtovník'),
  JSON.stringify(invoiceForJana?.roles));
check('nesuvisiaci proces sa neukaze', !janaToday?.processes?.some((process) => process.id === other.id));
check('platna verzia a termin revizie', invoiceForJana?.effective?.revision === 1 && invoiceForJana?.review === 'soon', JSON.stringify(invoiceForJana?.effective));
const peterToday = (await call('/me/work', { token: peter })).payload;
check('Peter dnes proces nevidi', (peterToday?.processes ?? []).length === 0);

// --- „2. 12.“: Peter ako ucetnik, Jana uz len ako veduca ---
const peterLater = (await call(`/me/work?at=${dayOffset(D + 2)}`, { token: peter })).payload;
const invoiceForPeter = peterLater?.processes?.find((process) => process.id === invoices.id);
check('Peter 2. 12. vidi proces', invoiceForPeter?.roles?.[0]?.positionName === 'Účtovník' && invoiceForPeter.roles[0].role === 'PERFORMER');
const janaLater = (await call(`/me/work?at=${dayOffset(D + 2)}`, { token: jana })).payload;
const invoiceForJanaLater = janaLater?.processes?.find((process) => process.id === invoices.id);
check('Jana 2. 12. uz len ako veduca', invoiceForJanaLater?.roles?.length === 1 && invoiceForJanaLater.roles[0].role === 'OWNER');
check('Janine miesta 2. 12.', JSON.stringify((janaLater?.positions ?? []).map((position) => position.name)) === JSON.stringify(['Vedúci účtovníctva']));
check('po termine revizie: po termine', (await call(`/me/work?at=${dayOffset(25)}`, { token: jana })).payload?.processes?.[0]?.review === 'overdue');

// --- bez prihlasenia nic ---
check('bez prihlasenia 401', (await call('/me/work')).status === 401);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(44)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
