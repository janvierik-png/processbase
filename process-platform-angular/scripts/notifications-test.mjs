/**
 * Upozornenia z domenovych udalosti (#38 GOV-02) so syntetickymi udajmi.
 *
 * Udalost sa zapise spolu so zmenou (outbox), dispecer z nej vyrobi upozornenia
 * pre dotknutych ludi — podla miest, ktore zastavaju — nikdy nie pre autora
 * zmeny a nikdy mimo firmy. Opakovana kontrola terminu revizie neupozorni dvakrat.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/notifications-test.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

const dayOffset = (days) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' })
  .format(new Date(Date.now() + days * 86400000));

/** Dispecer bezi asynchronne — pockat, kym upozornenie pride (najviac ~6 s). */
async function inbox(token, predicate = () => true) {
  let last = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    last = (await call('/me/notifications', { token })).payload;
    if ((last?.items ?? []).some(predicate)) return last;
    await sleep(200);
  }
  return last;
}
const has = (box, type, text) => (box?.items ?? []).some((item) => item.type === type && (!text || `${item.title} ${item.body ?? ''}`.includes(text)));

async function register(label) {
  const reg = await call('/register', {
    method: 'POST',
    body: { organizationName: `Org Test upozornenia ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-upoz-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-upoz-${label}-${STAMP}@example.test`, roleId }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}
const eva = await member('Eva', 'quality');     // editorka
const jana = await member('Jana', 'approver');  // schvalovatelka
const peter = await member('Peter', 'iso');     // zastava miesto vlastnika
const marek = await member('Marek', 'iso');     // vykonavatel
const people = (await call(org('/people'), { token: owner })).payload ?? [];
const personId = (name) => people.find((person) => person.name === name)?.id;

const head = (await call(org('/positions'), { method: 'POST', body: { name: 'Vedúci skladu' }, token: owner })).payload;
const clerk = (await call(org('/positions'), { method: 'POST', body: { name: 'Skladník' }, token: owner })).payload;
await call(`/positions/${head.id}/assignments`, { method: 'POST', body: { personId: personId('Peter'), validFrom: dayOffset(-5) }, token: owner });
await call(`/positions/${clerk.id}/assignments`, { method: 'POST', body: { personId: personId('Marek'), validFrom: dayOffset(-5) }, token: owner });

let petersBox = await inbox(peter, (item) => item.type === 'PositionAssignmentChanged');
check('obsadenie miesta: Peter upozorneny', has(petersBox, 'PositionAssignmentChanged', 'Vedúci skladu'), JSON.stringify(petersBox?.items?.map((i) => i.title)));
check('vlastnik firmy (autor) o obsadeni upozorneny nie je', !has((await call('/me/notifications', { token: owner })).payload, 'PositionAssignmentChanged'));

const proc = (await call(org('/processes'), { method: 'POST', body: { name: 'Expedícia', type: 'process' }, token: owner })).payload;
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Tovar odíde včas.', ownerPositionId: head.id, positionIds: [clerk.id] }, token: owner });
await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Balenie' }] }, token: owner });
check('v1 publikovana', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { nextReviewAt: dayOffset(10) }, token: owner })).status === 201);

petersBox = await inbox(peter, (item) => item.type === 'ReviewDue');
check('publikovanie: vlastnik miesta upozorneny', has(petersBox, 'ProcessPublished', 'v1 platí od'), JSON.stringify(petersBox?.items?.map((i) => i.title)));
check('revizia do 30 dni: vlastnik upozorneny', has(petersBox, 'ReviewDue', 'Blíži sa revízia'));
const marekBox = await inbox(marek, (item) => item.type === 'ProcessPublished');
check('publikovanie: vykonavatel upozorneny', has(marekBox, 'ProcessPublished', 'Expedícia'));
check('revizia nie vykonavatelovi', !has(marekBox, 'ReviewDue'));
check('autor publikovania upozorneny nie je', !has((await call('/me/notifications', { token: owner })).payload, 'ProcessPublished'));
check('clovek bez vztahu k procesu nic', !has((await call('/me/notifications', { token: jana })).payload, 'ProcessPublished'));

// --- schvalovanie ---
await call(org(''), { method: 'PATCH', body: { requireApproval: true }, token: owner });
await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Balenie a štítok' }] }, token: eva });
const submitted = await call(`/processes/${proc.id}/approval-requests`, { method: 'POST', body: { changeReason: 'Štítok na balík' }, token: eva });
const janasBox = await inbox(jana, (item) => item.type === 'ApprovalRequested');
check('ziadost: schvalovatelka upozornena s odkazom', has(janasBox, 'ApprovalRequested', 'Štítok na balík')
  && janasBox.items.find((item) => item.type === 'ApprovalRequested')?.link?.includes(`approval=${submitted.payload?.id}`));
check('ziadost: vlastnik firmy (schvaluje) upozorneny', has(await inbox(owner, (item) => item.type === 'ApprovalRequested'), 'ApprovalRequested'));
check('ziadatelka o svojej ziadosti upozornena nie je', !has((await call('/me/notifications', { token: eva })).payload, 'ApprovalRequested'));
await call(`/approval-requests/${submitted.payload?.id}/approve`, { method: 'POST', body: { comment: 'Súhlasím' }, token: jana });
const evasBox = await inbox(eva, (item) => item.type === 'ApprovalDecided');
check('rozhodnutie: ziadatelka upozornena', has(evasBox, 'ApprovalDecided', 'schválený') && has(evasBox, 'ApprovalDecided', 'Súhlasím'));
check('v2: vykonavatel upozorneny', has(await inbox(marek, (item) => item.type === 'ProcessPublished' && item.body?.startsWith('v2')), 'ProcessPublished', 'v2 platí od'));

// --- podnety ---
const feedback = await call(`/processes/${proc.id}/feedback`, { method: 'POST', body: { kind: 'error', text: 'Chýba váženie balíka.' }, token: marek });
petersBox = await inbox(peter, (item) => item.type === 'FeedbackSubmitted');
check('podnet: vlastnik miesta upozorneny', has(petersBox, 'FeedbackSubmitted', 'Chýba váženie balíka.'));
check('autor podnetu o svojom podnete nie', !has((await call('/me/notifications', { token: marek })).payload, 'FeedbackSubmitted'));
await call(`/feedback/${feedback.payload?.id}/decide`, { method: 'POST', body: { status: 'done', note: 'Doplnené do kroku.' }, token: peter });
check('vybavenie podnetu: autor upozorneny', has(await inbox(marek, (item) => item.type === 'FeedbackDecided'), 'FeedbackDecided', 'Doplnené do kroku.'));

// --- precitanie ---
petersBox = (await call('/me/notifications', { token: peter })).payload;
const unreadBefore = petersBox?.unread ?? 0;
const one = petersBox?.items?.[0]?.id;
check('oznacenie jedneho', (await call('/me/notifications/read', { method: 'POST', body: { ids: [one] }, token: peter })).payload?.marked === 1);
check('neprecitanych o jedno menej', (await call('/me/notifications', { token: peter })).payload?.unread === unreadBefore - 1);
const marekItem = (await call('/me/notifications', { token: marek })).payload?.items?.[0]?.id;
check('cudzie upozornenie oznacit nejde', (await call('/me/notifications/read', { method: 'POST', body: { ids: [marekItem] }, token: peter })).payload?.marked === 0);
check('Markovo ostalo neprecitane', (await call('/me/notifications', { token: marek })).payload?.items?.find((item) => item.id === marekItem)?.read === false);
await call('/me/notifications/read', { method: 'POST', body: { all: true }, token: peter });
check('vsetky precitane', (await call('/me/notifications', { token: peter })).payload?.unread === 0);
check('bez ids ani all → 400', (await call('/me/notifications/read', { method: 'POST', body: {}, token: peter })).status === 400);

// --- ina firma a duplicity ---
check('ina firma nevidi nic', ((await call('/me/notifications', { token: b.token })).payload?.items ?? []).length === 0);
// dalsie publikovanie s terminom revizie spusti novu kontrolu — v1 sa neupozorni znova
const second = (await call(org('/processes'), { method: 'POST', body: { name: 'Príjem', type: 'process' }, token: owner })).payload;
await call(org(''), { method: 'PATCH', body: { requireApproval: false }, token: owner });
await call(`/processes/${second.id}`, { method: 'PATCH', body: { purpose: 'Tovar sa prijme.', ownerPositionId: head.id }, token: owner });
await call(`/processes/${second.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Kontrola' }] }, token: owner });
await call(`/processes/${second.id}/publish`, { method: 'POST', body: { nextReviewAt: dayOffset(5) }, token: owner });
petersBox = await inbox(peter, (item) => item.type === 'ReviewDue' && item.title.includes('Príjem'));
const reviewTitles = (petersBox?.items ?? []).filter((item) => item.type === 'ReviewDue').map((item) => item.title);
check('revizia noveho procesu', reviewTitles.some((title) => title.includes('Príjem')), JSON.stringify(reviewTitles));
check('revizia v1 sa neopakuje', reviewTitles.filter((title) => title.includes('Expedícia')).length === 1,
  JSON.stringify(reviewTitles));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(52)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
