import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Suborove ulozisko priloh (#10).
 *
 * Obsah je na disku v UPLOAD_DIR/<organizationId>/<attachmentId>, v databaze
 * (Attachment.storagePath) je len kluc "<organizationId>/<attachmentId>".
 * Povodny nazov suboru sa do cesty nedostane — nie je z coho poskladat cestu
 * mimo uloziska (path traversal) a premenovanie dokumentu subor nepresuva.
 *
 * Starsie prilohy maju v storagePath data URL (base64). Tie sa citaju dalej,
 * na disk ich presunie scripts/migrate-attachments-to-files.ts.
 *
 * Zaloha: databaza uz obsah suborov neobsahuje — zalohovat treba aj UPLOAD_DIR.
 */
export const UPLOAD_DIR = path.resolve(process.env['UPLOAD_DIR'] ?? 'storage/uploads');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE_KEY = new RegExp(`^${UUID}/${UUID}$`);

/** true, ak je storagePath kluc suboru na disku (nie starsia data URL). */
export function isFileKey(storagePath: string | null | undefined): storagePath is string {
  return typeof storagePath === 'string' && FILE_KEY.test(storagePath);
}

export function fileKey(organizationId: string, attachmentId: string): string {
  const key = `${organizationId}/${attachmentId}`;
  checkedPath(key);
  return key;
}

function checkedPath(key: string): string {
  if (!FILE_KEY.test(key)) throw new Error('Neplatny kluc suboru v ulozisku.');
  return path.join(UPLOAD_DIR, ...key.split('/'));
}

/**
 * Zapise stream do uloziska a vrati pocet zapisanych bajtov.
 *
 * Zapisuje sa do docasneho .part suboru, ktory sa premenuje az po uspesnom
 * dokonceni — prerusene nahravanie tak nikdy nevyzera ako hotovy subor.
 * Limit sa strazi pocas zapisu podla skutocnych bajtov, nie podla hlavicky.
 */
export async function storeStream(
  key: string,
  source: Readable,
  maxBytes: number,
  tooLarge: () => Error
): Promise<number> {
  const target = checkedPath(key);
  const partial = `${target}.part`;
  await mkdir(path.dirname(target), { recursive: true });

  let written = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      if (written > maxBytes) callback(tooLarge());
      else callback(null, chunk);
    }
  });

  try {
    await pipeline(source, limiter, createWriteStream(partial, { flags: 'wx' }));
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return written;
}

/** Zapise hotovy buffer (starsi JSON upload, migracia z DB). */
export async function storeBuffer(key: string, data: Buffer): Promise<void> {
  const target = checkedPath(key);
  const partial = `${target}.part`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(partial, data, { flag: 'wx' });
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/** Velkost suboru na disku, alebo null ak subor chyba. */
export async function storedSize(key: string): Promise<number | null> {
  try {
    return (await stat(checkedPath(key))).size;
  } catch {
    return null;
  }
}

export function openStored(key: string): Readable {
  return createReadStream(checkedPath(key));
}

/** Zmaze subor; chybajuci subor nie je chyba (mazanie ma byt opakovatelne). */
export async function removeStored(key: string): Promise<void> {
  await rm(checkedPath(key), { force: true });
}

/** Rozlozi data URL (starsi format ulozenia) na typ a obsah. */
export function parseDataUrl(value: string): { mimeType: string; data: Buffer } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value);
  if (!match) return null;
  const [, mimeType, base64Flag, payload] = match;
  const data = base64Flag
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { mimeType, data };
}
