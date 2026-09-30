/**
 * Klient AI (#42) bez skutočného volania — podvrhnutý fetch overí, čo by sa
 * poslalo Anthropic Messages API (model, vynútený nástroj, PDF a obrázok ako
 * bloky, hlavičky) a ako sa spracuje odpoveď aj chyby. Kľúč sa nesmie objaviť
 * v chybovej hláške. Odpoveď AI sa očistí rovnako ako návrh podľa pravidiel.
 *
 * Spustenie:  docker exec process-platform-angular-api-1 sh -c "cd /app && npx tsx scripts/ai-client-test.ts"
 */
import { AI_MODEL, AiError, IMPORT_TOOL, PROCESS_DRAFT_TOOL, buildAiBody, callAiTool, importPrompt, processDraftPrompt } from '../server/ai';
import { candidatesFromAi } from '../server/import-candidates';
import { reachableFrom, sanitizeDraft } from '../src/app/shared/process-draft/draft';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: unknown, detail = '') => results.push({ name, ok: Boolean(ok), detail });
const KEY = `sk-ant-test-${'k'.repeat(30)}`;

type Captured = { url: string; headers: Record<string, string>; body: any };
function fakeFetch(reply: { status?: number; body?: unknown; fail?: boolean }, captured: Captured[] = []) {
  return async (url: string, init: { headers: Record<string, string>; body: string }) => {
    captured.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (reply.fail) throw new Error('network down');
    return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, json: async () => reply.body };
  };
}

async function main() {
  // --- požiadavka ---
  const body = buildAiBody({
    apiKey: KEY,
    system: processDraftPrompt(['Účtovník']),
    content: [
      { type: 'text', text: 'Dokument: smernica.pdf' },
      { type: 'document', mediaType: 'application/pdf', data: 'JVBERi0=' },
      { type: 'image', mediaType: 'image/png', data: 'iVBORw0=' }
    ],
    tool: IMPORT_TOOL
  });
  check('predvolený model je najnovší Claude', AI_MODEL === (process.env['AI_MODEL'] || 'claude-opus-5-5') && body.model === AI_MODEL, body.model);
  check('nástroj vynútený (štruktúrovaná odpoveď)', body.tool_choice.type === 'tool' && body.tool_choice.name === IMPORT_TOOL.name && body.tools[0].name === IMPORT_TOOL.name);
  const blocks = body.messages[0].content as any[];
  check('PDF ako dokument, obrázok ako obrázok', blocks[1].type === 'document' && blocks[1].source.media_type === 'application/pdf' && blocks[2].type === 'image' && blocks[2].source.type === 'base64');
  check('kľúč nie je v tele požiadavky', !JSON.stringify(body).includes(KEY));
  check('pokyny: nevymýšľať, bez certifikácie', /Nevymýšľaj/.test(body.system) && /certifik/.test(body.system));
  check('známe miesta v pokynoch', processDraftPrompt(['Účtovník', 'Konateľ']).includes('Účtovník; Konateľ') && importPrompt(['Konateľ']).includes('pavúka'));

  // --- odpoveď ---
  const captured: Captured[] = [];
  const input = { name: 'Nákup', nodes: [{ id: 'a', type: 'task', name: 'Objednať' }], flows: [] };
  const result = await callAiTool(
    { apiKey: KEY, system: 's', content: [{ type: 'text', text: 't' }], tool: PROCESS_DRAFT_TOOL },
    fakeFetch({ body: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: PROCESS_DRAFT_TOOL.name, input }] } }, captured) as any
  );
  check('vstup nástroja z odpovede', JSON.stringify(result) === JSON.stringify(input));
  check('hlavičky Anthropic API', captured[0]?.headers['x-api-key'] === KEY && captured[0]?.headers['anthropic-version'] === '2023-06-01' && captured[0]?.url.includes('/v1/messages'));

  const failure = async (reply: Parameters<typeof fakeFetch>[0]) => {
    try {
      await callAiTool({ apiKey: KEY, system: 's', content: [], tool: PROCESS_DRAFT_TOOL }, fakeFetch(reply) as any);
      return null;
    } catch (error) {
      return error as AiError;
    }
  };
  const unauthorized = await failure({ status: 401, body: { error: { message: `bad key ${KEY}` } } });
  check('neplatný kľúč → zrozumiteľná chyba bez kľúča', unauthorized instanceof AiError && unauthorized.message.includes('kľúč') && !unauthorized.message.includes(KEY), unauthorized?.message ?? '');
  const busy = await failure({ status: 529 });
  check('preťaženie → 503', busy instanceof AiError && busy.status === 503);
  const truncated = await failure({ body: { stop_reason: 'max_tokens', content: [] } });
  check('príliš dlhá odpoveď → rozdeliť', truncated instanceof AiError && truncated.message.includes('rozdeľte'));
  const offline = await failure({ fail: true });
  check('nedostupná služba → pokračovať bez AI', offline instanceof AiError && offline.message.includes('bez AI'));

  // --- očistenie odpovede AI ---
  const messy = sanitizeDraft({
    name: 'Reklamácia',
    nodes: [
      { id: 's1', type: 'start', name: 'Príde reklamácia' },
      { id: 's2', type: 'start', name: 'Druhý začiatok' },
      { id: 'k', type: 'task', name: 'Posúdiť reklamáciu', role: 'Technik' },
      { id: 'k', type: 'task', name: 'Rovnaké ID' },
      { id: 'q', type: 'gateway', name: 'Oprávnená' },
      { id: 'lost', type: 'task', name: 'Nenapojený krok' }
    ],
    flows: [{ from: 's1', to: 'k' }, { from: 'k', to: 'q' }, { from: 'q', to: 'neexistuje' }, { from: 'q', to: 'q' }]
  });
  const starts = messy.nodes.filter((node) => node.type === 'start');
  const start = starts[0];
  const reachable = reachableFrom(start.id, messy.flows);
  check('práve jeden začiatok, jedinečné ID', starts.length === 1 && new Set(messy.nodes.map((node) => node.id)).size === messy.nodes.length);
  check('všetko dosiahnuteľné, je koniec', messy.nodes.every((node) => reachable.has(node.id)) && messy.nodes.some((node) => node.type === 'end'));
  check('spojenia len medzi existujúcimi uzlami', messy.flows.every((flow) => flow.from !== flow.to && messy.nodes.some((node) => node.id === flow.to)));
  check('roly z krokov', messy.roles.includes('Technik'));

  const candidates = candidatesFromAi({
    units: [{ name: 'Ekonomické oddelenie', source: { location: 'strana 2', quote: 'Ekonomické oddelenie' } }, { name: 'ekonomické ODDELENIE' }],
    positions: [{ name: 'Hlavná účtovníčka', unit: 'Ekonomické oddelenie', reportsTo: 'Konateľ', holder: 'Jana Malá', source: { location: 'obrázok', quote: 'x'.repeat(500) } }],
    processes: [{ name: 'Fakturácia', nodes: [{ id: 'a', type: 'task', name: 'Vystaviť faktúru' }], flows: [], source: { location: 'strana 3', quote: 'Vystaví faktúru' } }],
    warnings: ['Schéma je čiastočne nečitateľná']
  }, 'schema.png');
  check('AI kandidáti: zlúčené duplicity, citácie skrátené', candidates.units.length === 1 && candidates.positions[0].source.quote.length <= 200 && candidates.positions[0].source.file === 'schema.png'
    && candidates.positions[0].unitKey === 'ekonomicke oddelenie' && candidates.positions[0].reportsToKey === 'konatel');
  check('AI kandidáti: proces ako súvislý návrh', candidates.processes[0].draft.nodes.some((node) => node.type === 'start') && candidates.processes[0].source.location === 'strana 3');

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name.padEnd(55)} ${r.ok ? '' : r.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} prešlo`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
