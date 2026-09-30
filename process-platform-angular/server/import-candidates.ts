import { DiagramNode, ExtractedBlock, ExtractedDocument } from './doc-extract';
import { ProcessDraft, foldName, sanitizeDraft } from '../src/app/shared/process-draft/draft';
import { parseProcessText } from '../src/app/shared/process-draft/text-parser';

/**
 * #41 IMP-01 — kandidáti z dokumentu podľa pravidiel (bez AI): útvary
 * a pracovné miesta z organizačnej schémy (SmartArt „pavúk“) a z tabuliek,
 * procesy z nadpisov s očíslovanými krokmi. Každý kandidát má citáciu —
 * súbor, miesto a úryvok. Nič sa nevytvára, kým to človek nepotvrdí.
 */

export interface Citation {
  file: string;
  location: string;
  quote: string;
}

export interface UnitCandidate {
  key: string;
  name: string;
  parentKey: string | null;
  source: Citation;
}

export interface PositionCandidate {
  key: string;
  name: string;
  unitKey: string | null;
  reportsToKey: string | null;
  /** meno človeka pri mieste v schéme (osobný údaj — vytvorí sa len na výslovnú voľbu) */
  holder: string | null;
  source: Citation;
}

export interface ProcessCandidate {
  key: string;
  draft: ProcessDraft;
  source: Citation;
}

export interface ImportCandidates {
  units: UnitCandidate[];
  positions: PositionCandidate[];
  processes: ProcessCandidate[];
  warnings: string[];
}

// hranice slov aj pri diakritike (\b v JS pozná len ASCII — „úsek“ by nenašlo)
const UNIT_WORDS = /(?<!\p{L})(oddelenie|oddelenia|úsek|úseku|útvar|útvaru|odbor|divízia|divízie|sekcia|tím|stredisko|prevádzka|závod|kancelária|referát|department|team|division|výroba|obchod|ekonomika|logistika|sklad|personalistika|marketing|financie|nákup|predaj|servis|údržba|kvalita)(?!\p{L})/iu;
const UNIT_EXACT = /^(?:oddelenie|úsek|útvar|odbor|divízia|sekcia|tím|stredisko|prevádzka|závod|kancelária|referát)(?!\p{L})/iu;
const TITLES = /\b(?:Ing|Mgr|Bc|PhDr|MUDr|JUDr|RNDr|PaedDr|doc|prof|PhD|CSc|MBA|DiS|arch)\.?(?=\s|,|$)/g;
const ROLE_HINT = /(?:riadite|veduc|vedúc|manaž|konate|referent|špecialist|asistent|účtovn|technik|skladn|obchodn|majster|koordin|správca|operátor|pracovník|mechanik|analytik|projekt|nákupc|predajc|personalist|mzdov|logistik|dispečer|vodič|recepčn|sekretár|kontrolór|audítor|chief|head|manager|director|officer|assistant|specialist|lead)/i;

function quote(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 200 ? `${clean.slice(0, 197)}…` : clean;
}

function capitalizeName(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/[:;,.]+$/, '');
  return clean ? clean[0].toLocaleUpperCase('sk') + clean.slice(1) : clean;
}

/** Riadok vyzerá ako meno osoby (2–3 slová s veľkým písmenom, bez pomenovania roly). */
function looksLikePerson(line: string): boolean {
  const withoutTitles = line.replace(TITLES, '').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ][a-záäčďéíĺľňóôŕšťúýž]+(?:[- ][A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ][a-záäčďéíĺľňóôŕšťúýž]+){1,2}$/.test(withoutTitles)
    && !ROLE_HINT.test(withoutTitles) && !UNIT_WORDS.test(withoutTitles);
}

function personName(line: string): string {
  return line.replace(/\s+/g, ' ').trim().replace(/[,;]+$/, '');
}

class OrgBuilder {
  readonly units = new Map<string, UnitCandidate>();
  readonly positions = new Map<string, PositionCandidate>();

  unit(name: string, parentKey: string | null, source: Citation): string {
    const clean = capitalizeName(name).slice(0, 200);
    const key = foldName(clean);
    if (!this.units.has(key)) this.units.set(key, { key, name: clean, parentKey: parentKey && parentKey !== key ? parentKey : null, source });
    else if (!this.units.get(key)!.parentKey && parentKey && parentKey !== key) this.units.get(key)!.parentKey = parentKey;
    return key;
  }

  position(name: string, unitKey: string | null, reportsToKey: string | null, holder: string | null, source: Citation): string {
    const clean = capitalizeName(name).slice(0, 200);
    const key = foldName(clean);
    const existing = this.positions.get(key);
    if (!existing) {
      this.positions.set(key, { key, name: clean, unitKey, reportsToKey: reportsToKey && reportsToKey !== key ? reportsToKey : null, holder, source });
    } else {
      existing.unitKey = existing.unitKey ?? unitKey;
      if (!existing.reportsToKey && reportsToKey && reportsToKey !== key) existing.reportsToKey = reportsToKey;
      existing.holder = existing.holder ?? holder;
    }
    return key;
  }
}

/** Rámček organizačnej schémy → útvar, alebo miesto (a meno človeka, ak je v rámčeku). */
function classifyBox(text: string): { unit: string | null; position: string | null; holder: string | null } {
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length === 0) return { unit: null, position: null, holder: null };
  const holderLine = lines.find(looksLikePerson) ?? null;
  const rest = lines.filter((line) => line !== holderLine);
  // „Ekonomické oddelenie“ bez pomenovania roly = útvar
  const unitLine = rest.find((line) => UNIT_EXACT.test(line) || (UNIT_WORDS.test(line) && !ROLE_HINT.test(line)));
  const positionLine = rest.find((line) => line !== unitLine && ROLE_HINT.test(line)) ?? rest.find((line) => line !== unitLine) ?? null;
  if (unitLine && !positionLine) return { unit: unitLine, position: null, holder: holderLine };
  return { unit: unitLine ?? null, position: positionLine ?? (holderLine ? null : lines[0]), holder: holderLine ? personName(holderLine) : null };
}

function fromDiagram(org: OrgBuilder, block: Extract<ExtractedBlock, { kind: 'diagram' }>, file: string): void {
  const walk = (nodes: DiagramNode[], unitKey: string | null, positionKey: string | null, depth: number) => {
    for (const node of nodes) {
      if (depth > 30) return;
      const box = classifyBox(node.text);
      const source: Citation = { file, location: block.location, quote: quote(node.text) };
      let nextUnit = unitKey;
      let nextPosition = positionKey;
      if (box.unit) nextUnit = org.unit(box.unit, unitKey, source);
      if (box.position) nextPosition = org.position(box.position, nextUnit, positionKey, box.holder, source);
      walk(node.children, nextUnit, nextPosition, depth + 1);
    }
  };
  walk(block.roots, null, null, 0);
}

const HEADERS = {
  unit: /^(?:útvar|oddelenie|úsek|organizačná jednotka|org\.? jednotka|odbor|stredisko|tím|department|unit)(?!\p{L})/iu,
  parentUnit: /nadraden[ýy] útvar|nadriaden[ýy] útvar|nadradená jednotka|parent unit/iu,
  position: /^(?:pracovné miesto|pracovná pozícia|pozícia|funkcia|miesto|rola|position|job title|role)(?!\p{L})/iu,
  reportsTo: /nadriaden|podlieha|reports to|manager/iu,
  person: /^(?:meno|zamestnanec|osoba|meno a priezvisko|priezvisko|name|employee)(?!\p{L})/iu,
  step: /^(?:krok|činnosť|úloha|aktivita|popis činnosti|postup|step|activity|task)(?!\p{L})/iu,
  who: /^(?:zodpovedn|kto|vykonáva|rola|pracovné miesto|pozícia|responsible|owner|who)/iu
};

function headerIndex(row: string[]): Record<keyof typeof HEADERS, number> {
  const find = (pattern: RegExp, exclude: number[] = []) => row.findIndex((cell, index) => !exclude.includes(index) && pattern.test(cell.trim()));
  const parentUnit = find(HEADERS.parentUnit);
  const reportsTo = find(HEADERS.reportsTo, [parentUnit]);
  const unit = find(HEADERS.unit, [parentUnit, reportsTo]);
  const position = find(HEADERS.position, [reportsTo]);
  const person = find(HEADERS.person);
  const step = find(HEADERS.step);
  const who = find(HEADERS.who, [step]);
  return { unit, parentUnit, position, reportsTo, person, step, who };
}

/** Tabuľka s organizačnou štruktúrou: útvar / miesto / nadriadený / meno. */
function fromOrgTable(org: OrgBuilder, block: Extract<ExtractedBlock, { kind: 'table' }>, file: string): boolean {
  const headerRow = block.rows.findIndex((row) => {
    const index = headerIndex(row);
    return index.position >= 0 && (index.unit >= 0 || index.reportsTo >= 0 || index.person >= 0);
  });
  if (headerRow < 0 || headerRow > 5) return false;
  const index = headerIndex(block.rows[headerRow]);
  const pending: Array<{ key: string; reportsTo: string }> = [];
  block.rows.slice(headerRow + 1).forEach((row, rowIndex) => {
    const cell = (column: number) => (column >= 0 ? (row[column] ?? '').trim() : '');
    const positionName = cell(index.position);
    if (!positionName) return;
    const source: Citation = { file, location: `${block.location}, riadok ${headerRow + rowIndex + 2}`, quote: quote(row.filter(Boolean).join(' · ')) };
    const parentKey = cell(index.parentUnit) ? org.unit(cell(index.parentUnit), null, source) : null;
    const unitKey = cell(index.unit) ? org.unit(cell(index.unit), parentKey, source) : null;
    const holder = cell(index.person) || null;
    const key = org.position(positionName, unitKey, null, holder, source);
    if (cell(index.reportsTo)) pending.push({ key, reportsTo: cell(index.reportsTo) });
  });
  // nadriadený môže byť v tabuľke miesto aj meno človeka
  for (const item of pending) {
    const byName = foldName(item.reportsTo);
    const target = org.positions.get(byName) ?? [...org.positions.values()].find((position) => position.holder && foldName(position.holder) === byName);
    const position = org.positions.get(item.key)!;
    if (target && target.key !== item.key) position.reportsToKey = target.key;
    // miesto mimo tabuľky (napr. už je vo firme) — priradí sa pri potvrdení, ak existuje
    else if (!target && byName !== item.key) position.reportsToKey = byName;
  }
  return true;
}

/** Tabuľka krokov (Krok | Zodpovedný) → text pre rozbor procesu. */
function stepsTableText(block: Extract<ExtractedBlock, { kind: 'table' }>): string | null {
  const headerRow = block.rows.findIndex((row) => headerIndex(row).step >= 0);
  if (headerRow < 0 || headerRow > 3) return null;
  const index = headerIndex(block.rows[headerRow]);
  const lines = block.rows.slice(headerRow + 1).map((row) => {
    const step = (row[index.step] ?? '').trim();
    const who = index.who >= 0 ? (row[index.who] ?? '').trim() : '';
    return step ? `${who ? `${who}: ` : ''}${step}` : '';
  }).filter(Boolean);
  return lines.length >= 2 ? lines.map((line, number) => `${number + 1}. ${line}`).join('\n') : null;
}

function cleanHeading(text: string): string {
  return text.replace(/^\d+(?:\.\d+)*\.?\s+/, '').replace(/^(?:proces|postup|smernica)\s*[:\-–]\s*/i, '').trim();
}

/** Sekcie podľa nadpisov; sekcia s aspoň dvoma krokmi = kandidát procesu. */
function processCandidates(doc: ExtractedDocument, knownRoles: string[], orgTables: Set<ExtractedBlock>): ProcessCandidate[] {
  type Section = { heading: string | null; location: string; lines: string[]; listCount: number };
  const sections: Section[] = [];
  let current: Section = { heading: null, location: doc.blocks[0]?.location ?? '', lines: [], listCount: 0 };
  const push = () => { if (current.lines.length > 0) sections.push(current); };
  for (const block of doc.blocks) {
    if (block.kind === 'heading') {
      push();
      current = { heading: cleanHeading(block.text), location: block.location, lines: [], listCount: 0 };
    } else if (block.kind === 'paragraph') {
      if (block.listLevel !== undefined) {
        current.listCount++;
        current.lines.push(/^\s*(?:\(?\d{1,3}[.)]|[-•*–▪])\s+/.test(block.text) ? block.text : `- ${block.text}`);
      } else current.lines.push(block.text);
    } else if (block.kind === 'table' && !orgTables.has(block)) {
      const text = stepsTableText(block);
      if (text) {
        current.lines.push(text);
        current.listCount += text.split('\n').length;
      }
    }
  }
  push();

  const fileTitle = doc.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const relevant = sections.filter((section) => section.listCount >= 2 && !/organiza[čc]n/i.test(section.heading ?? ''));
  return relevant.slice(0, 30).map((section, index) => {
    const name = section.heading || (relevant.length === 1 ? fileTitle : `${fileTitle} ${index + 1}`);
    const text = [name, ...section.lines].join('\n');
    const draft = parseProcessText(text, { knownRoles });
    if (!section.heading) draft.warnings = draft.warnings.filter((warning) => !warning.startsWith('Chýba názov'));
    return {
      key: `${foldName(name)}#${index}`,
      draft: sanitizeDraft({ ...draft, name }),
      source: { file: doc.fileName, location: section.location, quote: quote(section.lines.slice(0, 3).join(' ')) }
    };
  });
}

export function candidatesFromDocument(doc: ExtractedDocument, knownRoles: string[]): ImportCandidates {
  const org = new OrgBuilder();
  const orgTables = new Set<ExtractedBlock>();
  for (const block of doc.blocks) {
    if (block.kind === 'diagram') fromDiagram(org, block, doc.fileName);
    if (block.kind === 'table' && fromOrgTable(org, block, doc.fileName)) orgTables.add(block);
  }
  const roles = [...knownRoles, ...[...org.positions.values()].map((position) => position.name)];
  const processes = processCandidates(doc, roles, orgTables);
  const warnings = [...doc.warnings];
  if (org.positions.size === 0 && org.units.size === 0 && processes.length === 0 && doc.blocks.length > 0) {
    warnings.push('V dokumente sa podľa pravidiel nenašla organizačná schéma ani procesy s krokmi. Skúste AI alebo dokument s nadpismi a očíslovanými krokmi.');
  }
  return { units: [...org.units.values()], positions: [...org.positions.values()], processes, warnings };
}

/** Odpoveď AI s kandidátmi → rovnaký tvar ako pri pravidlách (kľúče podľa názvu, obmedzené dĺžky). */
export function candidatesFromAi(raw: any, file: string): ImportCandidates {
  const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const cite = (source: any): Citation => ({ file, location: text(source?.location, 120) || 'dokument', quote: text(source?.quote, 200) });
  const units = (Array.isArray(raw?.units) ? raw.units : []).slice(0, 200).filter((item: any) => text(item?.name)).map((item: any) => ({
    key: foldName(text(item.name)), name: text(item.name), parentKey: text(item.parent) ? foldName(text(item.parent)) : null, source: cite(item.source)
  }));
  const positions = (Array.isArray(raw?.positions) ? raw.positions : []).slice(0, 500).filter((item: any) => text(item?.name)).map((item: any) => ({
    key: foldName(text(item.name)),
    name: text(item.name),
    unitKey: text(item.unit) ? foldName(text(item.unit)) : null,
    reportsToKey: text(item.reportsTo) ? foldName(text(item.reportsTo)) : null,
    holder: text(item.holder, 120) || null,
    source: cite(item.source)
  }));
  const processes = (Array.isArray(raw?.processes) ? raw.processes : []).slice(0, 30).map((item: any, index: number) => {
    const draft = sanitizeDraft(item);
    return { key: `${foldName(draft.name)}#${index}`, draft, source: cite(item?.source) };
  });
  const dedupe = <T extends { key: string }>(items: T[]) => [...new Map(items.map((item) => [item.key, item])).values()];
  return {
    units: dedupe(units),
    positions: dedupe(positions),
    processes,
    warnings: (Array.isArray(raw?.warnings) ? raw.warnings : []).map((item: unknown) => text(item, 300)).filter(Boolean).slice(0, 20)
  };
}
