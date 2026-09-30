import { inflateRawSync } from 'node:zlib';

/**
 * #41 — čítanie ZIP kontajnera (docx, xlsx, pptx) bez ďalšej závislosti.
 * Obrana proti „zip bombe“: limit počtu súborov, veľkosti jedného súboru
 * aj súčtu po rozbalení (deklarované veľkosti aj skutočný výstup inflate).
 * ZIP64 a šifrované archívy sa odmietnu.
 */

export class ZipError extends Error {}

export interface ZipLimits {
  maxEntries: number;
  /** najväčší rozbalený súbor v bajtoch */
  maxEntryBytes: number;
  /** súčet rozbalených súborov, ktoré sa naozaj čítajú */
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 3000, maxEntryBytes: 25 * 1024 * 1024, maxTotalBytes: 60 * 1024 * 1024 };

interface Entry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export class ZipReader {
  private readonly entries = new Map<string, Entry>();
  private readBytes = 0;

  constructor(private readonly buffer: Buffer, private readonly limits: ZipLimits = DEFAULT_ZIP_LIMITS) {
    const end = this.findEndOfCentralDirectory();
    const count = buffer.readUInt16LE(end + 10);
    const directoryOffset = buffer.readUInt32LE(end + 16);
    if (count === 0xffff || directoryOffset === 0xffffffff) throw new ZipError('ZIP64 nie je podporovaný.');
    if (count > limits.maxEntries) throw new ZipError('Súbor obsahuje priveľa častí.');
    let position = directoryOffset;
    for (let index = 0; index < count; index++) {
      if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) throw new ZipError('Poškodený súbor (adresár ZIP).');
      const flags = buffer.readUInt16LE(position + 8);
      const method = buffer.readUInt16LE(position + 10);
      const compressedSize = buffer.readUInt32LE(position + 20);
      const size = buffer.readUInt32LE(position + 24);
      const nameLength = buffer.readUInt16LE(position + 28);
      const extraLength = buffer.readUInt16LE(position + 30);
      const commentLength = buffer.readUInt16LE(position + 32);
      const offset = buffer.readUInt32LE(position + 42);
      const name = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
      position += 46 + nameLength + extraLength + commentLength;
      if (!name || name.endsWith('/')) continue;
      this.entries.set(name, { name, method, flags, compressedSize, size, offset });
    }
  }

  private findEndOfCentralDirectory(): number {
    const min = Math.max(0, this.buffer.length - 22 - 0xffff);
    for (let position = this.buffer.length - 22; position >= min; position--) {
      if (this.buffer.readUInt32LE(position) === 0x06054b50) return position;
    }
    throw new ZipError('Súbor nie je platný ZIP (docx/xlsx/pptx).');
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Obsah súboru v archíve; null = súbor v archíve nie je. */
  read(name: string): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    if (entry.flags & 0x1) throw new ZipError('Šifrované dokumenty nie sú podporované.');
    if (entry.size > this.limits.maxEntryBytes) throw new ZipError('Časť dokumentu je po rozbalení príliš veľká.');
    if (this.readBytes + entry.size > this.limits.maxTotalBytes) throw new ZipError('Dokument je po rozbalení príliš veľký.');
    const header = entry.offset;
    if (header + 30 > this.buffer.length || this.buffer.readUInt32LE(header) !== 0x04034b50) throw new ZipError('Poškodený súbor (hlavička ZIP).');
    const start = header + 30 + this.buffer.readUInt16LE(header + 26) + this.buffer.readUInt16LE(header + 28);
    const data = this.buffer.subarray(start, start + entry.compressedSize);
    let content: Buffer;
    if (entry.method === 0) content = Buffer.from(data);
    else if (entry.method === 8) {
      try {
        // skutočný výstup obmedzený — hlavička môže klamať o veľkosti
        content = inflateRawSync(data, { maxOutputLength: Math.min(this.limits.maxEntryBytes, this.limits.maxTotalBytes - this.readBytes) + 1 });
      } catch {
        throw new ZipError('Časť dokumentu sa nedá rozbaliť alebo je príliš veľká.');
      }
    } else throw new ZipError('Nepodporovaná kompresia v dokumente.');
    if (content.length > this.limits.maxEntryBytes) throw new ZipError('Časť dokumentu je po rozbalení príliš veľká.');
    this.readBytes += content.length;
    return content;
  }

  readText(name: string): string | null {
    return this.read(name)?.toString('utf8') ?? null;
  }
}
