import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Tajomstva servera (#19).
 *
 * Poradie: premenna prostredia -> subor SECRETS_FILE, ktory sa pri prvom starte
 * vygeneruje s nahodnymi hodnotami. V zdrojaku NIE JE ziadna zalozna hodnota —
 * ta by bola verejna na GitHube a dala by sa nou podpisat backoffice token
 * alebo desifrovat ulozene API kluce.
 *
 * Subor lezi v storage/ (mimo gitu). Zalohovat ho treba spolu s databazou:
 * bez neho sa ulozene API kluce nedaju desifrovat a backoffice sa odhlasi.
 */
export const SECRETS_FILE = path.resolve(process.env['SECRETS_FILE'] ?? 'storage/secrets.json');

export type SecretName = 'SETTINGS_ENCRYPTION_KEY' | 'BACKOFFICE_JWT_SECRET';

const MIN_LENGTH = 32;
let stored: Record<string, string> | null = null;

function readStored(): Record<string, string> {
  if (stored) return stored;
  stored = existsSync(SECRETS_FILE) ? JSON.parse(readFileSync(SECRETS_FILE, 'utf8')) : {};
  return stored!;
}

export function secret(name: SecretName): string {
  const fromEnv = process.env[name];
  if (fromEnv) {
    if (fromEnv.length < MIN_LENGTH) throw new Error(`${name} musi mat aspon ${MIN_LENGTH} znakov.`);
    return fromEnv;
  }

  const values = readStored();
  if (!values[name]) {
    values[name] = randomBytes(32).toString('base64url');
    mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
    // 0o600 — citat ho ma len pouzivatel, pod ktorym bezi server
    writeFileSync(SECRETS_FILE, JSON.stringify(values, null, 2), { mode: 0o600 });
    console.warn(`[secrets] ${name} nie je nastavene — vygenerovane do ${SECRETS_FILE}. Subor zalohujte spolu s databazou.`);
  }
  return values[name];
}
