/**
 * Overenie opravneni podla roly vo firme (B7) so syntetickymi udajmi.
 *
 * Vlastnik pozve kolegov so vsetkymi rolami a kazda rola skusi, co smie a co nie
 * (podla matice rol, ktoru zobrazuje aplikacia). Citat smie kazdy clen firmy.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/permissions-test.mjs
 *             (alebo v CI: node scripts/permissions-test.mjs)
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const results = [];
const expect = (name, expected, actual) => results.push({ name, ok: expected === actual, expected, actual });

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

const reg = await call('/register', {
  method: 'POST',
  body: { acceptTerms: true, organizationName: `Org Test prava ${STAMP}`, ownerName: 'Vlastnik', email: `orgtest-prava-${STAMP}@example.test`, password: 'Heslo123456' }
});
const owner = reg.payload?.token;
const orgId = reg.payload?.organization?.id;
if (!owner) {
  console.error('Testovaciu firmu sa nepodarilo zalozit — bezi API?');
  process.exit(2);
}
const org = (path) => `/organizations/${orgId}${path}`;
const proc = (await call(org('/processes'), { method: 'POST', body: { name: 'Proces', type: 'process' }, token: owner })).payload;

/** Pozve cloveka s rolou a vrati jeho token po prijati pozvanky. */
async function member(roleId, inviter = owner) {
  const invitation = await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-prava-${roleId}-${STAMP}@example.test`, roleId }, token: inviter });
  const accepted = await call(`/invitations/${invitation.payload?.token}/accept`, { method: 'POST', body: { name: roleId, password: 'Heslo123456' } });
  return accepted.payload?.token;
}

const approver = await member('approver');
const iso = await member('iso');
const quality = await member('quality');
const admin = await member('admin');

// --- citanie smie kazdy ---
for (const [role, token] of Object.entries({ approver, iso, quality, admin })) {
  expect(`${role}: cita procesy`, 200, (await call(org('/processes'), { token })).status);
}

// --- schvalovatel: len citanie ---
expect('approver: vytvori proces', 403, (await call(org('/processes'), { method: 'POST', body: { name: 'X', type: 'process' }, token: approver })).status);
expect('approver: premenuje proces', 403, (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { name: 'X' }, token: approver })).status);
expect('approver: zmaze proces', 403, (await call(`/processes/${proc.id}`, { method: 'DELETE', token: approver })).status);
expect('approver: nahra dokument', 403, (await call(`/processes/${proc.id}/documents`, {
  method: 'POST', body: { fileName: 'a.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,QQ==' }, token: approver
})).status);
expect('approver: vidi tokeny pozvanok', 403, (await call(org('/invitations'), { token: approver })).status);
expect('approver: pozve kolegu', 403, (await call(org('/invitations'), { method: 'POST', body: { email: `x-${STAMP}@example.test`, roleId: 'owner' }, token: approver })).status);
expect('approver: meni org. strukturu', 403, (await call(org('/units'), { method: 'POST', body: { name: 'X' }, token: approver })).status);
expect('approver: meni nazov firmy', 403, (await call(org(''), { method: 'PATCH', body: { name: 'X' }, token: approver })).status);
expect('approver: meni API kluc prekladu', 403, (await call(org('/settings/translation'), {
  method: 'POST', body: { autoTranslate: false, provider: 'deepl', targetLocale: 'en' }, token: approver
})).status);

// --- ISO auditor: len ISO vazby ---
expect('iso: upravi ISO vazby', 200, (await call(`/processes/${proc.id}`, {
  method: 'PATCH', body: { iso: [{ standard: 'ISO 9001', clause: '8.5', evidence: '' }] }, token: iso
})).status);
expect('iso: premenuje proces', 403, (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { name: 'X', iso: [] }, token: iso })).status);
expect('iso: vytvori proces', 403, (await call(org('/processes'), { method: 'POST', body: { name: 'X', type: 'process' }, token: iso })).status);

// --- manazer kvality: procesy ano, firma a ludia nie ---
expect('quality: vytvori proces', 201, (await call(org('/processes'), { method: 'POST', body: { name: 'Q', type: 'process' }, token: quality })).status);
expect('quality: upravi proces', 200, (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { name: 'Proces Q' }, token: quality })).status);
expect('quality: meni org. strukturu', 403, (await call(org('/positions'), { method: 'POST', body: { name: 'X' }, token: quality })).status);
expect('quality: pozve kolegu', 403, (await call(org('/invitations'), { method: 'POST', body: { email: `q-${STAMP}@example.test`, roleId: 'approver' }, token: quality })).status);

// --- admin: firma a ludia ano, rolu vlastnika nie ---
expect('admin: meni org. strukturu', 201, (await call(org('/units'), { method: 'POST', body: { name: `Zlozka ${STAMP}` }, token: admin })).status);
expect('admin: pozve schvalovatela', 201, (await call(org('/invitations'), { method: 'POST', body: { email: `a-${STAMP}@example.test`, roleId: 'approver' }, token: admin })).status);
expect('admin: pozve vlastnika', 403, (await call(org('/invitations'), { method: 'POST', body: { email: `ao-${STAMP}@example.test`, roleId: 'owner' }, token: admin })).status);

// --- vlastnik smie vsetko ---
expect('owner: pozve vlastnika', 201, (await call(org('/invitations'), { method: 'POST', body: { email: `oo-${STAMP}@example.test`, roleId: 'owner' }, token: owner })).status);
expect('owner: meni nazov firmy', 200, (await call(org(''), { method: 'PATCH', body: { name: `Org Test prava ${STAMP}` }, token: owner })).status);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(36)} čakané ${r.expected}, dostal ${r.actual}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
