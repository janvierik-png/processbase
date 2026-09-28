/**
 * Presun starsich priloh z databazy na disk (#10).
 *
 * Starsie prilohy maju obsah ako data URL (base64) priamo v Attachment.storagePath.
 * Aplikacia ich cita dalej, takze presun nie je nutny hned — setri vsak DB
 * (zalohy, pamat pri citani) a zjednoti ulozisko.
 *
 * Spustenie v kontajneri API:
 *   docker exec process-platform-angular-api-1 sh -c "cd /app && npx tsx scripts/migrate-attachments-to-files.ts"
 *   docker exec process-platform-angular-api-1 sh -c "cd /app && npx tsx scripts/migrate-attachments-to-files.ts --apply"
 *   ... --apply --org <organizationId>   (len jedna firma)
 *
 * Bez --apply nic nemeni, len vypise co by presunul.
 * Kazda priloha: zapis na disk -> kontrola velkosti -> az potom prepis zaznamu.
 * Pri chybe zostane zaznam v DB nedotknuty a skript pokracuje dalsou.
 * Na produkcii pred --apply zalohovat databazu; po presune zalohovat aj UPLOAD_DIR.
 * Nazvy ani obsah suborov sa nevypisuju — len id a velkost.
 */
import 'dotenv/config';
import { prisma } from '../server/prisma';
import { UPLOAD_DIR, fileKey, parseDataUrl, removeStored, storeBuffer, storedSize } from '../server/file-storage';

const apply = process.argv.includes('--apply');
// --org <id> obmedzi presun na jednu firmu
const orgArg = process.argv.indexOf('--org');
const onlyOrg = orgArg > -1 ? process.argv[orgArg + 1] : undefined;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

async function main() {
  // bez storagePath — riadky mozu mat stovky MB, obsah sa taha po jednom
  const legacy = await prisma.attachment.findMany({
    where: { storagePath: { startsWith: 'data:' }, ...(onlyOrg ? { organizationId: onlyOrg } : {}) },
    select: { id: true, organizationId: true },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`${apply ? 'PRESUN' : 'SUCHY BEH (bez --apply sa nic nemeni)'} — ciel ${UPLOAD_DIR}${onlyOrg ? `, firma ${onlyOrg}` : ''}`);
  console.log(`starsich priloh v DB: ${legacy.length}\n`);

  let moved = 0;
  let movedBytes = 0;
  let failed = 0;

  for (const { id, organizationId } of legacy) {
    const row = await prisma.attachment.findUnique({ where: { id }, select: { storagePath: true, mimeType: true } });
    const parsed = parseDataUrl(row?.storagePath ?? '');
    if (!parsed) {
      console.log(`  ! ${id}  neplatna data URL — preskakujem`);
      failed++;
      continue;
    }

    const size = parsed.data.length;
    if (!apply) {
      console.log(`  - ${id}  ${mb(size)}`);
      moved++;
      movedBytes += size;
      continue;
    }

    const key = fileKey(organizationId, id);
    try {
      await storeBuffer(key, parsed.data);
      const onDisk = await storedSize(key);
      if (onDisk !== size) throw new Error(`na disku ${onDisk} B, ocakavane ${size} B`);

      await prisma.attachment.update({
        where: { id },
        data: { storagePath: key, sizeBytes: size, mimeType: row?.mimeType || parsed.mimeType || 'application/octet-stream' }
      });
      console.log(`  ✓ ${id}  ${mb(size)}`);
      moved++;
      movedBytes += size;
    } catch (error) {
      // zaznam v DB ostal povodny — subor bez zaznamu netreba
      await removeStored(key).catch(() => undefined);
      console.log(`  ! ${id}  ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  console.log(`\n${apply ? 'presunute' : 'na presun'}: ${moved} (${mb(movedBytes)}), chyby: ${failed}`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('Migracia zlyhala:', error);
  await prisma.$disconnect();
  process.exit(2);
});
