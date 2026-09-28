/**
 * Overenie suboroveho uloziska priloh (#10) so syntetickymi udajmi.
 *
 * Zalozi testovaciu firmu, nahra subory binarne aj starsim JSON formatom,
 * overi ze stiahnuty obsah je bajt po bajte rovnaky, ze subor lezi na disku
 * a ze po zmazani dokumentu aj procesu z disku zmizne.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 node < scripts/file-storage-test.mjs
 * (bezi v kontajneri API, aby videl na UPLOAD_DIR)
 *
 * Firma „Ulozisko Test <cas>" v DB zostane. Upratanie:
 *   delete from "Organization" where name like 'Ulozisko Test %';
 *   delete from "User" where email like 'ulozisko-%@example.test';
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const UPLOAD_DIR = path.resolve('/app', process.env.UPLOAD_DIR ?? 'storage/uploads');
const STAMP = Date.now();
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
}

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function call(pathname, { method = 'GET', body, headers = {}, token, raw = false } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
  }
  const response = await fetch(`${API}${pathname}`, init);
  const payload = raw ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => null);
  return { status: response.status, payload, headers: response.headers };
}

function uploadBinary(processId, token, buffer, fileName, fileType) {
  return call(`/processes/${processId}/documents`, {
    method: 'POST',
    body: buffer,
    token,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(fileName),
      'X-File-Type': fileType
    }
  });
}

/** Poziadavka, ktora deklaruje obrovske telo, ale nic neposle — server ma odmietnut hned. */
function declareHuge(processId, token) {
  return new Promise((resolve) => {
    const url = new URL(`${API}/processes/${processId}/documents`);
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(200 * 1024 * 1024),
        'X-File-Name': 'obrovsky.bin'
      }
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
      request.destroy();
    });
    request.on('error', () => resolve('spojenie ukoncene'));
    request.write(Buffer.alloc(1024));
  });
}

async function main() {
  const email = `ulozisko-${STAMP}@example.test`;
  const reg = await call('/register', {
    method: 'POST',
    body: { organizationName: `Ulozisko Test ${STAMP}`, ownerName: 'Test', email, password: 'Heslo123456' }
  });
  const token = reg.payload?.token;
  const orgId = reg.payload?.organization?.id;
  if (!token || !orgId) {
    console.error('Testovaciu firmu sa nepodarilo zalozit — bezi API?');
    process.exit(2);
  }

  const { payload: proc } = await call(`/organizations/${orgId}/processes`, {
    method: 'POST', body: { name: 'Proces s prilohami', type: 'process' }, token
  });

  // 1. binarny upload + zhodny obsah
  const binary = randomBytes(1024 * 1024 + 17);
  const up = await uploadBinary(proc.id, token, binary, 'náhodné dáta.bin', 'application/octet-stream');
  record('binarny upload 201', up.status === 201, `status ${up.status}`);
  record('velkost = zapisane bajty', up.payload?.size === binary.length, `${up.payload?.size} vs ${binary.length}`);
  record('diakritika v nazve', up.payload?.name === 'náhodné dáta.bin', up.payload?.name);

  const filePath = path.join(UPLOAD_DIR, orgId, up.payload?.id ?? 'x');
  record('subor lezi na disku', existsSync(filePath), filePath);
  record('ziadny .part po uspechu', !existsSync(`${filePath}.part`));

  const down = await call(`/documents/${up.payload.id}/download`, { token, raw: true });
  record('stiahnuty obsah zhodny', down.status === 200 && sha(down.payload) === sha(binary), `status ${down.status}`);

  // 2. .json subor sa ulozi ako subor, server ho neparsuje
  const jsonFile = Buffer.from('{"toto":"nie je API poziadavka"}');
  const upJson = await uploadBinary(proc.id, token, jsonFile, 'data.json', 'application/json');
  const downJson = await call(`/documents/${upJson.payload?.id}/download`, { token, raw: true });
  record('.json subor ulozeny doslovne', upJson.status === 201 && downJson.payload?.equals(jsonFile), `status ${upJson.status}`);

  // 3. starsi JSON format (data URL) sa uklada tiez na disk
  const legacy = Buffer.from('starsi format prilohy');
  const upLegacy = await call(`/processes/${proc.id}/documents`, {
    method: 'POST', token,
    body: { fileName: 'stary.txt', mimeType: 'text/plain', sizeBytes: 999, dataUrl: `data:text/plain;base64,${legacy.toString('base64')}` }
  });
  record('JSON upload 201', upLegacy.status === 201, `status ${upLegacy.status}`);
  record('JSON: velkost podla obsahu, nie podla klienta', upLegacy.payload?.size === legacy.length, `${upLegacy.payload?.size}`);
  record('JSON: subor na disku', existsSync(path.join(UPLOAD_DIR, orgId, upLegacy.payload?.id ?? 'x')));

  // 4. HTML sa ani s ?inline=1 nezobrazi inline
  const html = await uploadBinary(proc.id, token, Buffer.from('<script>alert(1)</script>'), 'x.html', 'text/html');
  const htmlDown = await call(`/documents/${html.payload?.id}/download?inline=1`, { token, raw: true });
  record('HTML inline -> attachment', /^attachment/.test(htmlDown.headers.get('content-disposition') ?? ''),
    htmlDown.headers.get('content-disposition') ?? '');

  // 5. deklarovana velkost nad limit -> 413 hned
  const huge = await declareHuge(proc.id, token);
  record('200 MB deklarovane -> 413', huge === 413, `dostal ${huge}`);

  // 6. vypis neposiela obsah ani cestu
  const list = await call(`/organizations/${orgId}/documents`, { token });
  const leaks = JSON.stringify(list.payload ?? []).includes('storagePath');
  record('vypis bez storagePath', list.status === 200 && !leaks);

  // 7. spotreba = sucet skutocnych velkosti
  const storage = await call(`/organizations/${orgId}/storage`, { token });
  const expected = binary.length + jsonFile.length + legacy.length + 25;
  record('spotreba uloziska sedi', storage.payload?.usedBytes === expected, `${storage.payload?.usedBytes} vs ${expected}`);

  // 8. zmazanie dokumentu zmaze subor
  const del = await call(`/documents/${up.payload.id}`, { method: 'DELETE', token });
  record('DELETE dokumentu 204', del.status === 204, `status ${del.status}`);
  record('subor po zmazani zmizol', !existsSync(filePath));

  // 9. zmazanie procesu (aj podprocesu) zmaze jeho subory
  const { payload: child } = await call(`/organizations/${orgId}/processes`, {
    method: 'POST', body: { name: 'Podproces', type: 'process', parentId: proc.id }, token
  });
  const childDoc = await uploadBinary(child?.id ?? proc.id, token, Buffer.from('podproces'), 'pod.txt', 'text/plain');
  const childPath = path.join(UPLOAD_DIR, orgId, childDoc.payload?.id ?? 'x');
  const legacyPath = path.join(UPLOAD_DIR, orgId, upLegacy.payload?.id ?? 'x');
  await call(`/processes/${proc.id}`, { method: 'DELETE', token });
  record('proces zmazany -> subory zmizli', !existsSync(legacyPath) && !existsSync(childPath),
    `${existsSync(legacyPath)} ${existsSync(childPath)}`);

  // --- vyhodnotenie ---
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(44)} ${r.ok ? '' : r.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} prešlo`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Test zlyhal:', error.message);
  process.exit(2);
});
