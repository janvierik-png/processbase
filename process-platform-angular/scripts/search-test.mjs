/**
 * Globalne vyhladavanie (#35 UX-01c) so syntetickymi udajmi.
 *
 * Scenar 7: vyhladavanie nevrati nazov ani metadata inej firmy — ani ked ma
 * ina firma rovnake slova. Vysledky rozlisuju platnu verziu, navrh a archiv
 * (nahradene verzie); hlada sa bez ohladu na diakritiku a podla zaciatku slova.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/search-test.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

async function call(path, { method = 'GET', body, token, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof Uint8Array)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { organizationName: `Org Test hladanie ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-hladanie-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
  });
  return { token: reg.payload?.token, orgId: reg.payload?.organization?.id };
}

const a = await register('a');
const b = await register('b');
if (!a.token || !b.token) {
  console.error('Testovacie firmy sa nepodarilo zalozit — bezi API?');
  process.exit(2);
}
const search = (q, token = a.token) => call(`/search?q=${encodeURIComponent(q)}`, { token });

async function setup(side, name, code) {
  const org = (path) => `/organizations/${side.orgId}${path}`;
  const position = (await call(org('/positions'), { method: 'POST', body: { name: 'Účtovník reklamácií' }, token: side.token })).payload;
  const proc = (await call(org('/processes'), { method: 'POST', body: { name, type: 'process', code }, token: side.token })).payload;
  await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Starý postup vybavenia reklamácie.', ownerPositionId: position.id }, token: side.token });
  await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Posúdenie reklamácie' }] }, token: side.token });
  await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: side.token });
  // v2 nahradi v1 (v1 = archiv); navrh potom dostane novu vetu
  await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Reklamácia sa vybaví do 30 dní.' }, token: side.token });
  await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { changeReason: 'Lehota' }, token: side.token });
  await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Posúdenie reklamácie' }, { title: 'Fotodokumentácia poškodenia' }] }, token: side.token });
  const document = await call(`/processes/${proc.id}/documents`, {
    method: 'POST', token: side.token, body: new TextEncoder().encode('obsah'),
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('Reklamačný poriadok.pdf'), 'X-File-Type': 'application/pdf' }
  });
  return { proc, position, document: document.payload };
}

const mine = await setup(a, 'Vybavenie reklamácie', 'RK-01');
const theirs = await setup(b, 'Tajná reklamácia inej firmy', 'TAJ-99');

// --- scenar 7: nic z inej firmy ---
const all = (await search('reklamacia')).payload;
const text = JSON.stringify(all);
check('najde vlastny proces', all?.processes?.some((item) => item.id === mine.proc.id));
check('ziadny proces inej firmy', !all?.processes?.some((item) => item.id === theirs.proc.id));
check('ani nazov ci kod inej firmy v odpovedi', !text.includes('Tajná') && !text.includes('TAJ-99') && !text.includes(theirs.proc.id), text.slice(0, 200));
check('miesto a dokument inej firmy nie', !text.includes(theirs.position.id) && !text.includes(theirs.document?.id ?? 'x'));
check('cudzi kod hladany priamo → nic', ((await search('TAJ-99')).payload?.processes ?? []).length === 0);
check('bez prihlasenia → 401', (await call('/search?q=reklamacia')).status === 401);

// --- platne / navrh / archiv ---
const hit = all?.processes?.find((item) => item.id === mine.proc.id);
const kinds = (hit?.matches ?? []).map((match) => `${match.kind}${match.revision ? `:v${match.revision}` : ''}`);
check('platna verzia v2 oznacena', hit?.matches?.some((match) => match.kind === 'published' && match.revision === 2 && match.state === 'effective'), JSON.stringify(kinds));
const archiveOnly = (await search('stary postup')).payload?.processes?.find((item) => item.id === mine.proc.id);
check('stary text len v archive v1', archiveOnly?.matches?.length === 1 && archiveOnly.matches[0].kind === 'archive' && archiveOnly.matches[0].revision === 1,
  JSON.stringify(archiveOnly?.matches));
const draftOnly = (await search('foto')).payload?.processes?.find((item) => item.id === mine.proc.id);
check('novy krok len v navrhu (predpona slova)', draftOnly?.matches?.length === 1 && draftOnly.matches[0].kind === 'draft', JSON.stringify(draftOnly?.matches));

// --- diakritika, kod, miesta, dokumenty, uryvok ---
check('bez diakritiky najde „reklamácie“', ((await search('vybavenie reklamacie')).payload?.processes ?? []).some((item) => item.id === mine.proc.id));
check('podla kodu', ((await search('rk-01')).payload?.processes ?? []).some((item) => item.id === mine.proc.id && item.code === 'RK-01'));
check('pracovne miesto', ((await search('uctovnik')).payload?.positions ?? []).some((item) => item.id === mine.position.id));
check('dokument podla nazvu', ((await search('reklamacny poriadok')).payload?.documents ?? []).some((item) => item.id === mine.document?.id && item.processId === mine.proc.id));
const snippet = draftOnly?.matches?.[0]?.snippet;
check('uryvok ukazuje zhodu', snippet && snippet.text.slice(snippet.start, snippet.start + snippet.length).toLowerCase() === 'foto', JSON.stringify(snippet));

// --- odolnost ---
check('kratky dopyt → prazdny vysledok', ((await search('r')).payload?.processes ?? []).length === 0);
const weird = await search(`reklam' & | ! :* ( )`);
check('specialne znaky nerozbiju dopyt', weird.status === 200 && weird.payload?.processes?.some((item) => item.id === mine.proc.id), `${weird.status}`);
check('HTML v dopyte → 200, len hladane slova', (await search('<script>alert(1)</script>')).status === 200);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
