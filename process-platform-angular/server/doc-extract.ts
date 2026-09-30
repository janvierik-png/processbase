import { ZipError, ZipReader } from './zip';

/**
 * #41 IMP-01 — text a štruktúra z nahratého dokumentu (Word, Excel,
 * PowerPoint, CSV, text, PDF, obrázok) s miestom v dokumente pre citáciu.
 * Súbor sa nikam neukladá; spracuje sa v pamäti a zahodí.
 * XML sa číta bez parsera s entitami (DOCTYPE sa odmietne — XXE).
 */

export type ImportFormat = 'docx' | 'xlsx' | 'pptx' | 'csv' | 'text' | 'pdf' | 'image';

export interface DiagramNode {
  text: string;
  children: DiagramNode[];
}

export type ExtractedBlock =
  | { kind: 'heading'; level: number; text: string; location: string }
  | { kind: 'paragraph'; text: string; location: string; listLevel?: number }
  | { kind: 'table'; rows: string[][]; location: string }
  | { kind: 'diagram'; roots: DiagramNode[]; location: string };

export interface ExtractedDocument {
  fileName: string;
  format: ImportFormat;
  mimeType: string;
  blocks: ExtractedBlock[];
  warnings: string[];
}

export class ExtractError extends Error {}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** Formát podľa obsahu (nie podľa prípony, tá sa dá podvrhnúť). */
export function detectFormat(buffer: Buffer, fileName: string): { format: ImportFormat; mimeType: string } {
  const head = buffer.subarray(0, 12);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { format: 'pdf', mimeType: 'application/pdf' };
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return { format: 'image', mimeType: IMAGE_TYPES['png'] };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { format: 'image', mimeType: IMAGE_TYPES['jpeg'] };
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return { format: 'image', mimeType: IMAGE_TYPES['gif'] };
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return { format: 'image', mimeType: IMAGE_TYPES['webp'] };
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    const zip = new ZipReader(buffer);
    if (zip.has('word/document.xml')) return { format: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    if (zip.has('xl/workbook.xml')) return { format: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    if (zip.has('ppt/presentation.xml')) return { format: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    throw new ExtractError('ZIP súbor nie je dokument Word, Excel ani PowerPoint.');
  }
  // text: bez nulových bajtov a platné UTF-8
  if (!buffer.subarray(0, 8192).includes(0)) {
    const text = buffer.toString('utf8');
    if (!text.includes('�')) {
      return /\.(csv|tsv)$/i.test(fileName) ? { format: 'csv', mimeType: 'text/csv' } : { format: 'text', mimeType: 'text/plain' };
    }
  }
  throw new ExtractError('Nepodporovaný formát — nahrajte Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, text, PDF alebo obrázok.');
}

export async function extractDocument(fileName: string, buffer: Buffer): Promise<ExtractedDocument> {
  const { format, mimeType } = detectFormat(buffer, fileName);
  const base = { fileName, format, mimeType, warnings: [] as string[] };
  try {
    switch (format) {
      case 'docx': return { ...base, blocks: extractDocx(new ZipReader(buffer)) };
      case 'xlsx': return { ...base, blocks: extractXlsx(new ZipReader(buffer)) };
      case 'pptx': return { ...base, blocks: extractPptx(new ZipReader(buffer)) };
      case 'csv': return { ...base, blocks: [{ kind: 'table', rows: parseCsv(buffer.toString('utf8')), location: 'tabuľka' }] };
      case 'text': return { ...base, blocks: extractPlainText(buffer.toString('utf8')) };
      case 'pdf': {
        const blocks = await extractPdf(buffer);
        if (blocks.length === 0) base.warnings.push('PDF neobsahuje text (napr. naskenovaný dokument alebo schéma ako obrázok) — rozpozná ho len AI.');
        return { ...base, blocks };
      }
      case 'image':
        base.warnings.push('Obrázok (napr. organizačnú schému – pavúka) rozpozná len AI.');
        return { ...base, blocks: [] };
    }
  } catch (error) {
    if (error instanceof ZipError || error instanceof ExtractError) throw error;
    throw new ExtractError('Dokument sa nepodarilo prečítať — môže byť poškodený.');
  }
}

// --- XML pomocníci (bez parsera s entitami) ---

function assertSafeXml(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ExtractError('Dokument obsahuje nepovolené definície (DOCTYPE).');
  return xml;
}

export function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)))
    .replace(/&amp;/g, '&');
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

function tidy(text: string): string {
  return text.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Text Word odseku: w:t, tabulátory a zalomenia. */
function wordRunsText(xml: string): string {
  let text = '';
  const pattern = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
  for (const match of xml.matchAll(pattern)) {
    if (match[1] !== undefined) text += decodeXml(match[1]);
    else if (match[0] === '<w:tab/>') text += '\t';
    else text += '\n';
  }
  return tidy(text);
}

/** Text DrawingML (SmartArt, PowerPoint): odseky a:p s behmi a:t. */
function drawingText(xml: string): string {
  const paragraphs = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\s[^>]*>([\s\S]*?)<\/a:p>/g)].map((match) =>
    [...(match[1] ?? match[2] ?? '').matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((run) => decodeXml(run[1])).join(''));
  return tidy(paragraphs.filter((line) => line.trim()).join('\n'));
}

// --- Word ---

function headingStyles(zip: ZipReader): Map<string, number> {
  const levels = new Map<string, number>();
  const xml = zip.readText('word/styles.xml');
  if (!xml) return levels;
  for (const match of assertSafeXml(xml).matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const name = match[2].match(/<w:name w:val="([^"]+)"/)?.[1] ?? '';
    const level = name.match(/(?:heading|nadpis)\s*(\d)/i)?.[1];
    if (level) levels.set(match[1], Number(level));
    else if (/^title$/i.test(name) || /^názov$/i.test(name)) levels.set(match[1], 1);
  }
  return levels;
}

function extractDocx(zip: ZipReader): ExtractedBlock[] {
  const xml = assertSafeXml(zip.readText('word/document.xml') ?? '');
  const styles = headingStyles(zip);
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  const blocks: ExtractedBlock[] = [];
  let paragraphNo = 0;
  let tableNo = 0;
  for (const match of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const chunk = match[0];
    if (chunk.startsWith('<w:tbl>')) {
      tableNo++;
      const rows = [...chunk.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)].map((row) =>
        [...row[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((cell) =>
          [...cell[1].matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((p) => wordRunsText(p[1])).filter(Boolean).join(' ')));
      if (rows.some((row) => row.some(Boolean))) blocks.push({ kind: 'table', rows: rows.slice(0, 2000), location: `tabuľka ${tableNo}` });
      continue;
    }
    const text = wordRunsText(chunk);
    if (!text) continue;
    paragraphNo++;
    const styleId = chunk.match(/<w:pStyle w:val="([^"]+)"/)?.[1];
    const level = styleId ? styles.get(styleId) ?? Number(styleId.match(/^(?:Heading|Nadpis)(\d)$/i)?.[1] ?? 0) : 0;
    if (level > 0) {
      blocks.push({ kind: 'heading', level, text, location: `odsek ${paragraphNo}` });
      continue;
    }
    const list = chunk.includes('<w:numPr>');
    const listLevel = Number(chunk.match(/<w:ilvl w:val="(\d+)"/)?.[1] ?? 0);
    blocks.push({ kind: 'paragraph', text, location: `odsek ${paragraphNo}`, ...(list ? { listLevel } : {}) });
  }
  blocks.push(...smartArt(zip, /^word\/diagrams\/data\d*\.xml$/));
  return blocks;
}

// --- SmartArt (organizačná schéma — „pavúk“) ---

/**
 * SmartArt dátový model: body (dgm:pt) s textom a spojenia (dgm:cxn,
 * predvolene typ parOf = rodič → dieťa). Strom od koreňa typu „doc“.
 */
function smartArt(zip: ZipReader, pattern: RegExp): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const files = zip.names().filter((name) => pattern.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  files.forEach((file, index) => {
    const xml = assertSafeXml(zip.readText(file) ?? '');
    const points = new Map<string, { type: string; text: string }>();
    for (const match of xml.matchAll(/<dgm:pt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/dgm:pt>)/g)) {
      const modelId = attr(match[1], 'modelId');
      if (!modelId) continue;
      const type = attr(match[1], 'type') ?? 'node';
      const textXml = match[2]?.match(/<dgm:t>([\s\S]*?)<\/dgm:t>/)?.[1] ?? '';
      points.set(modelId, { type, text: drawingText(textXml) });
    }
    const children = new Map<string, Array<{ id: string; order: number }>>();
    for (const match of xml.matchAll(/<dgm:cxn\b([^>]*?)\/?>/g)) {
      const type = attr(match[1], 'type') ?? 'parOf';
      if (type !== 'parOf') continue;
      const source = attr(match[1], 'srcId');
      const target = attr(match[1], 'destId');
      if (!source || !target) continue;
      const list = children.get(source) ?? [];
      list.push({ id: target, order: Number(attr(match[1], 'srcOrd') ?? list.length) });
      children.set(source, list);
    }
    const build = (id: string, depth: number): DiagramNode[] => {
      if (depth > 30) return [];
      const kids = (children.get(id) ?? []).sort((a, b) => a.order - b.order);
      return kids.flatMap((kid) => {
        const point = points.get(kid.id);
        if (!point || (point.type !== 'node' && point.type !== 'asst')) return [];
        const nested = build(kid.id, depth + 1);
        // bod bez textu (prázdny rámček) — jeho deti pod rodiča
        return point.text ? [{ text: point.text, children: nested }] : nested;
      });
    };
    const root = [...points].find(([, point]) => point.type === 'doc')?.[0];
    const roots = root ? build(root, 0) : [];
    if (roots.length > 0) blocks.push({ kind: 'diagram', roots, location: `diagram ${index + 1}` });
  });
  return blocks;
}

// --- Excel ---

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function extractXlsx(zip: ZipReader): ExtractedBlock[] {
  const shared = [...assertSafeXml(zip.readText('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((match) => [...match[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((run) => decodeXml(run[1])).join(''));
  const workbook = assertSafeXml(zip.readText('xl/workbook.xml') ?? '');
  const rels = assertSafeXml(zip.readText('xl/_rels/workbook.xml.rels') ?? '');
  const targets = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/>/g)].map((match) => [attr(match[1], 'Id') ?? '', attr(match[1], 'Target') ?? '']));
  const blocks: ExtractedBlock[] = [];
  for (const sheet of [...workbook.matchAll(/<sheet\b([^>]*)\/>/g)].slice(0, 20)) {
    const name = attr(sheet[1], 'name') ?? 'Hárok';
    const target = targets.get(attr(sheet[1], 'r:id') ?? '') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = zip.readText(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const row of assertSafeXml(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 2000) break;
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const index = columnIndex(attr(cell[1], 'r') ?? 'A');
        if (index > 60) continue;
        const type = attr(cell[1], 't');
        const inner = cell[2] ?? '';
        const raw = inner.match(/<v>([^<]*)<\/v>/)?.[1];
        let value = '';
        if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((run) => decodeXml(run[1])).join('');
        else if (raw !== undefined) value = decodeXml(raw);
        cells[index] = tidy(value);
      }
      rows.push(Array.from(cells, (value) => value ?? ''));
    }
    if (rows.some((row) => row.some(Boolean))) blocks.push({ kind: 'table', rows, location: `hárok „${name}“` });
  }
  return blocks;
}

// --- PowerPoint ---

function extractPptx(zip: ZipReader): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const slides = zip.names().filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const slide of slides.slice(0, 200)) {
    const number = slide.match(/slide(\d+)\.xml$/)?.[1];
    const xml = assertSafeXml(zip.readText(slide) ?? '');
    const shapes = [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map((match) => ({
      title: /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(match[1]),
      text: drawingText(match[1])
    })).filter((shape) => shape.text);
    for (const shape of shapes) {
      if (shape.title) blocks.push({ kind: 'heading', level: 1, text: shape.text.replace(/\n/g, ' '), location: `snímka ${number}` });
      else for (const line of shape.text.split('\n')) blocks.push({ kind: 'paragraph', text: line, location: `snímka ${number}`, listLevel: 0 });
    }
  }
  blocks.push(...smartArt(zip, /^ppt\/diagrams\/data\d*\.xml$/));
  return blocks;
}

// --- CSV, text, PDF ---

export function parseCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim()).slice(0, 2000);
  const sample = lines.slice(0, 5).join('\n');
  const delimiter = [';', '\t', ','].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') { current += '"'; index++; }
        else if (char === '"') quoted = false;
        else current += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) { cells.push(current.trim()); current = ''; }
      else current += char;
    }
    cells.push(current.trim());
    return cells.slice(0, 60);
  });
}

export function extractPlainText(text: string, locationPrefix = 'riadok'): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  text.replace(/\r\n?/g, '\n').split('\n').slice(0, 20000).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const location = `${locationPrefix} ${index + 1}`;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2], location });
    else if (/^\s*(?:\(?\d{1,3}[.)]|[-•*–▪])\s+/.test(raw)) blocks.push({ kind: 'paragraph', text: line, location, listLevel: Math.floor((raw.length - raw.trimStart().length) / 2) });
    else blocks.push({ kind: 'paragraph', text: line, location });
  });
  return blocks;
}

async function extractPdf(buffer: Buffer): Promise<ExtractedBlock[]> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const parsed: any = await parser.getText();
    const pages: string[] = Array.isArray(parsed?.pages) && parsed.pages.length
      ? parsed.pages.map((page: any) => String(page?.text ?? ''))
      : [String(parsed?.text ?? '')];
    const blocks: ExtractedBlock[] = [];
    pages.slice(0, 300).forEach((pageText, pageIndex) => {
      const lines = pageText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      lines.forEach((line, lineIndex) => {
        const location = `strana ${pageIndex + 1}`;
        const next = lines[lineIndex + 1] ?? '';
        // krátky riadok bez interpunkcie, po ktorom nasleduje zoznam — nadpis
        const listNext = /^(?:\d{1,3}[.)]|[-•*–▪])\s+/.test(next);
        const numberedHeading = /^\d+(?:\.\d+)*\.?\s+\S/.test(line) && line.length <= 80 && !/[.;:,]$/.test(line) && listNext;
        if ((line.length <= 80 && !/[.;:,]$/.test(line) && listNext && !/^(?:\d{1,3}[.)]|[-•*–▪])\s+/.test(line)) || numberedHeading) {
          blocks.push({ kind: 'heading', level: 2, text: line.replace(/^\d+(?:\.\d+)*\.?\s+/, ''), location });
        } else if (/^(?:\d{1,3}[.)]|[-•*–▪])\s+/.test(line)) blocks.push({ kind: 'paragraph', text: line, location, listLevel: 0 });
        else blocks.push({ kind: 'paragraph', text: line, location });
      });
    });
    return blocks;
  } finally {
    await parser.destroy();
  }
}

/** Obsah pre AI ako čitateľný text s miestami v dokumente (pre citácie). */
export function blocksToText(blocks: ExtractedBlock[], limit = 120000): string {
  const out: string[] = [];
  const tree = (nodes: DiagramNode[], depth: number): string[] =>
    nodes.flatMap((node) => [`${'  '.repeat(depth)}- ${node.text.replace(/\n/g, ' / ')}`, ...tree(node.children, depth + 1)]);
  for (const block of blocks) {
    if (block.kind === 'heading') out.push(`[${block.location}] ${'#'.repeat(Math.min(block.level + 1, 6))} ${block.text}`);
    else if (block.kind === 'paragraph') out.push(`[${block.location}] ${block.listLevel !== undefined ? `${'  '.repeat(block.listLevel)}- ` : ''}${block.text}`);
    else if (block.kind === 'table') out.push(`[${block.location}]`, ...block.rows.slice(0, 500).map((row) => `| ${row.join(' | ')} |`));
    else out.push(`[${block.location} — organizačná schéma / SmartArt]`, ...tree(block.roots, 0));
  }
  const text = out.join('\n');
  return text.length > limit ? `${text.slice(0, limit)}\n[… text skrátený]` : text;
}
