/**
 * #42 AI-01 — volanie Claude (Anthropic Messages API) so štruktúrovaným
 * výstupom cez nástroj (tool use). Kľúč ani obsah sa nezapisujú do logu;
 * chyba vracia len všeobecný popis. Poskytovateľa a model určí prevádzkovateľ
 * (ANTHROPIC_API_KEY, AI_MODEL); firma AI zapína sama v Integráciách.
 */

export const AI_PROVIDER_LABEL = 'Anthropic (Claude)';
export const AI_MODEL = process.env['AI_MODEL'] || 'claude-opus-5-5';
export const PLATFORM_AI_KEY = process.env['ANTHROPIC_API_KEY'] || '';
const API_URL = process.env['ANTHROPIC_API_URL'] || 'https://api.anthropic.com/v1/messages';

export type AiContent =
  | { type: 'text'; text: string }
  | { type: 'document'; mediaType: 'application/pdf'; data: string }
  | { type: 'image'; mediaType: string; data: string };

export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiRequest {
  apiKey: string;
  system: string;
  content: AiContent[];
  tool: AiTool;
  maxTokens?: number;
  model?: string;
}

export class AiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Telo požiadavky pre Messages API — samostatne, aby sa dalo overiť v teste. */
export function buildAiBody(request: AiRequest) {
  return {
    model: request.model ?? AI_MODEL,
    max_tokens: request.maxTokens ?? 8000,
    system: request.system,
    tools: [request.tool],
    tool_choice: { type: 'tool', name: request.tool.name },
    messages: [{
      role: 'user',
      content: request.content.map((item) => item.type === 'text'
        ? { type: 'text', text: item.text }
        : { type: item.type, source: { type: 'base64', media_type: item.mediaType, data: item.data } })
    }]
  };
}

export async function callAiTool(request: AiRequest, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<unknown> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(buildAiBody(request)),
      signal: AbortSignal.timeout(180_000)
    });
  } catch {
    throw new AiError('AI služba neodpovedala — skúste to znova alebo pokračujte bez AI.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new AiError('AI kľúč nie je platný — skontrolujte nastavenie v Integráciách.');
    if (response.status === 429 || response.status === 529) throw new AiError('AI je momentálne preťažená — skúste to o chvíľu.', 503);
    if (response.status === 413) throw new AiError('Dokument je pre AI príliš veľký — rozdeľte ho na menšie časti.', 413);
    throw new AiError(`AI službu sa nepodarilo použiť (HTTP ${response.status}).`);
  }
  const body = await response.json().catch(() => null);
  const block = (body?.content ?? []).find((item: any) => item?.type === 'tool_use' && item?.name === request.tool.name);
  if (!block || typeof block.input !== 'object') {
    throw new AiError(body?.stop_reason === 'max_tokens'
      ? 'Odpoveď AI bola príliš dlhá — rozdeľte text alebo dokument na menšie časti.'
      : 'AI nevrátila štruktúrovaný návrh — skúste to znova.');
  }
  return block.input;
}

// --- nástroje (štruktúra odpovede) ---

const DRAFT_PROPERTIES = {
  name: { type: 'string', description: 'Názov procesu (podstatné meno, napr. „Spracovanie prijatej faktúry“)' },
  purpose: { type: 'string', description: 'Účel — prečo proces existuje; prázdne, ak v texte nie je' },
  trigger: { type: 'string', description: 'Spúšťač — kedy sa proces začína' },
  outcome: { type: 'string', description: 'Výsledok — čo proces prinesie' },
  roles: { type: 'array', items: { type: 'string' }, description: 'Roly / pracovné miesta, ktoré kroky vykonávajú' },
  nodes: {
    type: 'array',
    description: 'Uzly procesu: práve jeden start, kroky (task), rozhodnutia (gateway) a aspoň jeden end',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: ['start', 'task', 'gateway', 'end'] },
        name: { type: 'string', description: 'Krok ako činnosť (sloveso + predmet), rozhodnutie ako otázka' },
        role: { type: 'string', description: 'Kto krok vykonáva, ak to z textu vyplýva' },
        description: { type: 'string' }
      },
      required: ['id', 'type', 'name']
    }
  },
  flows: {
    type: 'array',
    items: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string', description: 'Pri rozhodnutí napr. „Áno“ / „Nie“' } },
      required: ['from', 'to']
    }
  },
  warnings: { type: 'array', items: { type: 'string' }, description: 'Čo v texte chýba alebo je nejasné' }
};

export const PROCESS_DRAFT_TOOL: AiTool = {
  name: 'submit_process_draft',
  description: 'Vráti štruktúrovaný návrh jedného procesu.',
  input_schema: { type: 'object', properties: DRAFT_PROPERTIES, required: ['name', 'nodes', 'flows'] }
};

const CITATION = {
  type: 'object',
  properties: {
    location: { type: 'string', description: 'Miesto v dokumente: strana, hárok, odsek, snímka alebo časť obrázka' },
    quote: { type: 'string', description: 'Krátky doslovný úryvok (najviac 200 znakov)' }
  },
  required: ['location', 'quote']
};

export const IMPORT_TOOL: AiTool = {
  name: 'submit_import_candidates',
  description: 'Vráti kandidátov na organizačné útvary, pracovné miesta a procesy nájdené v dokumente.',
  input_schema: {
    type: 'object',
    properties: {
      units: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, parent: { type: 'string', description: 'Nadradený útvar' }, source: CITATION }, required: ['name', 'source'] }
      },
      positions: {
        type: 'array',
        description: 'Pracovné miesta (rámčeky organizačnej schémy – pavúka – aj miesta spomenuté v texte)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Názov pracovného miesta, nie meno osoby' },
            unit: { type: 'string' },
            reportsTo: { type: 'string', description: 'Nadriadené pracovné miesto podľa schémy' },
            holder: { type: 'string', description: 'Meno osoby pri mieste, len ak je v dokumente' },
            source: CITATION
          },
          required: ['name', 'source']
        }
      },
      processes: {
        type: 'array',
        items: { type: 'object', properties: { ...DRAFT_PROPERTIES, source: CITATION }, required: ['name', 'nodes', 'flows', 'source'] }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    },
    required: ['units', 'positions', 'processes']
  }
};

const RULES = `Pravidlá:
- Používaj len to, čo je v podkladoch. Nevymýšľaj kroky, roly, útvary ani systémy.
- Kroky pomenuj ako činnosť (sloveso + predmet), stručne. Rozhodnutia ako otázku s vetvami „Áno“ / „Nie“ alebo pomenovanými vetvami.
- Rola = pracovné miesto, ktoré krok vykonáva. Ak ju text neuvádza, nechaj ju prázdnu a uveď to vo warnings.
- Graf procesu: práve jeden start, aspoň jeden end, každý krok dosiahnuteľný zo startu.
- Píš v jazyku podkladov (predvolene slovensky). Nepíš nič o certifikácii ani zhode s normami.`;

export function processDraftPrompt(knownPositions: string[]): string {
  return `Si skúsený procesný analytik. Z popisu používateľa vytvor návrh jedného procesu pre procesnú knižnicu firmy.
${RULES}
${knownPositions.length ? `Pracovné miesta, ktoré firma už má (použi ich presný názov, ak zodpovedajú): ${knownPositions.slice(0, 200).join('; ')}` : ''}`;
}

export function importPrompt(knownPositions: string[]): string {
  return `Si skúsený procesný a organizačný analytik. V dokumente firmy nájdi kandidátov:
1. organizačné útvary (oddelenia, úseky) a ich nadradenosť,
2. pracovné miesta — najmä z organizačnej schémy („pavúka“): každý rámček je miesto alebo útvar; čiara nadol znamená podriadenosť (reportsTo),
3. procesy — postupy s krokmi, kto ich vykonáva a rozhodnutia.
Každý kandidát musí mať citáciu zdroja (miesto v dokumente a krátky doslovný úryvok).
Meno osoby uveď len ak je v dokumente priamo pri mieste (holder); inak ho vynechaj.
${RULES}
${knownPositions.length ? `Firma už má tieto miesta (ak ide o to isté miesto, použi presne tento názov): ${knownPositions.slice(0, 200).join('; ')}` : ''}`;
}
