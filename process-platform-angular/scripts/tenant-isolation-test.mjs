/**
 * Overenie izolácie firiem (multi-tenancy).
 *
 * Založí dve nezávislé firmy so syntetickými údajmi, firma B si vytvorí objekty
 * a skript overí, že sa k nim firma A ani anonymný volajúci nedostanú.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/tenant-isolation-test.mjs
 * Voliteľne:  API_URL=http://localhost:3000 (predvolené)
 *
 * Návratový kód 0 = izolácia drží, 1 = našli sa priechody.
 *
 * Firmy „Izolacia A/B <čas>" v DB zostanú (API nemá mazanie firmy). Upratanie:
 *   delete from "Organization" where name like 'Izolacia _ %';
 *   delete from "User" where email like 'izolacia-%@example.test';
 */

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();

const results = [];
let token = { a: null, b: null };

function record(name, expected, actual, detail = '') {
  const ok = Array.isArray(expected) ? expected.includes(actual) : expected === actual;
  results.push({ name, expected, actual, ok, detail });
}

async function call(path, { method = 'GET', body, auth } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${auth}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* prazdna odpoved */ }
  return { status: response.status, payload };
}

async function registerOrg(label) {
  const { payload } = await call('/register', {
    method: 'POST',
    body: {
      acceptTerms: true,
      organizationName: `Izolacia ${label} ${STAMP}`,
      ownerName: `Vlastnik ${label}`,
      email: `izolacia-${label.toLowerCase()}-${STAMP}@example.test`,
      password: 'SynteticeHeslo123'
    }
  });
  return {
    orgId: payload?.organization?.id ?? payload?.user?.organizationId,
    userId: payload?.user?.id,
    token: payload?.token ?? null
  };
}

async function main() {
  console.log('=== Test izolácie firiem ===\n');

  const a = await registerOrg('A');
  const b = await registerOrg('B');
  token = { a: a.token, b: b.token };

  if (!a.orgId || !b.orgId) {
    console.error('Firmy sa nepodarilo založiť — beží API?');
    process.exit(2);
  }
  console.log(`firma A: ${a.orgId}`);
  console.log(`firma B: ${b.orgId}`);
  console.log(token.a ? 'API vracia token pri registrácii.\n' : 'API zatiaľ NEVRACIA token — testy s reláciou sa preskočia.\n');

  // --- firma B si vytvorí objekty ---
  const { payload: procB } = await call(`/organizations/${b.orgId}/processes`, {
    method: 'POST', body: { name: 'Tajny proces B', type: 'process' }, auth: token.b
  });
  const procBId = procB?.id;

  const { payload: docB } = await call(`/processes/${procBId}/documents`, {
    method: 'POST',
    body: {
      fileName: 'tajne-B.txt', mimeType: 'text/plain', sizeBytes: 9,
      dataUrl: 'data:text/plain;base64,VGFqbnkgQg=='
    },
    auth: token.b
  });
  const docBId = docB?.id;

  const { payload: posB } = await call(`/organizations/${b.orgId}/positions`, {
    method: 'POST', body: { name: `Tajna pozicia B ${STAMP}`, description: '' }, auth: token.b
  });
  const posBId = posB?.id;

  if (!procBId) {
    console.error('Firma B si nevedela vytvoriť proces — test nemá čo overovať.');
    process.exit(2);
  }

  // --- 1. anonymný prístup (bez akéhokoľvek prihlásenia) ---
  record('anonym číta proces B', 401, (await call(`/processes/${procBId}`)).status);
  record('anonym vypíše procesy B', 401, (await call(`/organizations/${b.orgId}/processes`)).status);
  record('anonym mení proces B', 401, (await call(`/processes/${procBId}`, {
    method: 'PATCH', body: { name: 'PREPISANE ANONYMOM' }
  })).status);
  record('anonym vypíše dokumenty B', 401, (await call(`/processes/${procBId}/documents`)).status);
  if (docBId) {
    record('anonym stiahne dokument B', [401, 403], (await call(`/documents/${docBId}/download`)).status);
  }
  record('anonym vypíše pozície B', 401, (await call(`/organizations/${b.orgId}/positions`)).status);
  record('anonym vypíše používateľov B', 401, (await call(`/organizations/${b.orgId}/users`)).status);
  record('anonym číta úložisko B', 401, (await call(`/organizations/${b.orgId}/storage`)).status);

  // --- 2. prihlásená firma A siaha na objekty firmy B ---
  if (token.a) {
    record('A číta proces B', 404, (await call(`/processes/${procBId}`, { auth: token.a })).status);
    record('A vypíše procesy B cez orgId B', [403, 404], (await call(`/organizations/${b.orgId}/processes`, { auth: token.a })).status);
    record('A mení proces B', 404, (await call(`/processes/${procBId}`, {
      method: 'PATCH', body: { name: 'PREPISANE FIRMOU A' }, auth: token.a
    })).status);
    record('A maže proces B', 404, (await call(`/processes/${procBId}`, { method: 'DELETE', auth: token.a })).status);
    if (docBId) {
      record('A stiahne dokument B', 404, (await call(`/documents/${docBId}/download`, { auth: token.a })).status);
      record('A maže dokument B', 404, (await call(`/documents/${docBId}`, { method: 'DELETE', auth: token.a })).status);
    }
    record('A číta úložisko B', [403, 404], (await call(`/organizations/${b.orgId}/storage`, { auth: token.a })).status);
    if (posBId) {
      record('A mení pozíciu B', 404, (await call(`/positions/${posBId}`, {
        method: 'PATCH', body: { name: 'PREPISANE' }, auth: token.a
      })).status);
    }
  }

  // --- 2b. firma A podstrčí ID objektov firmy B do väzieb svojich objektov ---
  // bez kontroly by sa cudzí objekt pripojil a jeho názov by sa vrátil vo výpise
  if (token.a) {
    const { payload: unitB } = await call(`/organizations/${b.orgId}/units`, {
      method: 'POST', body: { name: `Tajna zlozka B ${STAMP}` }, auth: token.b
    });
    const { payload: procA } = await call(`/organizations/${a.orgId}/processes`, {
      method: 'POST', body: { name: 'Proces A', type: 'process' }, auth: token.a
    });
    const { payload: posA } = await call(`/organizations/${a.orgId}/positions`, {
      method: 'POST', body: { name: `Pozicia A ${STAMP}` }, auth: token.a
    });
    const { payload: docA } = await call(`/processes/${procA?.id}/documents`, {
      method: 'POST',
      body: { fileName: 'a.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,QQ==' },
      auth: token.a
    });

    const patchA = (body) => call(`/processes/${procA?.id}`, { method: 'PATCH', body, auth: token.a });
    record('A: proces pod proces B', 404, (await patchA({ parentId: procBId })).status);
    record('A: súvisiaci proces B', 404, (await patchA({ relatedProcessIds: [procBId] })).status);
    record('A: pozícia B v procese', 404, (await patchA({ positionIds: [posBId] })).status);
    record('A: nový proces pod proces B', 404, (await call(`/organizations/${a.orgId}/processes`, {
      method: 'POST', body: { name: 'X', type: 'process', parentId: procBId }, auth: token.a
    })).status);
    record('A: pozícia B pri dokumente', 404, (await call(`/documents/${docA?.id}`, {
      method: 'PATCH', body: { positionIds: [posBId] }, auth: token.a
    })).status);
    record('A: miesto do zložky B', 404, (await call(`/positions/${posA?.id}`, {
      method: 'PATCH', body: { unitId: unitB?.id }, auth: token.a
    })).status);
    record('A: nadriadený = miesto B', 404, (await call(`/positions/${posA?.id}`, {
      method: 'PATCH', body: { reportsToId: posBId }, auth: token.a
    })).status);
    record('A: zložka pod zložku B', 404, (await call(`/organizations/${a.orgId}/units`, {
      method: 'POST', body: { name: `Zlozka A ${STAMP}`, parentId: unitB?.id }, auth: token.a
    })).status);

    // #13/#14 — osoby a obsadenia firmy B
    const { payload: personB } = await call(`/organizations/${b.orgId}/people`, {
      method: 'POST', body: { name: 'Tajna osoba B' }, auth: token.b
    });
    const { payload: assignmentB } = await call(`/positions/${posBId}/assignments`, {
      method: 'POST', body: { personId: personB?.id }, auth: token.b
    });
    record('A vypíše osoby B', [403, 404], (await call(`/organizations/${b.orgId}/people`, { auth: token.a })).status);
    record('A mení osobu B', 404, (await call(`/people/${personB?.id}`, {
      method: 'PATCH', body: { name: 'PREPISANE' }, auth: token.a
    })).status);
    record('A zaznamená odchod osoby B', 404, (await call(`/people/${personB?.id}/leave`, {
      method: 'POST', body: {}, auth: token.a
    })).status);
    record('A: osoba B na miesto A', 404, (await call(`/positions/${posA?.id}/assignments`, {
      method: 'POST', body: { personId: personB?.id }, auth: token.a
    })).status);
    record('A ukončí obsadenie B', 404, (await call(`/assignments/${assignmentB?.id}`, {
      method: 'PATCH', body: { validTo: '2020-01-01' }, auth: token.a
    })).status);
    record('A: vlastník = miesto B', 404, (await patchA({ ownerPositionId: posBId })).status);

    // #16 — profil prace firmy B
    const { payload: profileB } = await call(`/organizations/${b.orgId}/job-profiles`, {
      method: 'POST', body: { name: 'Tajny profil B' }, auth: token.b
    });
    record('A číta profil práce B', 404, (await call(`/job-profiles/${profileB?.id}`, { auth: token.a })).status);
    record('A pridá verziu do profilu B', 404, (await call(`/job-profiles/${profileB?.id}/versions`, {
      method: 'POST', body: { content: 'x' }, auth: token.a
    })).status);
    record('A: miesto A napĺňa profil B', 404, (await call(`/positions/${posA?.id}`, {
      method: 'PATCH', body: { jobProfileId: profileB?.id }, auth: token.a
    })).status);

    const { payload: detailA } = await call(`/processes/${procA?.id}`, { auth: token.a });
    const leaked = JSON.stringify(detailA ?? {}).includes('Tajn');
    results.push({
      name: 'detail procesu A bez názvov B', expected: 'bez úniku',
      actual: leaked ? 'ÚNIK' : 'bez úniku', ok: !leaked, detail: ''
    });
  }

  // --- 3. overenie, že proces B je stále nedotknutý ---
  const { payload: finalB } = await call(`/processes/${procBId}`, { auth: token.b ?? undefined });
  const nazovOk = finalB?.name === 'Tajny proces B';
  results.push({
    name: 'proces B ostal nezmenený', expected: 'Tajny proces B',
    actual: finalB?.name ?? '(nedostupny)', ok: nazovOk, detail: ''
  });

  // --- vyhodnotenie ---
  console.log('výsledky:\n');
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    const mark = r.ok ? 'OK   ' : 'CHYBA';
    console.log(`  ${mark} ${r.name.padEnd(34)} čakané ${r.expected}, dostal ${r.actual}`);
  }
  console.log(`\n${results.length - failed}/${results.length} prešlo`);

  if (failed > 0) {
    console.log('\nIZOLÁCIA NEDRŽÍ — cudzie firmy sa dostanú k dátam.');
  } else {
    console.log('\nIzolácia drží.');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Test zlyhal:', error.message);
  process.exit(2);
});
