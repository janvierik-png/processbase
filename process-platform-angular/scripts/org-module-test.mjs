/**
 * Overenie organizacneho modulu (#12–#15) so syntetickymi udajmi.
 *
 * Pokryva akceptacne scenare zo zadania: strom bez cyklov, osoba bez uctu sa
 * nepocita ako pouzivatel, obsadenie s obdobim platnosti a odchod, vlastnik
 * procesu podla miesta (po zmene obsadenia novy clovek, audit ostava povodny)
 * a neobsadena zodpovednost je viditelna.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/org-module-test.mjs
 *
 * Firma „Org Test <cas>" v DB zostane. Upratanie:
 *   delete from "Organization" where name like 'Org Test %';
 *   delete from "User" where email like 'orgtest-%@example.test';
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const results = [];
let token = null;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
}

async function call(path, { method = 'GET', body, auth = token } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

// rovnaky den ako server (casove pasmo firmy), nie UTC
const dayOffset = (days) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(Date.now() + days * 86400000));

async function main() {
  const ownerEmail = `orgtest-${STAMP}@example.test`;
  const reg = await call('/register', {
    method: 'POST',
    body: { acceptTerms: true, organizationName: `Org Test ${STAMP}`, ownerName: 'Majitel Firmy', email: ownerEmail, password: 'Heslo123456' }
  });
  token = reg.payload?.token;
  const orgId = reg.payload?.organization?.id;
  if (!token || !orgId) {
    console.error('Testovaciu firmu sa nepodarilo zalozit — bezi API?');
    process.exit(2);
  }
  const org = (path) => `/organizations/${orgId}${path}`;

  // --- #12 strom zloziek a nadriadenost miest ---
  const unitA = (await call(org('/units'), { method: 'POST', body: { name: 'Vedenie' } })).payload;
  const unitB = (await call(org('/units'), { method: 'POST', body: { name: 'Kvalita', parentId: unitA.id } })).payload;
  const unitC = (await call(org('/units'), { method: 'POST', body: { name: 'Audit', parentId: unitB.id } })).payload;
  check('#12 zlozka s nadradenou', unitC?.parentId === unitB?.id);
  const cycle = await call(`/units/${unitA.id}`, { method: 'PATCH', body: { parentId: unitC.id } });
  check('#12 cyklus zloziek odmietnuty', cycle.status === 400, `status ${cycle.status}`);
  const self = await call(`/units/${unitA.id}`, { method: 'PATCH', body: { parentId: unitA.id } });
  check('#12 zlozka pod sebou odmietnuta', self.status === 400, `status ${self.status}`);
  await call(`/units/${unitB.id}`, { method: 'DELETE' });
  const units = (await call(org('/units'))).payload ?? [];
  check('#12 po zmazani sa podriadena posunie vyssie', units.find((unit) => unit.id === unitC.id)?.parentId === unitA.id);

  const director = (await call(org('/positions'), { method: 'POST', body: { name: 'Riaditel', unitId: unitA.id } })).payload;
  const qm = (await call(org('/positions'), {
    method: 'POST', body: { name: 'Manazer kvality', unitId: unitC.id, reportsToId: director.id }
  })).payload;
  check('#12 nadriadene miesto', qm?.reportsToName === 'Riaditel');
  const posCycle = await call(`/positions/${director.id}`, { method: 'PATCH', body: { reportsToId: qm.id } });
  check('#12 cyklus nadriadenosti odmietnuty', posCycle.status === 400, `status ${posCycle.status}`);

  // --- #13 osoba bez uctu ---
  const usersBefore = (await call(org('/users'))).payload?.length;
  const jana = (await call(org('/people'), { method: 'POST', body: { name: 'Jana Kvalitna', email: 'jana@example.test' } })).payload;
  const peter = (await call(org('/people'), { method: 'POST', body: { name: 'Peter Novy' } })).payload;
  const people = (await call(org('/people'))).payload ?? [];
  check('#13 osoba bez uctu v adresari', jana?.hasAccount === false && people.some((person) => person.id === jana.id));
  check('#13 majitel ma osobu s uctom', people.some((person) => person.hasAccount && person.email === ownerEmail));
  const usersAfter = (await call(org('/users'))).payload?.length;
  check('#13 osoby sa nepocitaju ako pouzivatelia', usersBefore === 1 && usersAfter === 1, `${usersBefore} -> ${usersAfter}`);

  // --- #14 obsadenie s obdobim platnosti ---
  const assign = await call(`/positions/${qm.id}/assignments`, { method: 'POST', body: { personId: jana.id, validFrom: dayOffset(-30) } });
  check('#14 obsadenie vytvorene', assign.status === 201, `status ${assign.status}`);
  const overlap = await call(`/positions/${qm.id}/assignments`, { method: 'POST', body: { personId: jana.id } });
  check('#14 prekryv tej istej osoby odmietnuty', overlap.status === 409, `status ${overlap.status}`);
  const badRange = await call(`/positions/${director.id}/assignments`, {
    method: 'POST', body: { personId: jana.id, validFrom: dayOffset(0), validTo: dayOffset(-1) }
  });
  check('#14 koniec pred zaciatkom odmietnuty', badRange.status === 400, `status ${badRange.status}`);
  // planovane obsadenie v buducnosti — pri odchode ma zmiznut
  await call(`/positions/${director.id}/assignments`, { method: 'POST', body: { personId: jana.id, validFrom: dayOffset(10) } });

  let positions = (await call(org('/positions'))).payload ?? [];
  check('#14 miesto ma drzitela', positions.find((p) => p.id === qm.id)?.holders?.[0]?.name === 'Jana Kvalitna');
  check('#14 buduce obsadenie nie je dnesny drzitel', positions.find((p) => p.id === director.id)?.vacant === true);

  // --- #15 vlastnik procesu podla miesta ---
  const proc = (await call(org('/processes'), { method: 'POST', body: { name: 'Riadenie nezhod', type: 'process' } })).payload;
  const setOwner = await call(`/processes/${proc.id}`, { method: 'PATCH', body: { ownerPositionId: qm.id, positionIds: [director.id] } });
  check('#15 vlastnik = drzitel miesta', setOwner.payload?.owner === 'Jana Kvalitna', setOwner.payload?.owner);
  check('#15 miesto vlastnika v detaile', setOwner.payload?.ownerPosition?.name === 'Manazer kvality');
  check('#15 vykonavatel oddeleny od vlastnika',
    setOwner.payload?.positionIds?.length === 1 && setOwner.payload.positionIds[0] === director.id);
  check('#15 neobsadena zodpovednost viditelna',
    (setOwner.payload?.vacantResponsibilities ?? []).some((item) => item.id === director.id));

  // odchod Jany vcera a nastup Petra dnes
  const leave = await call(`/people/${jana.id}/leave`, { method: 'POST', body: { date: dayOffset(-1) } });
  check('#14 odchod ukonci obsadenie', leave.status === 200 && leave.payload?.endedAssignments === 1, `status ${leave.status}`);
  check('#14 odchod ohlasi neobsadene miesto', (leave.payload?.vacatedPositions ?? []).some((p) => p.id === qm.id));
  const janaAfter = leave.payload?.person;
  check('#14 historia obsadenia ostala', janaAfter?.assignments?.length === 1 && janaAfter.assignments[0].validTo === dayOffset(-1));
  check('#14 planovane obsadenie zrusene', !(janaAfter?.assignments ?? []).some((a) => a.positionId === director.id));
  check('#14 osoba oznacena ako neaktivna', janaAfter?.active === false);

  const vacantProc = (await call(`/processes/${proc.id}`)).payload;
  check('#15 po odchode je vlastnik neobsadeny', vacantProc?.ownerPosition?.vacant === true && vacantProc?.owner === '');

  await call(`/positions/${qm.id}/assignments`, { method: 'POST', body: { personId: peter.id } });
  const newOwner = (await call(`/processes/${proc.id}`)).payload;
  check('#15 po zmene obsadenia novy clovek', newOwner?.owner === 'Peter Novy', newOwner?.owner);

  const history = (await call(`/processes/${proc.id}/history`)).payload ?? [];
  const ownerChange = history.find((entry) => entry.changedFields?.ownerPosition);
  check('#15 audit ostal na povodnom vlastnikovi',
    ownerChange?.changedFields.ownerPosition.to === 'Manazer kvality (Jana Kvalitna)', ownerChange?.changedFields?.ownerPosition?.to);
  check('#15 autor zmeny z relacie', ownerChange?.userName === 'Majitel Firmy', ownerChange?.userName);

  const deleteWithHistory = await call(`/people/${jana.id}`, { method: 'DELETE' });
  check('#14 osobu s historiou nemozno zmazat', deleteWithHistory.status === 409, `status ${deleteWithHistory.status}`);

  // --- #16 profil prace a verzie popisu ---
  const profile = (await call(org('/job-profiles'), { method: 'POST', body: { name: 'Manazer kvality', summary: 'Riadi system kvality' } })).payload;
  const linkProfile = await call(`/positions/${qm.id}`, { method: 'PATCH', body: { jobProfileId: profile?.id } });
  check('#16 miesto napla profil prace', linkProfile.payload?.jobProfileName === 'Manazer kvality');

  const v1 = (await call(`/job-profiles/${profile.id}/versions`, { method: 'POST', body: { content: 'Popis v1' } })).payload;
  const secondDraft = await call(`/job-profiles/${profile.id}/versions`, { method: 'POST', body: {} });
  check('#16 len jeden rozpracovany navrh', secondDraft.status === 409, `status ${secondDraft.status}`);
  await call(`/job-description-versions/${v1.id}/publish`, { method: 'POST', body: {} });
  const editPublished = await call(`/job-description-versions/${v1.id}`, { method: 'PATCH', body: { content: 'prepis' } });
  check('#16 publikovanu verziu nemozno menit', editPublished.status === 409, `status ${editPublished.status}`);

  const v2 = (await call(`/job-profiles/${profile.id}/versions`, { method: 'POST', body: { content: 'Popis v2' } })).payload;
  await call(`/job-description-versions/${v2.id}/publish`, { method: 'POST', body: { effectiveFrom: dayOffset(14) } });
  const detail = (await call(`/job-profiles/${profile.id}`)).payload;
  const byVersion = Object.fromEntries((detail?.versions ?? []).map((version) => [version.version, version]));
  check('#16 platna je v1, v2 je planovana', byVersion[1]?.status === 'current' && byVersion[2]?.status === 'planned',
    `${byVersion[1]?.status} / ${byVersion[2]?.status}`);
  check('#16 autor a datum ucinnosti', byVersion[2]?.authorName === 'Majitel Firmy' && byVersion[2]?.effectiveFrom === dayOffset(14));
  const deleteProfile = await call(`/job-profiles/${profile.id}`, { method: 'DELETE' });
  check('#16 profil s publikovanym popisom nemozno zmazat', deleteProfile.status === 409, `status ${deleteProfile.status}`);

  // --- pozvanka: prepojenie s osobou v adresari a ochrana existujuceho uctu ---
  const invitation = (await call(org('/invitations'), { method: 'POST', body: { email: 'kolega@example.test', roleId: 'approver' } })).payload;
  const colleague = (await call(org('/people'), { method: 'POST', body: { name: 'Kolega z adresara', email: 'kolega@example.test' } })).payload;
  const accept = await call(`/invitations/${invitation?.token}/accept`, {
    method: 'POST', body: { name: 'Kolega', password: 'Heslo123456' }, auth: null
  });
  const linked = ((await call(org('/people'))).payload ?? []).find((person) => person.id === colleague?.id);
  check('pozvanka prepoji osobu z adresara', accept.status === 200 && linked?.hasAccount === true, `status ${accept.status}`);
  const colleagueView = await call(org('/processes'), { auth: accept.payload?.token });
  check('pozvany kolega je hned prihlaseny', colleagueView.status === 200, `status ${colleagueView.status}`);

  // ucet z inej firmy: kto ma odkaz na pozvanku, nesmie ziskat jeho relaciu bez hesla
  const victimEmail = `orgtest-obet-${STAMP}@example.test`;
  await call('/register', {
    method: 'POST', auth: null,
    body: { acceptTerms: true, organizationName: `Org Test obet ${STAMP}`, ownerName: 'Obet', email: victimEmail, password: 'TajneHeslo123' }
  });
  const invitation2 = (await call(org('/invitations'), { method: 'POST', body: { email: victimEmail, roleId: 'approver' } })).payload;
  const hijack = await call(`/invitations/${invitation2?.token}/accept`, {
    method: 'POST', body: { name: 'Utocnik', password: 'ZleHeslo999' }, auth: null
  });
  check('pozvanka na cudzi ucet bez hesla odmietnuta', hijack.status === 401 && !hijack.payload?.token, `status ${hijack.status}`);
  const joined = await call(`/invitations/${invitation2?.token}/accept`, {
    method: 'POST', body: { name: 'Obet', password: 'TajneHeslo123' }, auth: null
  });
  check('pozvanka s vlastnym heslom prijata', joined.status === 200, `status ${joined.status}`);

  // --- vyhodnotenie ---
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(48)} ${r.ok ? '' : r.detail ?? ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} prešlo`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Test zlyhal:', error);
  process.exit(2);
});
