/**
 * Verzie procesu (#27 CORE-01, scenar 3 bez schvalovania) so syntetickymi udajmi.
 *
 * Po publikovani v1 editor upravi proces. Citatel stale vidi v1; v2 s buducou
 * ucinnostou sa zobrazi az od svojho dna. Publikovana verzia sa nemeni,
 * stav procesu sa neda nastavit rucne a historia (dokumenty, proces) je chranena.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/process-versions-test.mjs
 *             (alebo v CI: node scripts/process-versions-test.mjs)
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

// rovnaky den ako server (casove pasmo firmy), nie UTC
const dayOffset = (days) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' })
  .format(new Date(Date.now() + days * 86400000));

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { organizationName: `Org Test verzie ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-verzie-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Faktúra je skontrolovaná a uhradená včas.' }, token: t });
// minimum na publikovanie (#28): krok a vlastnik podla miesta
const accountant = (await call(`/organizations/${a.orgId}/positions`, { method: 'POST', body: { name: 'Účtovník' }, token: t })).payload;
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { ownerPositionId: accountant?.id }, token: t });
await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Skontrolovať faktúru' }] }, token: t });

// --- pred publikovanim ---
const fresh = (await call(`/processes/${proc.id}`, { token: t })).payload;
check('novy proces je navrh', fresh?.status === 'Návrh' && fresh?.publication?.latestRevision === 0, fresh?.status);
check('bez platnej verzie: effective view 404', (await call(`/processes/${proc.id}?view=effective`, { token: t })).status === 404);
const manual = await call(`/processes/${proc.id}`, { method: 'PATCH', body: { status: 'Schválené' }, token: t });
check('stav sa neda nastavit rucne', manual.payload?.status === 'Návrh', manual.payload?.status);

// --- v1 ---
const backdated = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { effectiveFrom: dayOffset(-1) }, token: t });
check('spatna ucinnost odmietnuta', backdated.status === 400, `status ${backdated.status}`);
const v1 = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { nextReviewAt: dayOffset(365) }, token: t });
check('v1 publikovana', v1.status === 201 && v1.payload?.revision === 1 && v1.payload?.state === 'effective', JSON.stringify(v1.payload));
const same = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { changeReason: 'nic' }, token: t });
check('bez zmien sa nepublikuje', same.status === 409, `status ${same.status}`);

// --- uprava po publikovani = navrh, citatel vidi v1 ---
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'NOVY ucel v navrhu' }, token: t });
const draft = (await call(`/processes/${proc.id}`, { token: t })).payload;
check('navrh ma zmeny oproti v1', draft?.publication?.hasDraftChanges === true && draft?.purpose === 'NOVY ucel v navrhu');
const effective = (await call(`/processes/${proc.id}?view=effective`, { token: t })).payload;
check('citatel vidi v1', effective?.version?.revision === 1 && effective?.purpose === 'Faktúra je skontrolovaná a uhradená včas.', effective?.purpose);
check('stav: platna v1', draft?.status === 'Platná v1', draft?.status);

// --- v2 s buducou ucinnostou ---
const noReason = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { effectiveFrom: dayOffset(7) }, token: t });
check('v2 bez dovodu zmeny odmietnuta', noReason.status === 400, `status ${noReason.status}`);
const v2 = await call(`/processes/${proc.id}/publish`, {
  method: 'POST', body: { effectiveFrom: dayOffset(7), changeReason: 'Nový účel podľa auditu' }, token: t
});
check('v2 naplanovana', v2.status === 201 && v2.payload?.state === 'scheduled', JSON.stringify(v2.payload));
const today = (await call(`/processes/${proc.id}?view=effective`, { token: t })).payload;
check('dnes stale plati v1', today?.version?.revision === 1);
const dayBefore = (await call(`/processes/${proc.id}?view=effective&at=${dayOffset(6)}`, { token: t })).payload;
check('den pred ucinnostou v2 plati v1', dayBefore?.version?.revision === 1);
const later = (await call(`/processes/${proc.id}?view=effective&at=${dayOffset(7)}`, { token: t })).payload;
check('od ucinnosti plati v2', later?.version?.revision === 2 && later?.purpose === 'NOVY ucel v navrhu');

const versions = (await call(`/processes/${proc.id}/versions`, { token: t })).payload ?? [];
const v1row = versions.find((version) => version.revision === 1);
check('v1 plati do dna pred v2', v1row?.effectiveTo === dayOffset(6), v1row?.effectiveTo);
check('historia verzii s autorom a dovodom', versions[0]?.publishedBy === 'Vlastnik a' && versions[0]?.changeReason === 'Nový účel podľa auditu');

// --- publikovana verzia sa nemeni ---
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { name: 'Premenovaný návrh' }, token: t });
const v1view = (await call(`/processes/${proc.id}/versions/1`, { token: t })).payload;
check('snapshot v1 nezmeneny', v1view?.name === 'Schvaľovanie faktúr' && v1view?.purpose === 'Faktúra je skontrolovaná a uhradená včas.', v1view?.name);
const earlier = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { effectiveFrom: dayOffset(3), changeReason: 'x' }, token: t });
check('v3 nemoze platit skor ako naplanovana v2', earlier.status === 400, `status ${earlier.status}`);

// --- ochrana historie ---
const doc = (await call(`/processes/${proc.id}/documents`, {
  method: 'POST', body: { fileName: 'smernica.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,QQ==' }, token: t
})).payload;
await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { effectiveFrom: dayOffset(7), changeReason: 'Pridana smernica' }, token: t });
const delDoc = await call(`/documents/${doc?.id}`, { method: 'DELETE', token: t });
check('dokument publikovanej verzie nemozno zmazat', delDoc.status === 409, `status ${delDoc.status}`);
const delProc = await call(`/processes/${proc.id}`, { method: 'DELETE', token: t });
check('proces s verziami nemozno zmazat', delProc.status === 409, `status ${delProc.status}`);

// --- izolacia a opravnenia ---
check('firma B necita verzie A', (await call(`/processes/${proc.id}/versions`, { token: b.token })).status === 404);
check('firma B necita platnu verziu A', (await call(`/processes/${proc.id}?view=effective`, { token: b.token })).status === 404);
check('firma B nepublikuje proces A', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: b.token })).status === 404);
const invitation = (await call(`/organizations/${a.orgId}/invitations`, { method: 'POST', body: { email: `orgtest-verzie-sch-${STAMP}@example.test`, roleId: 'approver' }, token: t })).payload;
const approver = (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: 'Schvalovatel', password: 'Heslo123456' } })).payload?.token;
check('schvalovatel nepublikuje', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { changeReason: 'x' }, token: approver })).status === 403);
check('schvalovatel cita platnu verziu', (await call(`/processes/${proc.id}?view=effective`, { token: approver })).status === 200);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
