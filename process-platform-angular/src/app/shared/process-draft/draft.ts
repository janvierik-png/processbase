/**
 * #42 AI-01 / #41 IMP-01 — návrh procesu ako graf (začiatok, kroky,
 * rozhodnutia, koniec) a jeho kontrola. Rovnaký model vracia AI, rozbor
 * textu podľa pravidiel aj import dokumentov; z neho vzniká zoznam krokov
 * a BPMN diagram. Čistý TypeScript bez závislostí — používa ho server
 * aj prehliadač (bezplatný modeler bez odosielania textu na server).
 */

export type DraftNodeType = 'start' | 'task' | 'gateway' | 'end';

export interface DraftNode {
  id: string;
  type: DraftNodeType;
  name: string;
  /** kto krok robí — názov pracovného miesta alebo roly z textu */
  role?: string;
  description?: string;
}

export interface DraftFlow {
  from: string;
  to: string;
  /** pri rozhodnutí, napr. „Áno“ / „Nie“ */
  label?: string;
}

export interface ProcessDraft {
  name: string;
  purpose: string;
  trigger: string;
  outcome: string;
  roles: string[];
  nodes: DraftNode[];
  flows: DraftFlow[];
  /** čo v texte chýba alebo je neisté — ukáže sa pred vytvorením návrhu */
  warnings: string[];
}

/** Krok do lineárneho zoznamu krokov procesu (karta Kroky). */
export interface DraftStep {
  nodeId: string;
  title: string;
  description: string;
  role: string | null;
}

export const DRAFT_LIMITS = {
  nodes: 80,
  flows: 160,
  roles: 30,
  warnings: 20,
  name: 200,
  text: 1000,
  nodeName: 300,
  description: 2000,
  role: 120
} as const;

const TYPES: DraftNodeType[] = ['start', 'task', 'gateway', 'end'];

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Porovnanie bez diakritiky a veľkosti písmen (duplicitné roly, miesta, procesy). */
export function foldName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function uniqueNames(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const key = foldName(value);
    if (key && !seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
}

/**
 * Návrh z ľubovoľného zdroja (aj z odpovede AI) na bezpečný tvar: obmedzené
 * dĺžky a počty, jedinečné ID, spojenia len medzi existujúcimi uzlami, práve
 * jeden začiatok, aspoň jeden koniec a každý uzol dosiahnuteľný zo začiatku.
 */
export function sanitizeDraft(input: unknown): ProcessDraft {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const warnings: string[] = (Array.isArray(raw['warnings']) ? raw['warnings'] : [])
    .map((item: unknown) => clean(item, 300)).filter(Boolean).slice(0, DRAFT_LIMITS.warnings);

  const used = new Set<string>();
  const nodes: DraftNode[] = [];
  const idMap = new Map<string, string>();
  for (const [index, item] of (Array.isArray(raw['nodes']) ? raw['nodes'] : []).slice(0, DRAFT_LIMITS.nodes).entries()) {
    if (!item || typeof item !== 'object') continue;
    const type: DraftNodeType = TYPES.includes(item.type) ? item.type : 'task';
    let name = clean(item.name, DRAFT_LIMITS.nodeName);
    if (!name && type === 'task') continue;
    if (!name) name = type === 'start' ? 'Začiatok' : type === 'end' ? 'Koniec' : 'Rozhodnutie';
    const original = clean(item.id, 60) || `n${index + 1}`;
    let id = original.replace(/[^A-Za-z0-9_-]/g, '_') || `n${index + 1}`;
    while (used.has(id)) id = `${id}_${index + 1}`;
    used.add(id);
    if (!idMap.has(original)) idMap.set(original, id);
    const role = clean(item.role, DRAFT_LIMITS.role);
    const description = clean(item.description, DRAFT_LIMITS.description);
    nodes.push({ id, type, name, ...(role ? { role } : {}), ...(description ? { description } : {}) });
  }

  // len jeden začiatok — ďalšie sa zmenia na kroky
  let seenStart = false;
  for (const node of nodes) {
    if (node.type !== 'start') continue;
    if (seenStart) node.type = 'task';
    seenStart = true;
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const flowKeys = new Set<string>();
  const flows: DraftFlow[] = [];
  for (const item of (Array.isArray(raw['flows']) ? raw['flows'] : []).slice(0, DRAFT_LIMITS.flows)) {
    if (!item || typeof item !== 'object') continue;
    const from = idMap.get(clean(item.from, 60)) ?? clean(item.from, 60);
    const to = idMap.get(clean(item.to, 60)) ?? clean(item.to, 60);
    if (!byId.has(from) || !byId.has(to) || from === to) continue;
    if (byId.get(from)!.type === 'end' || byId.get(to)!.type === 'start') continue;
    const key = `${from}>${to}`;
    if (flowKeys.has(key)) continue;
    flowKeys.add(key);
    const label = clean(item.label, 60);
    flows.push({ from, to, ...(label ? { label } : {}) });
  }

  const draft: ProcessDraft = {
    name: clean(raw['name'], DRAFT_LIMITS.name) || 'Nový proces',
    purpose: clean(raw['purpose'], DRAFT_LIMITS.text),
    trigger: clean(raw['trigger'], DRAFT_LIMITS.text),
    outcome: clean(raw['outcome'], DRAFT_LIMITS.text),
    roles: [],
    nodes,
    flows,
    warnings
  };
  connectGraph(draft);
  draft.roles = uniqueNames([
    ...(Array.isArray(raw['roles']) ? raw['roles'] : []).map((item: unknown) => clean(item, DRAFT_LIMITS.role)),
    ...draft.nodes.flatMap((node) => node.role ?? [])
  ].filter(Boolean)).slice(0, DRAFT_LIMITS.roles);
  return draft;
}

/** Doplní začiatok, koniec a spojenia, aby bol graf súvislý (mení draft). */
function connectGraph(draft: ProcessDraft): void {
  const { nodes, flows } = draft;
  const has = (from: string, to: string) => flows.some((flow) => flow.from === from && flow.to === to);
  const incoming = (id: string) => flows.filter((flow) => flow.to === id).length;
  const outgoing = (id: string) => flows.filter((flow) => flow.from === id).length;

  let start = nodes.find((node) => node.type === 'start');
  if (!start) {
    start = { id: uniqueId(nodes, 'start'), type: 'start', name: draft.trigger || 'Začiatok' };
    const first = nodes.find((node) => node.type !== 'end' && incoming(node.id) === 0) ?? nodes.find((node) => node.type !== 'end');
    nodes.unshift(start);
    if (first) flows.push({ from: start.id, to: first.id });
  }

  // nedosiahnuteľné uzly napojiť na predchádzajúci uzol v poradí
  for (let guard = 0; guard < nodes.length; guard++) {
    const reachable = reachableFrom(start.id, flows);
    const orphan = nodes.find((node) => !reachable.has(node.id));
    if (!orphan) break;
    const index = nodes.indexOf(orphan);
    const previous = [...nodes.slice(0, index)].reverse().find((node) => reachable.has(node.id) && node.type !== 'end') ?? start;
    if (!has(previous.id, orphan.id)) flows.push({ from: previous.id, to: orphan.id });
  }

  let ends = nodes.filter((node) => node.type === 'end');
  if (ends.length === 0) {
    const end: DraftNode = { id: uniqueId(nodes, 'end'), type: 'end', name: draft.outcome || 'Koniec' };
    nodes.push(end);
    ends = [end];
  }
  // uzly bez pokračovania vedú do konca
  for (const node of nodes) {
    if (node.type === 'end' || outgoing(node.id) > 0) continue;
    flows.push({ from: node.id, to: ends[ends.length - 1].id });
  }
}

function uniqueId(nodes: DraftNode[], base: string): string {
  let id = base;
  for (let index = 2; nodes.some((node) => node.id === id); index++) id = `${base}_${index}`;
  return id;
}

export function reachableFrom(startId: string, flows: DraftFlow[]): Set<string> {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const flow of flows) {
      if (flow.from === current && !seen.has(flow.to)) {
        seen.add(flow.to);
        queue.push(flow.to);
      }
    }
  }
  return seen;
}

/**
 * Kroky pre kartu procesu v poradí grafu (do šírky od začiatku). Rozhodnutie
 * je krok „Rozhodnutie: …?“ s vetvami v popise.
 */
export function draftSteps(draft: ProcessDraft): DraftStep[] {
  const byId = new Map(draft.nodes.map((node) => [node.id, node]));
  const start = draft.nodes.find((node) => node.type === 'start');
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = start ? [start.id] : draft.nodes.map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const flow of draft.flows) if (flow.from === id && !seen.has(flow.to)) queue.push(flow.to);
  }
  for (const node of draft.nodes) if (!seen.has(node.id)) order.push(node.id);

  return order.map((id) => byId.get(id)!).filter((node) => node.type === 'task' || node.type === 'gateway').map((node) => {
    if (node.type === 'task') return { nodeId: node.id, title: node.name, description: node.description ?? '', role: node.role ?? null };
    const branches = draft.flows.filter((flow) => flow.from === node.id).map((flow) => {
      const target = byId.get(flow.to);
      const where = target?.type === 'end' ? 'koniec procesu' : target?.name ?? '';
      return flow.label ? `${flow.label}: ${where}` : where;
    });
    const question = /\?$/.test(node.name) ? node.name : `${node.name}?`;
    return {
      nodeId: node.id,
      title: `Rozhodnutie: ${question}`,
      description: [node.description ?? '', branches.length ? `Vetvy — ${branches.join('; ')}` : ''].filter(Boolean).join(' '),
      role: node.role ?? null
    };
  });
}
