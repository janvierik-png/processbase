/**
 * Schvalovanie verzie procesu (#37 GOV-01, scenar 3 cely) so syntetickymi udajmi.
 *
 * Po v1 editor upravi krok a odosle navrh na schvalenie. Citatel stale vidi v1,
 * schvalovatelka Jana posudi v2 a az od ucinnosti sa zobrazi v2 — presne ten
 * obsah, ktory schvalila (neskorsia uprava navrhu ho nemeni). Rozhodnutie ostava
 * pripisane Jane aj s miestom, ktore vtedy zastavala, aj po jej odchode z miesta.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/approval-test.mjs
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
    body: { acceptTerms: true, organizationName: `Org Test schvalovanie ${label} ${STAMP}`, ownerName: `Vlastnik ${label}`, email: `orgtest-schval-${label}-${STAMP}@example.test`, password: 'Heslo123456' }
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
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: `orgtest-schval-${label}-${STAMP}@example.test`, roleId }, token: owner })).payload;
  return (await call(`/invitations/${invitation?.token}/accept`, { method: 'POST', body: { name: label, password: 'Heslo123456' } })).payload?.token;
}

const editor = await member('Editor', 'quality');
const jana = await member('Jana', 'approver');
const auditor = await member('Auditor', 'iso');
const people = (await call(org('/people'), { token: owner })).payload ?? [];
const qualityHead = (await call(org('/positions'), { method: 'POST', body: { name: 'Vedúca kvality' }, token: owner })).payload;
const janaAssignment = (await call(`/positions/${qualityHead.id}/assignments`, {
  method: 'POST', body: { personId: people.find((person) => person.name === 'Jana')?.id, validFrom: dayOffset(-30) }, token: owner
})).payload;

const accountant = (await call(org('/positions'), { method: 'POST', body: { name: 'Účtovník' }, token: owner })).payload;
const proc = (await call(org('/processes'), { method: 'POST', body: { name: 'Schvaľovanie faktúr', type: 'process' }, token: owner })).payload;
await call(`/processes/${proc.id}`, { method: 'PATCH', body: { purpose: 'Faktúry sa uhradia včas.', ownerPositionId: accountant.id }, token: owner });
await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Kontrola faktúry' }] }, token: owner });
check('v1 priamo publikovana', (await call(`/processes/${proc.id}/publish`, { method: 'POST', body: {}, token: owner })).status === 201);

// --- firma zapne povinne schvalovanie ---
const setting = await call(org(''), { method: 'PATCH', body: { requireApproval: true }, token: owner });
check('nastavenie vyzadovat schvalenie', setting.payload?.requireApproval === true);

// --- editor upravi krok a odosle na schvalenie ---
await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'Kontrola faktúry do 2 dní' }] }, token: editor });
const direct = await call(`/processes/${proc.id}/publish`, { method: 'POST', body: { changeReason: 'x' }, token: editor });
check('priame publikovanie zakazane', direct.status === 409, `status ${direct.status}`);
const submitted = await call(`/processes/${proc.id}/approval-requests`, {
  method: 'POST', body: { effectiveFrom: dayOffset(5), changeReason: 'Lehota na kontrolu' }, token: editor
});
check('navrh odoslany na schvalenie', submitted.status === 201 && submitted.payload?.status === 'pending', submitted.payload?.message);
check('druha ziadost naraz odmietnuta', (await call(`/processes/${proc.id}/approval-requests`, {
  method: 'POST', body: { changeReason: 'x' }, token: editor
})).status === 409);

// neskorsia uprava navrhu nemeni to, co sa schvaluje
await call(`/processes/${proc.id}/activities`, { method: 'PUT', body: { activities: [{ title: 'NESCHVALENA uprava' }] }, token: editor });

const pendingView = (await call(`/processes/${proc.id}`, { token: owner })).payload;
check('proces ukazuje cakajucu ziadost', pendingView?.publication?.pendingApproval?.requestedBy === 'Editor');
const janaInbox = (await call('/me/approvals', { token: jana })).payload ?? [];
check('ziadost v Janinej schranke', janaInbox.some((item) => item.id === submitted.payload.id));
check('editor ju vo svojej schranke nema', !((await call('/me/approvals', { token: editor })).payload ?? []).some((item) => item.id === submitted.payload.id));

const reviewView = (await call(`/approval-requests/${submitted.payload.id}/view`, { token: jana })).payload;
check('schvalovatel vidi odoslany obsah, nie neskorsiu upravu', reviewView?.view === 'approval' && reviewView?.activities?.[0]?.title === 'Kontrola faktúry do 2 dní', reviewView?.activities?.[0]?.title);
check('ina firma obsah ziadosti nevidi', (await call(`/approval-requests/${submitted.payload.id}/view`, { token: b.token })).status === 404);

check('vlastnu ziadost neschvali', (await call(`/approval-requests/${submitted.payload.id}/approve`, { method: 'POST', body: {}, token: editor })).status === 403);
check('ISO auditor neschvaluje', (await call(`/approval-requests/${submitted.payload.id}/approve`, { method: 'POST', body: {}, token: auditor })).status === 403);
check('ina firma neschvali', (await call(`/approval-requests/${submitted.payload.id}/approve`, { method: 'POST', body: {}, token: b.token })).status === 404);

const approved = await call(`/approval-requests/${submitted.payload.id}/approve`, { method: 'POST', body: { comment: 'V poriadku' }, token: jana });
check('Jana schvalila', approved.status === 200 && approved.payload?.status === 'approved', approved.payload?.message);
check('rozhodnutie s miestom v case', approved.payload?.decision?.by === 'Jana' && approved.payload?.decision?.positions === 'Vedúca kvality', JSON.stringify(approved.payload?.decision));

// --- citatel vidi v1, od ucinnosti v2 so schvalenym obsahom ---
const nowView = (await call(`/processes/${proc.id}?view=effective`, { token: jana })).payload;
check('dnes stale v1', nowView?.version?.revision === 1 && nowView?.activities?.[0]?.title === 'Kontrola faktúry');
const laterView = (await call(`/processes/${proc.id}?view=effective&at=${dayOffset(5)}`, { token: jana })).payload;
check('od ucinnosti v2', laterView?.version?.revision === 2);
check('v2 = schvaleny obsah, nie neskorsia uprava', laterView?.activities?.[0]?.title === 'Kontrola faktúry do 2 dní', laterView?.activities?.[0]?.title);
check('v2: autor editor, schvalila Jana', laterView?.version?.publishedBy === 'Editor' && laterView?.version?.approvedBy === 'Jana');
check('navrh ma dalej neschvalenu upravu', (await call(`/processes/${proc.id}`, { token: owner })).payload?.publication?.hasDraftChanges === true);

// --- Jana odide z miesta — historia ostava ---
await call(`/assignments/${janaAssignment?.id}`, { method: 'PATCH', body: { validTo: dayOffset(0) }, token: owner });
const history = (await call(`/processes/${proc.id}/approval-requests`, { token: owner })).payload ?? [];
const record = history.find((item) => item.id === submitted.payload.id);
check('schvalenie ostava pripisane Jane s miestom', record?.decision?.by === 'Jana' && record.decision.positions === 'Vedúca kvality');

// --- zamietnutie a stiahnutie ---
const second = (await call(`/processes/${proc.id}/approval-requests`, { method: 'POST', body: { effectiveFrom: dayOffset(6), changeReason: 'Dalsia zmena' }, token: editor })).payload;
check('zamietnutie bez dovodu odmietnute', (await call(`/approval-requests/${second?.id}/reject`, { method: 'POST', body: {}, token: jana })).status === 400);
const rejected = await call(`/approval-requests/${second?.id}/reject`, { method: 'POST', body: { comment: 'Chýba zdôvodnenie' }, token: owner });
check('zamietnute s dovodom', rejected.payload?.status === 'rejected' && rejected.payload?.decision?.comment === 'Chýba zdôvodnenie');
check('zamietnutim nevznikla verzia', ((await call(`/processes/${proc.id}/versions`, { token: owner })).payload ?? []).length === 2);
const third = (await call(`/processes/${proc.id}/approval-requests`, { method: 'POST', body: { effectiveFrom: dayOffset(6), changeReason: 'Tretí pokus' }, token: editor })).payload;
const withdrawn = await call(`/approval-requests/${third?.id}/withdraw`, { method: 'POST', body: {}, token: editor });
check('ziadatel ziadost stiahol', withdrawn.payload?.status === 'withdrawn');
check('vybavenu ziadost nemozno schvalit', (await call(`/approval-requests/${third?.id}/approve`, { method: 'POST', body: {}, token: jana })).status === 409);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
