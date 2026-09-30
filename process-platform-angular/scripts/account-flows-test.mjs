/**
 * Overenie tokov z e-mailov (#20) so syntetickymi udajmi: potvrdenie e-mailu,
 * zabudnute heslo a nastavenie noveho hesla. Odkaz si test vezme z fronty
 * odchadzajucich e-mailov (EmailOutbox) — rovnako, ako by ho dostal pouzivatel.
 *
 * Spustenie:  docker exec -i process-platform-angular-api-1 sh -c "cd /app && node --input-type=module" < scripts/account-flows-test.mjs
 *             (alebo v CI: node scripts/account-flows-test.mjs)
 */
import pg from 'pg';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const STAMP = Date.now();
const EMAIL = `orgtest-mail-${STAMP}@example.test`;
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

/** Posledny odkaz daneho typu pre adresu z fronty e-mailov. */
async function lastLink(address, template) {
  const { rows } = await db.query(
    `select "bodyText" from "EmailOutbox" where "toAddress" = $1 and template = $2 order by "createdAt" desc limit 1`,
    [address, template]
  );
  return rows[0]?.bodyText.match(/token=([\w-]+)/)?.[1] ?? null;
}

try {
  const short = await call('/register', {
    method: 'POST', body: { acceptTerms: true, organizationName: `Org Test mail kratke ${STAMP}`, ownerName: 'X', email: `x-${EMAIL}`, password: 'kratke' }
  });
  check('kratke heslo pri registracii -> 400', short.status === 400, `status ${short.status}`);
  // #21 — registráciou firma uzatvára zmluvu: bez súhlasu s podmienkami sa účet nevytvorí
  const noTerms = await call('/register', {
    method: 'POST', body: { organizationName: `Org Test mail bez suhlasu ${STAMP}`, ownerName: 'X', email: `bez-suhlasu-${EMAIL}`, password: 'PovodneHeslo1' }
  });
  check('registracia bez suhlasu s podmienkami -> 400', noTerms.status === 400, `status ${noTerms.status}`);

  const reg = await call('/register', {
    method: 'POST', body: { acceptTerms: true, organizationName: `Org Test mail ${STAMP}`, ownerName: 'Mailovy Test', email: EMAIL, password: 'PovodneHeslo1' }
  });
  check('registracia: e-mail neovereny', reg.status === 201 && reg.payload?.user?.emailVerified === false);
  check('registracia: zapisana verzia podmienok', /^\d{4}-\d{2}-\d{2}$/.test(reg.payload?.user?.termsVersion ?? ''), JSON.stringify(reg.payload?.user?.termsVersion));
  const verifyToken = await lastLink(EMAIL, 'email-verify');
  check('overovaci e-mail vo fronte', Boolean(verifyToken));

  // --- potvrdenie e-mailu ---
  const verified = await call('/auth/verify-email', { method: 'POST', body: { token: verifyToken } });
  check('potvrdenie e-mailu', verified.status === 200, `status ${verified.status}`);
  const reused = await call('/auth/verify-email', { method: 'POST', body: { token: verifyToken } });
  check('odkaz sa neda pouzit druhy raz', reused.status === 400, `status ${reused.status}`);
  const bogus = await call('/auth/verify-email', { method: 'POST', body: { token: 'neplatny-token' } });
  check('neplatny token odmietnuty', bogus.status === 400, `status ${bogus.status}`);
  const login = await call('/login', { method: 'POST', body: { email: EMAIL, password: 'PovodneHeslo1' } });
  check('po overeni: emailVerified', login.payload?.user?.emailVerified === true);
  const resend = await call('/auth/resend-verification', { method: 'POST', body: {}, token: login.payload?.token });
  check('uz overeny e-mail sa znova neposiela', resend.payload?.alreadyVerified === true);

  // --- zabudnute heslo: rovnaka odpoved pre existujuci aj neexistujuci ucet ---
  const unknown = await call('/auth/forgot-password', { method: 'POST', body: { email: `nikto-${EMAIL}` } });
  const known = await call('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
  check('odpoved neprezradi, ci ucet existuje',
    unknown.status === 200 && known.status === 200 && JSON.stringify(unknown.payload) === JSON.stringify(known.payload));
  check('neznamej adrese sa nic neposiela', (await lastLink(`nikto-${EMAIL}`, 'password-reset')) === null);
  const firstReset = await lastLink(EMAIL, 'password-reset');
  await call('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
  const resetToken = await lastLink(EMAIL, 'password-reset');
  const superseded = await call('/auth/reset-password', { method: 'POST', body: { token: firstReset, password: 'NoveHeslo12345' } });
  check('starsi odkaz po novej ziadosti neplati', superseded.status === 400, `status ${superseded.status}`);

  // --- nastavenie noveho hesla ---
  const weak = await call('/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'kratke' } });
  check('kratke nove heslo -> 400', weak.status === 400);
  const reset = await call('/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'NoveHeslo12345' } });
  check('nove heslo nastavene', reset.status === 200, `status ${reset.status}`);
  const oldSession = await call(`/organizations/${reg.payload.organization.id}/processes`, { token: login.payload?.token });
  check('stare relacie odhlasene', oldSession.status === 401, `status ${oldSession.status}`);
  check('stare heslo neplati', (await call('/login', { method: 'POST', body: { email: EMAIL, password: 'PovodneHeslo1' } })).status === 401);
  check('nove heslo plati', (await call('/login', { method: 'POST', body: { email: EMAIL, password: 'NoveHeslo12345' } })).status === 200);
  const again = await call('/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'InakeHeslo12345' } });
  check('odkaz na obnovu len raz', again.status === 400, `status ${again.status}`);

  // --- expirovany odkaz ---
  await call('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
  const expiring = await lastLink(EMAIL, 'password-reset');
  await db.query(
    `update "AuthToken" set "expiresAt" = now() - interval '1 minute'
     where "userId" = (select id from "User" where email = $1) and type = 'PASSWORD_RESET' and "usedAt" is null`,
    [EMAIL]
  );
  const expired = await call('/auth/reset-password', { method: 'POST', body: { token: expiring, password: 'InakeHeslo12345' } });
  check('expirovany odkaz -> 410', expired.status === 410, `status ${expired.status}`);

  // tokeny su v DB len ako hash
  const { rows } = await db.query(`select count(*)::int n from "AuthToken" where "tokenHash" = $1`, [resetToken]);
  check('v DB nie je token v citatelnej podobe', rows[0].n === 0);
} finally {
  await db.query(`delete from "EmailOutbox" where "toAddress" like $1`, [`%${EMAIL}`]);
  await db.query(`delete from "Organization" where name like $1`, [`Org Test mail%${STAMP}`]);
  await db.query(`delete from "User" where email like $1`, [`%${EMAIL}`]);
  await db.end();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(46)} ${r.ok ? '' : r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
