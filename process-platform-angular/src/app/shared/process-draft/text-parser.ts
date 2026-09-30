import { DraftFlow, DraftNode, ProcessDraft, foldName, sanitizeDraft } from './draft';

/**
 * #42 — návrh procesu z textu podľa pravidiel (bez AI). Rozpozná:
 * - názov (prvý krátky riadok), „Účel:“, „Spúšťač:“, „Výsledok:“ a vety
 *   „Proces začína, keď …“, „Cieľom je …“;
 * - kroky z očíslovaného alebo odrážkového zoznamu, inak z viet;
 * - kto krok robí: „Účtovník: …“, „… (Účtovník)“, známe pracovné miesta
 *   firmy a bežné pomenovania rolí;
 * - rozhodnutia „Ak …, … inak …“ a nasledujúce „Ak nie, …“.
 * Výsledok je vždy len návrh — ukáže sa na kontrolu pred vytvorením procesu.
 */

const LIST_ITEM = /^\s*(?:\(?\d{1,3}[.)]|\(?[a-z][.)]|[-•*–—▪◦])\s+(.+)$/i;
const META = [
  { key: 'purpose', pattern: /^(?:účel|cieľ)(?: procesu)?\s*[:\-–—]\s*(.+)$/i },
  { key: 'trigger', pattern: /^(?:spúšťač|začiatok|štart|kedy sa začína|vstup)\s*[:\-–—]\s*(.+)$/i },
  { key: 'outcome', pattern: /^(?:výsledok|výstup|koniec|cieľový stav)\s*[:\-–—]\s*(.+)$/i },
  { key: 'name', pattern: /^(?:proces|názov(?: procesu)?)\s*[:\-–—]\s*(.+)$/i }
] as const;
const TRIGGER_SENTENCE = /^proces (?:sa )?(?:začína|začne|štartuje|spúšťa)[, ]+(?:keď|ak|po tom, ako|v momente, keď)?\s*(.+)$/i;
const PURPOSE_SENTENCE = /^(?:cieľom|účelom)(?: procesu)? je,?\s*(?:aby\s+)?(.+)$/i;
const OUTCOME_SENTENCE = /^(?:výsledkom|výstupom)(?: procesu)? je\s+(.+)$/i;
const END_SENTENCE = /^(?:proces|tým sa proces|týmto sa proces)\s+(?:sa\s+)?(?:končí|konči|je ukončený|skončí)/i;
const DECISION = /^(?:ak|pokiaľ|v prípade(?:,)? (?:že|ak))\s+(.+?)\s*,\s*(?:tak\s+|potom\s+)?(.+?)(?:\s*(?:[,;]|\s)\s*(?:inak|ak nie|v opačnom prípade|ak nie je)\s*,?\s*(.+?))?[.!]?$/i;
const ELSE_SENTENCE = /^(?:ak nie|inak|v opačnom prípade|ak nie je)\s*,?\s*(.+?)[.!]?$/i;
const ENDS_PROCESS = /(?:proces (?:sa )?(?:končí|skončí|je ukončený)|^koniec\b|^ukončiť proces)/i;

/** Bežné pomenovania rolí (začiatky slov bez diakritiky). */
const ROLE_STEMS = [
  'uctovn', 'manazer', 'manazerk', 'veduc', 'referent', 'zakazn', 'klient', 'obchodn', 'skladn', 'asistent',
  'riaditel', 'technik', 'pracovnik', 'pracovnick', 'konatel', 'personalist', 'mzdov', 'nakupc', 'predajc',
  'recepcn', 'administrator', 'spravca', 'kontrolor', 'auditor', 'dodavatel', 'specialist', 'koordinator',
  'dispecer', 'vodic', 'majster', 'operator', 'mechanik', 'projektov', 'analytik', 'programator', 'konzultant',
  'schvalovatel', 'ziadatel', 'zamestnan', 'pokladn', 'fakturant', 'logistik', 'expedient', 'planovac', 'kvalit',
  'bezpecnostn', 'hr ', 'it ', 'uctaren', 'sekretar'
];

function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase('sk') + text.slice(1) : text;
}

function stripEnd(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\s.;:!]+$/, '').trim();
}

/** Role firmy (napr. pracovné miesta) — zhoda podľa začiatkov slov, aj pri inom tvare slova. */
function matchKnownRole(text: string, known: string[]): string | null {
  const words = foldName(text).split(/[^a-z0-9]+/).filter(Boolean);
  // kto je v texte skôr, ten krok robí („Účtovník pošle faktúru vedúcemu“ → Účtovník)
  let best: { role: string; at: number } | null = null;
  for (const role of known) {
    const parts = foldName(role).split(/[^a-z0-9]+/).filter(Boolean);
    if (parts.length === 0) continue;
    const positions = parts.map((part) => {
      const stem = part.length > 5 ? part.slice(0, Math.max(5, part.length - 2)) : part;
      return words.findIndex((word) => word.startsWith(stem));
    });
    if (positions.some((index) => index < 0)) continue;
    const at = Math.min(...positions);
    if (!best || at < best.at || (at === best.at && role.length > best.role.length)) best = { role, at };
  }
  return best?.role ?? null;
}

/** Rola na začiatku vety podľa bežných pomenovaní — „Vedúci skladu schváli …“ → „Vedúci skladu“. */
function guessRole(text: string): string | null {
  const words = text.split(/\s+/);
  for (let index = 0; index < Math.min(words.length, 4); index++) {
    const folded = foldName(words[index]).replace(/[^a-z]/g, '');
    if (folded.length < 3) continue;
    if (!ROLE_STEMS.some((stem) => `${folded} `.startsWith(stem))) continue;
    // „vedúci skladu“, „manažér kvality“ — rola s doplnkom v 2. páde
    const next = words[index + 1] ?? '';
    const withNext = /^(?:veduc|manazer|spravca|referent|specialist|koordinator|riaditel)/.test(folded) && /^[a-záäčďéíĺľňóôŕšťúýž]+$/i.test(next) && next.length > 3
      && !/(?:[ií]|uje|á|e)$/.test(foldName(next)) ? ` ${next}` : '';
    return capitalize(`${words[index].replace(/[^\p{L}-]/gu, '')}${withNext}`);
  }
  return null;
}

/** Kto krok robí a text kroku bez označenia roly. */
function splitRole(text: string, known: string[]): { role: string | null; text: string } {
  const prefixed = text.match(/^([^:]{2,60}):\s+(.+)$/);
  if (prefixed && prefixed[1].split(/\s+/).length <= 5) return { role: capitalize(stripEnd(prefixed[1])), text: prefixed[2] };
  const suffixed = text.match(/^(.+?)\s*\(([^()]{2,60})\)\s*[.!]?$/);
  if (suffixed && suffixed[2].split(/\s+/).length <= 5) return { role: capitalize(stripEnd(suffixed[2])), text: suffixed[1] };
  return { role: matchKnownRole(text, known) ?? guessRole(text), text };
}

/** Text kroku → názov (krátky) a popis (celé znenie, ak je dlhé). */
function titleOf(text: string): { name: string; description?: string } {
  const clean = capitalize(stripEnd(text));
  if (clean.length <= 120) return { name: clean };
  const cut = clean.slice(0, 120);
  const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' – '), cut.lastIndexOf(' '));
  return { name: `${cut.slice(0, at > 40 ? at : 120)}…`, description: clean };
}

type Clause = { text: string; /** pokračovanie tej istej vety — robí to ten istý človek */ continuation: boolean };

/** Vety a ich časti („… a potom …“); úvodné spojky preč, zámeno za prvé slovo. */
function sentences(text: string): Clause[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ0-9])/)
    .flatMap((sentence) => sentence
      .split(/,?\s+(?:a\s+)?(?:potom|následne|nakoniec|napokon)\s+(?=\p{L})/iu)
      .map((part, index) => ({ text: normalizeClause(part), continuation: index > 0 })))
    .filter((part) => part.text.length > 2);
}

const CLITIC = /^(ju|ho|ich|mu|jej|im|sa|si|to)\s+(\S+)\s+(.+)$/i;

function normalizeClause(text: string): string {
  let clause = text.trim().replace(/^(?:potom|následne|nakoniec|napokon|najprv|najskôr|ďalej|zároveň)\s*,?\s+/i, '');
  // „ju účtovníčka vráti“ → „účtovníčka ju vráti“ (zámeno za prvé slovo)
  const clitic = clause.match(CLITIC);
  if (clitic) clause = `${clitic[2]} ${clitic[1].toLowerCase()} ${clitic[3]}`;
  return clause;
}

export interface TextParseOptions {
  /** pracovné miesta firmy — kroky sa k nim priradia aj pri inom tvare slova */
  knownRoles?: string[];
}

export function parseProcessText(input: string, options: TextParseOptions = {}): ProcessDraft {
  const known = options.knownRoles ?? [];
  const text = input.replace(/\r\n?/g, '\n').slice(0, 20000);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const meta: Record<string, string> = {};
  const warnings: string[] = [];

  // názov: prvý krátky riadok bez bodky, ak nasleduje ďalší text
  const body: string[] = [];
  lines.forEach((line, index) => {
    for (const { key, pattern } of META) {
      const match = line.match(pattern);
      if (match && !meta[key]) {
        meta[key] = stripEnd(match[1]);
        return;
      }
    }
    if (index === 0 && lines.length > 1 && line.length <= 80 && !/[.!?:]$/.test(line) && !LIST_ITEM.test(line)) {
      meta['name'] = meta['name'] ?? line;
      return;
    }
    body.push(line);
  });

  const listItems = body.map((line) => line.match(LIST_ITEM)?.[1]).filter((item): item is string => Boolean(item));
  const prose = body.filter((line) => !LIST_ITEM.test(line)).join(' ');
  // pri zozname je okolitý text len úvod — z neho sa berie spúšťač, účel a výsledok
  const candidates: Clause[] = listItems.length >= 2
    ? [...sentences(prose).filter((clause) => isMeta(clause.text)), ...listItems.flatMap((item) => sentences(item))]
    : sentences(body.join(' '));

  const steps: Clause[] = [];
  for (const clause of candidates) {
    const sentence = clause.text;
    const trigger = sentence.match(TRIGGER_SENTENCE);
    if (trigger && !meta['trigger']) { meta['trigger'] = capitalize(stripEnd(trigger[1])); continue; }
    const purpose = sentence.match(PURPOSE_SENTENCE);
    if (purpose && !meta['purpose']) { meta['purpose'] = capitalize(stripEnd(purpose[1])); continue; }
    const outcome = sentence.match(OUTCOME_SENTENCE);
    if (outcome && !meta['outcome']) { meta['outcome'] = capitalize(stripEnd(outcome[1])); continue; }
    if (END_SENTENCE.test(sentence)) continue;
    if (isMeta(sentence) && listItems.length >= 2) continue;
    steps.push(clause);
  }

  const nodes: DraftNode[] = [{ id: 'start', type: 'start', name: meta['trigger'] || 'Začiatok' }];
  const flows: DraftFlow[] = [];
  const end: DraftNode = { id: 'end', type: 'end', name: meta['outcome'] || 'Koniec' };
  // „otvorené konce“ — odkiaľ ide tok do nasledujúceho kroku (s popisom vetvy)
  let open: Array<{ from: string; label?: string }> = [{ from: 'start' }];
  let lastGateway: { id: string; hasElse: boolean } | null = null;
  let counter = 0;
  const addTask = (raw: string, roleHint?: string | null): DraftNode => {
    const { role, text: stepText } = splitRole(normalizeClause(raw), known);
    const title = titleOf(stepText);
    const node: DraftNode = { id: `t${++counter}`, type: 'task', name: title.name, ...(title.description ? { description: title.description } : {}) };
    const who = role ?? roleHint ?? null;
    if (who) node.role = who;
    nodes.push(node);
    return node;
  };
  const connect = (to: string) => {
    for (const item of open) flows.push({ from: item.from, to, ...(item.label ? { label: item.label } : {}) });
  };

  let previousRole: string | null = null;
  for (const clause of steps) {
    const sentence = clause.text;
    const otherwise = sentence.match(ELSE_SENTENCE);
    if (otherwise && lastGateway && !lastGateway.hasElse) {
      // „Ak nie, …“ k predchádzajúcemu rozhodnutiu
      const gatewayId = lastGateway.id;
      lastGateway.hasElse = true;
      open = open.filter((item) => !(item.from === gatewayId && item.label === 'Nie'));
      if (ENDS_PROCESS.test(otherwise[1])) {
        flows.push({ from: gatewayId, to: 'end', label: 'Nie' });
      } else {
        const task = addTask(otherwise[1]);
        flows.push({ from: gatewayId, to: task.id, label: 'Nie' });
        open.push({ from: task.id });
      }
      continue;
    }
    const decision = sentence.match(DECISION);
    if (decision) {
      const [, condition, then, otherwiseText] = decision;
      const gateway: DraftNode = { id: `g${++counter}`, type: 'gateway', name: `${capitalize(stripEnd(condition))}?` };
      nodes.push(gateway);
      connect(gateway.id);
      open = [];
      if (ENDS_PROCESS.test(then)) flows.push({ from: gateway.id, to: 'end', label: 'Áno' });
      else {
        const yes = addTask(then);
        flows.push({ from: gateway.id, to: yes.id, label: 'Áno' });
        open.push({ from: yes.id });
      }
      if (otherwiseText) {
        if (ENDS_PROCESS.test(otherwiseText)) flows.push({ from: gateway.id, to: 'end', label: 'Nie' });
        else {
          const no = addTask(otherwiseText);
          flows.push({ from: gateway.id, to: no.id, label: 'Nie' });
          open.push({ from: no.id });
        }
      } else {
        open.push({ from: gateway.id, label: 'Nie' });
      }
      lastGateway = { id: gateway.id, hasElse: Boolean(otherwiseText) };
      previousRole = null;
      continue;
    }
    // „Skladník pripraví tovar a potom ho odošle“ — druhú časť robí ten istý človek
    const task = addTask(sentence, clause.continuation ? previousRole : null);
    connect(task.id);
    open = [{ from: task.id }];
    lastGateway = null;
    previousRole = task.role ?? null;
  }
  nodes.push(end);
  connect('end');

  const taskCount = nodes.filter((node) => node.type === 'task').length;
  if (taskCount === 0) warnings.push('V texte sa nenašli kroky — napíšte postup ako vety alebo očíslovaný zoznam.');
  else if (taskCount === 1) warnings.push('Z textu vyšiel len jeden krok — rozpíšte postup podrobnejšie.');
  if (taskCount > 0 && nodes.every((node) => node.type !== 'task' || !node.role)) {
    warnings.push('Pri krokoch nie je uvedené, kto ich robí — doplňte pracovné miesta.');
  }
  if (!meta['purpose']) warnings.push('Chýba účel — prečo proces existuje.');
  if (!meta['name']) warnings.push('Chýba názov procesu — doplňte ho.');

  return sanitizeDraft({
    name: meta['name'] || 'Nový proces',
    purpose: meta['purpose'] ?? '',
    trigger: meta['trigger'] ?? '',
    outcome: meta['outcome'] ?? '',
    nodes,
    flows,
    warnings
  });
}

function isMeta(sentence: string): boolean {
  return TRIGGER_SENTENCE.test(sentence) || PURPOSE_SENTENCE.test(sentence) || OUTCOME_SENTENCE.test(sentence) || END_SENTENCE.test(sentence);
}
