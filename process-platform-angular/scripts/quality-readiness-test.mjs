/**
 * Riadeny proces a pripravenost evidencie (#40 QUAL-01, scenare 4 a 5) so syntetickymi udajmi.
 *
 * Scenar 4: bez profilu „Kvalita a audit“ sa kontrolne otazky neukazuju; po
 * zapnuti spravca kvality vidi konkretne chybajuce meradlo, dokaz a termin
 * revizie. Nikde nie je percento ani „certifikovany“.
 * Scenar 5: platny postup je „hotove“, no chybajuci zaznam o vykonanej
 * kontrole je „chyba“ — postup nie je dokaz.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/quality-readiness-test.mjs
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
    body: { acceptTerms: true, organizationName: `Org Test kvalita ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-kval-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-kval-${label}-${STAMP}@example.test`, roleId }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}
const auditor = await member('Auditor', 'iso');
const worker = await member('Marek', 'approver');   // vykonava proces, nema pravo upravovat
const outsider = await member('Zuzana', 'approver'); // s procesom nema nic
const people = (await call(org('/people'), { token: owner })).payload ?? [];

const accountant = (await call(org('/positions'), { method: 'POST', body: { name: 'Účtovník' }, token: owner })).payload;
const clerk = (await call(org('/positions'), { method: 'POST', body: { name: 'Referent' }, token: owner })).payload;
await call(`/positions/${accountant.id}/assignments`, { method: 'POST', body: { personId: people[0]?.id, validFrom: dayOffset(-10) }, token: owner });
await call(`/positions/${clerk.id}/assignments`, { method: 'POST', body: { personId: people.find((person) => person.name === 'Marek')?.id, validFrom: dayOffset(-10) }, token: owner });

const proc = (await call(org('/processes'), { method: 'POST', body: { name: 'Kontrola faktúr', type: 'process' }, token: owner })).payload;
const saved = await call(`/processes/${proc.id}`, {
  method: 'PATCH', token: owner,
  body: {
    purpose: 'Faktúry sa uhradia správne a včas.', ownerPositionId: accountant.id, positionIds: [clerk.id], outcome: 'Uhradená faktúra',
    evidenceRequirements: ['Protokol kontroly faktúr', 'Mesačný súhrn úhrad', ' Protokol kontroly faktúr ']
  }
});
check('zaznamy ulozene bez duplicit', JSON.stringify(saved.payload?.evidenceRequirements) === JSON.stringify(['Protokol kontroly faktúr', 'Mesačný súhrn úhrad']), JSON.stringify(saved.payload?.evidenceRequirements));
await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Kontrola', raci: [{ role: 'A', positionId: accountant.id }, { role: 'R', positionId: clerk.id }] }] }, token: owner });
check('v1 publikovana s terminom revizie', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { nextReviewAt: dayOffset(60) }, token: owner })).status === 201);

// --- scenar 4: bez profilu nic ---
check('bez profilu: kontrolne otazky vypnute', (await call(`/processes/${proc.id}/quality`, { token: owner })).payload?.enabled === false);
check('zapnutie profilu Kvalita a audit', (await call(org(''), { method: 'PATCH', body: { qualityProfile: true }, token: owner })).payload?.qualityProfile === true);
check('bezny zamestnanec pripravenost nevidi → 403', (await call(`/processes/${proc.id}/quality`, { token: worker })).status === 403);
check('ina firma → 404', (await call(`/processes/${proc.id}/quality`, { token: b.token })).status === 404);

let quality = (await call(`/processes/${proc.id}/quality`, { token: auditor })).payload;
const state = () => Object.fromEntries((quality?.items ?? []).map((item) => [item.key, item.state]));
const detail = (key) => quality?.items?.find((item) => item.key === key)?.detail ?? '';
check('ISO auditor vidi pripravenost', quality?.enabled === true && quality.source === 'platná v1', JSON.stringify(quality?.source));
check('hotove: postup, vlastnik, zodpovedny, vystup, revizia', ['procedure', 'owner', 'accountable', 'outputs', 'review', 'evidenceDefined'].every((key) => state()[key] === 'done'), JSON.stringify(state()));
check('chyba konkretne meradlo uspechu', state().measure === 'attention' && detail('measure').includes('podľa čoho viete'), detail('measure'));
check('chybajuce vstupy a rizika', state().inputs === 'attention' && state().risks === 'attention');
// scenar 5
check('postup je, dokaz o kontrole chyba', state().procedure === 'done' && state()['evidence:Protokol kontroly faktúr'] === 'attention'
  && detail('evidence:Protokol kontroly faktúr').startsWith('Chýba'), detail('evidence:Protokol kontroly faktúr'));
const text = JSON.stringify(quality);
check('ziadne percento ani certifikacia', !/certifik|%|vyhovuj/i.test(text), text.match(/certifik|%|vyhovuj/i)?.[0]);
check('uvedene, ze nejde o zhodu', quality?.note?.includes('nie hodnotenie zhody'));

// doplnenie v navrhu este neplati
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { inputs: ['Faktúra od dodávateľa'] }, token: owner });
quality = (await call(`/processes/${proc.id}/quality`, { token: owner })).payload;
check('doplnene v navrhu — plati az po publikovani', state().inputs === 'attention' && detail('inputs').includes('Doplnené v návrhu'), detail('inputs'));

// --- zaznamy o vykonani ---
const recorded = await call(`/processes/${proc.id}/evidence`, { method: 'POST', body: { requirement: 'Protokol kontroly faktúr', performedOn: dayOffset(-2), note: 'Kontrola za september' }, token: worker });
check('vykonavatel zapise zaznam', recorded.status === 201, `${recorded.status} ${recorded.payload?.message}`);
await call(`/processes/${proc.id}/evidence`, { method: 'POST', body: { requirement: 'Mesačný súhrn úhrad', performedOn: dayOffset(-400) }, token: owner });
check('neznamy zaznam → 400', (await call(`/processes/${proc.id}/evidence`, { method: 'POST', body: { requirement: 'Niečo iné' }, token: owner })).status === 400);
check('zaznam z buducnosti → 400', (await call(`/processes/${proc.id}/evidence`, { method: 'POST', body: { requirement: 'Protokol kontroly faktúr', performedOn: dayOffset(1) }, token: owner })).status === 400);
check('clovek bez vztahu k procesu → 403', (await call(`/processes/${proc.id}/evidence`, { method: 'POST', body: { requirement: 'Protokol kontroly faktúr' }, token: outsider })).status === 403);
check('ina firma → 404', (await call(`/processes/${proc.id}/evidence`, { method: 'POST', body: { requirement: 'Protokol kontroly faktúr' }, token: b.token })).status === 404);
quality = (await call(`/processes/${proc.id}/quality`, { token: owner })).payload;
check('dokaz zapisany → hotove', state()['evidence:Protokol kontroly faktúr'] === 'done' && detail('evidence:Protokol kontroly faktúr').includes('Marek'), detail('evidence:Protokol kontroly faktúr'));
check('stary zaznam → neoverene', state()['evidence:Mesačný súhrn úhrad'] === 'unverified', detail('evidence:Mesačný súhrn úhrad'));
check('zoznam zaznamov', ((await call(`/processes/${proc.id}/evidence`, { token: worker })).payload ?? []).length === 2);

// --- neaplikovatelne s dovodom a schvalenim ---
check('bez dovodu → 400', (await call(`/processes/${proc.id}/readiness-exceptions`, { method: 'POST', body: { itemKey: 'risks' }, token: auditor })).status === 400);
check('postup neaplikovatelny byt nemoze → 400', (await call(`/processes/${proc.id}/readiness-exceptions`, { method: 'POST', body: { itemKey: 'procedure', reason: 'x' }, token: auditor })).status === 400);
check('bezny zamestnanec vynimku nenavrhne → 403', (await call(`/processes/${proc.id}/readiness-exceptions`, { method: 'POST', body: { itemKey: 'risks', reason: 'x' }, token: worker })).status === 403);
const exception = (await call(`/processes/${proc.id}/readiness-exceptions`, { method: 'POST', body: { itemKey: 'risks', reason: 'Proces je čisto evidenčný, riziká rieši nadradený proces.' }, token: auditor })).payload;
quality = (await call(`/processes/${proc.id}/quality`, { token: owner })).payload;
check('navrh vynimky este neplati', state().risks === 'attention' && quality.items.find((item) => item.key === 'risks')?.exception?.pending === true);
check('ISO auditor vynimku neschvali → 403', (await call(`/readiness-exceptions/${exception?.id}/approve`, { method: 'POST', body: {}, token: auditor })).status === 403);
check('ina firma neschvali → 404', (await call(`/readiness-exceptions/${exception?.id}/approve`, { method: 'POST', body: {}, token: b.token })).status === 404);
check('vlastnik schvali', (await call(`/readiness-exceptions/${exception?.id}/approve`, { method: 'POST', body: {}, token: owner })).status === 200);
quality = (await call(`/processes/${proc.id}/quality`, { token: owner })).payload;
const risk = quality?.items?.find((item) => item.key === 'risks');
check('neaplikovatelne s dovodom a kto schvalil', risk?.state === 'na' && risk.detail.includes('evidenčný') && risk.exception?.approvedBy === 'Vlastnik a' && risk.exception?.markedBy === 'Auditor',
  JSON.stringify(risk));

// --- riadeny proces vo verzii ---
check('v2 prevzala vstupy', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { changeReason: 'Vstupy', nextReviewAt: dayOffset(90) }, token: owner })).status === 201);
const effective = (await call(`/processes/${proc.id}?view=effective`, { token: worker })).payload;
check('platna verzia ukazuje vstupy a zaznamy', effective?.inputs?.[0] === 'Faktúra od dodávateľa' && effective?.evidenceRequirements?.length === 2);
const other = (await call(org('/processes'), { method: 'POST', body: { name: 'Úhrady', type: 'process' }, token: owner })).payload;
const linked = await call(`/processes/${proc.id}`, { method: 'PATCH', body: { downstreamProcessIds: [other.id, proc.id] }, token: owner });
check('nasledujuci proces (bez seba)', JSON.stringify(linked.payload?.downstreamProcessIds) === JSON.stringify([other.id]), JSON.stringify(linked.payload?.downstreamProcessIds));
const foreign = (await call(`/organizations/${b.orgId}/processes`, { method: 'POST', body: { name: 'Cudzí', type: 'process' }, token: b.token })).payload;
check('nadvaznost na proces inej firmy → 404', (await call(`/processes/${proc.id}`, { method: 'PATCH', body: { upstreamProcessIds: [foreign.id] }, token: owner })).status === 404);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(50)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
