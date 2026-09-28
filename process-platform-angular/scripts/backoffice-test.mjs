/**
 * Overenie backoffice metrik a auditu (#17, #18) so syntetickymi udajmi.
 *
 * Skript si vlozi docasneho backoffice admina priamo do DB (bez znameho hesla
 * v repozitari), overi agregaty, zmenu planu, audit zasahov a stav sluzby —
 * a hlavne, ze operator NEVIDI obsah zakaznika (nazvy procesov, osob, dokumentov).
 * Na konci admina aj testovaciu firmu zmaze.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 sh -c "cd /app && node --input-type=module" < scripts/backoffice-test.mjs
 * (z /app, aby sa nasiel balik pg)
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { rmSync } from 'node:fs';
import pg from 'pg';

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

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const adminName = `bo-test-${STAMP}`;
const adminPassword = randomBytes(18).toString('base64url');
const salt = randomBytes(16).toString('hex');
await db.query(
  `insert into "BackofficeAdmin" (id, username, "passwordHash") values (gen_random_uuid()::text, $1, $2)`,
  [adminName, `scrypt$${salt}$${scryptSync(adminPassword, salt, 64).toString('hex')}`]
);

let orgId = null;
try {
  // zakaznik s citlivym obsahom, ktory operator nesmie vidiet
  const reg = await call('/register', {
    method: 'POST',
    body: { organizationName: `Org Test backoffice ${STAMP}`, ownerName: 'Tajny Majitel', email: `orgtest-bo-${STAMP}@example.test`, password: 'Heslo123456' }
  });
  orgId = reg.payload.organization.id;
  const t = reg.payload.token;
  await call(`/organizations/${orgId}/processes`, { method: 'POST', body: { name: 'TAJNY-PROCES-XYZ', type: 'process' }, token: t });
  await call(`/organizations/${orgId}/people`, { method: 'POST', body: { name: 'TAJNA-OSOBA-XYZ' }, token: t });
  const proc = (await call(`/organizations/${orgId}/processes`, { token: t })).payload?.[0];
  await call(`/processes/${proc?.id}/documents`, {
    method: 'POST', token: t,
    body: { fileName: 'TAJNY-DOKUMENT-XYZ.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,QUJD' }
  });

  const login = await call('/backoffice/auth/login', { method: 'POST', body: { username: adminName, password: adminPassword } });
  const token = login.payload?.token;
  check('prihlasenie docasneho admina', login.status === 200);

  // --- #17 spotreba planu ---
  const orgs = (await call('/backoffice/organizations', { token })).payload ?? [];
  const mine = orgs.find((org) => org.id === orgId);
  check('#17 spotreba uloziska firmy', mine?.storageUsedBytes === 3 && mine?.documentCount === 1, JSON.stringify(mine));
  check('#17 platení pouzivatelia vs. len adresar', mine?.userCount === 1 && mine?.directoryOnlyCount === 1);
  check('#17 posledna aktivita', Boolean(mine?.lastActivityAt));

  const stats = (await call('/backoffice/stats', { token })).payload;
  check('#17 agregaty platformy', typeof stats?.storageUsedBytes === 'number' && stats.directoryOnly >= 1);

  const all = JSON.stringify({ orgs, stats });
  check('#17 operator nevidi obsah zakaznika', !/TAJN/.test(all), 'v odpovedi je nazov procesu, osoby alebo dokumentu');

  const badQuota = await call(`/backoffice/organizations/${orgId}`, { method: 'PATCH', body: { storageQuotaMb: -5 }, token });
  check('#17 neplatna kvota odmietnuta', badQuota.status === 400);
  const quota = await call(`/backoffice/organizations/${orgId}`, { method: 'PATCH', body: { storageQuotaMb: 2048 }, token });
  check('#17 zmena planu', quota.status === 200 && quota.payload?.storageQuotaMb === 2048);

  // --- #18 audit zasahov ---
  await call('/backoffice/auth/login', { method: 'POST', body: { username: adminName, password: 'zle-heslo' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const audit = (await call('/backoffice/audit?limit=50', { token })).payload ?? [];
  const quotaEntry = audit.find((entry) => entry.action === 'firma.zmena-planu' && entry.targetId === orgId);
  check('#18 zmena planu v audite', quotaEntry?.admin === adminName && quotaEntry?.detail?.storageQuotaMb?.to === 2048,
    JSON.stringify(quotaEntry));
  check('#18 prihlasenie v audite', audit.some((entry) => entry.action === 'prihlasenie' && entry.admin === adminName));
  check('#18 neuspesne prihlasenie v audite', audit.some((entry) => entry.action === 'prihlasenie.neuspesne' && entry.admin === adminName));
  check('#18 odmietnuty zasah sa neaudituje', !audit.some((entry) => entry.detail?.storageQuotaMb?.to === -5));
  check('#18 audit bez hesiel', !JSON.stringify(audit).includes(adminPassword) && !JSON.stringify(audit).includes('zle-heslo'));

  // --- #18 stav sluzby ---
  const health = (await call('/backoffice/health', { token })).payload;
  check('#18 stav sluzby', ['ok', 'degraded'].includes(health?.status) && health?.database?.ok === true, JSON.stringify(health?.database));
  check('#18 metriky poziadaviek', health?.requests?.total > 0 && Array.isArray(health?.incidents));
  check('#18 stav emailov', health?.email?.configured === false);
  check('#18 metriky bez obsahu', !/TAJN/.test(JSON.stringify(health)));

  const anonymous = await call('/backoffice/health');
  check('bez prihlasenia 401', anonymous.status === 401);
  const customerToken = await call('/backoffice/organizations', { token: t });
  check('token zakaznika do backoffice nepusti', customerToken.status === 401);
} finally {
  await db.query(`delete from "BackofficeAdmin" where username = $1`, [adminName]);
  if (orgId) {
    await db.query(`delete from "Organization" where id = $1`, [orgId]);
    rmSync(`/app/storage/uploads/${orgId}`, { recursive: true, force: true });
  }
  await db.query(`delete from "User" where email = $1`, [`orgtest-bo-${STAMP}@example.test`]);
  await db.end();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(44)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
