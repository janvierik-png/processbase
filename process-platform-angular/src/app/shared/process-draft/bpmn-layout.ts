import { DraftNode, ProcessDraft, foldName } from './draft';

/**
 * #42 — BPMN 2.0 XML s diagramom (DI) z návrhu procesu. Kroky sú v stĺpcoch
 * podľa poradia (najdlhšia cesta od začiatku), každá rola má vlastnú dráhu
 * (lane) v jednom bazéne. Bez rolí je diagram bez bazéna. Výsledok sa dá
 * otvoriť v bpmn-js a ďalej upravovať.
 */

const SIZE: Record<DraftNode['type'], { w: number; h: number }> = {
  start: { w: 36, h: 36 },
  end: { w: 36, h: 36 },
  gateway: { w: 50, h: 50 },
  task: { w: 100, h: 80 }
};
const COL = 170;
const ROW = 110;
const POOL_X = 120;
const POOL_Y = 80;
const POOL_LABEL = 30;
const LANE_PAD = 15;
const NO_ROLE = 'Bez určenia';

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type Box = { x: number; y: number; w: number; h: number; cx: number; cy: number };

export function draftToBpmnXml(draft: ProcessDraft): string {
  const nodes = draft.nodes;
  const flows = draft.flows.filter((flow) => nodes.some((node) => node.id === flow.from) && nodes.some((node) => node.id === flow.to));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = (id: string) => flows.filter((flow) => flow.from === id);
  const incoming = (id: string) => flows.filter((flow) => flow.to === id);

  // --- spätné hrany (cykly) mimo výpočtu poradia ---
  const back = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const start = nodes.find((node) => node.type === 'start') ?? nodes[0];
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const flow of outgoing(id)) {
      const target = state.get(flow.to);
      if (target === 'open') back.add(`${flow.from}>${flow.to}`);
      else if (!target) visit(flow.to);
    }
    state.set(id, 'done');
  };
  if (start) visit(start.id);
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);
  const forward = flows.filter((flow) => !back.has(`${flow.from}>${flow.to}`));

  // --- stĺpec = najdlhšia cesta od začiatku ---
  const rank = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const flow of forward) indegree.set(flow.to, (indegree.get(flow.to) ?? 0) + 1);
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const flow of forward.filter((item) => item.from === id)) {
      rank.set(flow.to, Math.max(rank.get(flow.to) ?? 0, (rank.get(id) ?? 0) + 1));
      indegree.set(flow.to, (indegree.get(flow.to) ?? 0) - 1);
      if (indegree.get(flow.to) === 0) queue.push(flow.to);
    }
  }
  // konce úplne vpravo, ak by boli skôr ako posledný krok vetvy
  const maxRank = Math.max(0, ...rank.values());

  // --- dráhy podľa rolí ---
  const hasRoles = nodes.some((node) => node.type === 'task' && node.role);
  const laneOf = new Map<string, string>();
  if (hasRoles) {
    const canonical = new Map<string, string>();
    const roleName = (role: string) => {
      const key = foldName(role);
      if (!canonical.has(key)) canonical.set(key, role);
      return canonical.get(key)!;
    };
    for (const node of nodes) if (node.role) laneOf.set(node.id, roleName(node.role));
    // udalosti a rozhodnutia bez roly idú do dráhy suseda
    for (let pass = 0; pass < 3; pass++) {
      for (const node of nodes) {
        if (laneOf.has(node.id)) continue;
        const neighbour = node.type === 'start'
          ? outgoing(node.id).map((flow) => laneOf.get(flow.to)).find(Boolean)
          : incoming(node.id).map((flow) => laneOf.get(flow.from)).find(Boolean) ?? outgoing(node.id).map((flow) => laneOf.get(flow.to)).find(Boolean);
        if (neighbour) laneOf.set(node.id, neighbour);
      }
    }
    for (const node of nodes) if (!laneOf.has(node.id)) laneOf.set(node.id, NO_ROLE);
  }
  const lanes = hasRoles ? [...new Set(nodes.map((node) => laneOf.get(node.id)!))] : [''];
  const laneKey = (id: string) => (hasRoles ? laneOf.get(id)! : '');

  // --- riadky v rámci dráhy pri viacerých uzloch v jednom stĺpci ---
  const slot = new Map<string, number>();
  const stack = new Map<string, number>();
  for (const node of [...nodes].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)) {
    const key = `${laneKey(node.id)}|${rank.get(node.id)}`;
    const index = stack.get(key) ?? 0;
    slot.set(node.id, index);
    stack.set(key, index + 1);
  }
  const laneRows = new Map(lanes.map((lane) => [lane, Math.max(1, ...[...stack].filter(([key]) => key.startsWith(`${lane}|`)).map(([, count]) => count))]));
  const laneTop = new Map<string, number>();
  let y = POOL_Y;
  for (const lane of lanes) {
    laneTop.set(lane, y);
    y += laneRows.get(lane)! * ROW + 2 * LANE_PAD;
  }
  const poolHeight = y - POOL_Y;
  const firstX = hasRoles ? POOL_X + POOL_LABEL * 2 + 70 : 180;
  const poolWidth = firstX - POOL_X + maxRank * COL + 120;

  const box = new Map<string, Box>();
  for (const node of nodes) {
    const size = SIZE[node.type];
    const cx = firstX + rank.get(node.id)! * COL;
    const cy = laneTop.get(laneKey(node.id))! + LANE_PAD + ROW / 2 + slot.get(node.id)! * ROW;
    box.set(node.id, { x: Math.round(cx - size.w / 2), y: Math.round(cy - size.h / 2), w: size.w, h: size.h, cx, cy });
  }

  // --- ID pre BPMN (NCName) ---
  const counters: Record<string, number> = {};
  const prefix: Record<DraftNode['type'], string> = { start: 'StartEvent', end: 'EndEvent', gateway: 'Gateway', task: 'Activity' };
  const bpmnId = new Map(nodes.map((node) => {
    counters[node.type] = (counters[node.type] ?? 0) + 1;
    return [node.id, `${prefix[node.type]}_${counters[node.type]}`];
  }));
  const flowId = flows.map((_, index) => `Flow_${index + 1}`);
  const processId = 'Process_1';

  // --- procesné prvky ---
  const elements = nodes.map((node) => {
    const id = bpmnId.get(node.id)!;
    const tag = { start: 'startEvent', end: 'endEvent', gateway: 'exclusiveGateway', task: 'task' }[node.type];
    const refs = [
      ...incoming(node.id).map((flow) => `      <bpmn:incoming>${flowId[flows.indexOf(flow)]}</bpmn:incoming>`),
      ...outgoing(node.id).map((flow) => `      <bpmn:outgoing>${flowId[flows.indexOf(flow)]}</bpmn:outgoing>`)
    ];
    const doc = node.description ? [`      <bpmn:documentation>${xml(node.description)}</bpmn:documentation>`] : [];
    return [`    <bpmn:${tag} id="${id}" name="${xml(node.name)}">`, ...doc, ...refs, `    </bpmn:${tag}>`].join('\n');
  });
  const sequence = flows.map((flow, index) =>
    `    <bpmn:sequenceFlow id="${flowId[index]}"${flow.label ? ` name="${xml(flow.label)}"` : ''} sourceRef="${bpmnId.get(flow.from)}" targetRef="${bpmnId.get(flow.to)}" />`);
  const laneSet = hasRoles
    ? [
        '    <bpmn:laneSet id="LaneSet_1">',
        ...lanes.map((lane, index) => [
          `      <bpmn:lane id="Lane_${index + 1}" name="${xml(lane)}">`,
          ...nodes.filter((node) => laneOf.get(node.id) === lane).map((node) => `        <bpmn:flowNodeRef>${bpmnId.get(node.id)}</bpmn:flowNodeRef>`),
          '      </bpmn:lane>'
        ].join('\n')),
        '    </bpmn:laneSet>'
      ]
    : [];

  // --- diagram ---
  const shapes: string[] = [];
  if (hasRoles) {
    shapes.push(`      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true">\n        <dc:Bounds x="${POOL_X}" y="${POOL_Y}" width="${poolWidth}" height="${poolHeight}" />\n      </bpmndi:BPMNShape>`);
    lanes.forEach((lane, index) => {
      const top = laneTop.get(lane)!;
      const height = laneRows.get(lane)! * ROW + 2 * LANE_PAD;
      shapes.push(`      <bpmndi:BPMNShape id="Lane_${index + 1}_di" bpmnElement="Lane_${index + 1}" isHorizontal="true">\n        <dc:Bounds x="${POOL_X + POOL_LABEL}" y="${top}" width="${poolWidth - POOL_LABEL}" height="${height}" />\n      </bpmndi:BPMNShape>`);
    });
  }
  for (const node of nodes) {
    const b = box.get(node.id)!;
    const marker = node.type === 'gateway' ? ' isMarkerVisible="true"' : '';
    const label = node.type === 'task'
      ? ''
      : `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${Math.round(b.cx - 50)}" y="${b.y + b.h + 5}" width="100" height="27" />\n        </bpmndi:BPMNLabel>`;
    shapes.push(`      <bpmndi:BPMNShape id="${bpmnId.get(node.id)}_di" bpmnElement="${bpmnId.get(node.id)}"${marker}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />${label}\n      </bpmndi:BPMNShape>`);
  }
  const bottom = POOL_Y + poolHeight;
  const edges = flows.map((flow, index) => {
    const s = box.get(flow.from)!;
    const t = box.get(flow.to)!;
    let points: Array<[number, number]>;
    if (back.has(`${flow.from}>${flow.to}`) || rank.get(flow.to)! <= rank.get(flow.from)!) {
      // späť: pod dráhami a naspäť ku kroku zdola
      const below = bottom - 8 - (index % 3) * 4;
      points = [[s.cx, s.y + s.h], [s.cx, below], [t.cx, below], [t.cx, t.y + t.h]];
    } else if (Math.abs(s.cy - t.cy) < 1) {
      points = [[s.x + s.w, s.cy], [t.x, t.cy]];
    } else if (byId.get(flow.from)?.type === 'gateway') {
      // z rozhodnutia hore alebo dole a potom vodorovne
      points = t.cy < s.cy ? [[s.cx, s.y], [s.cx, t.cy], [t.x, t.cy]] : [[s.cx, s.y + s.h], [s.cx, t.cy], [t.x, t.cy]];
    } else {
      const mid = Math.round(s.x + s.w + (t.x - s.x - s.w) / 2);
      points = [[s.x + s.w, s.cy], [mid, s.cy], [mid, t.cy], [t.x, t.cy]];
    }
    const waypoints = points.map(([px, py]) => `        <di:waypoint x="${Math.round(px)}" y="${Math.round(py)}" />`).join('\n');
    const label = flow.label
      ? `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${Math.round(points[0][0] + 6)}" y="${Math.round(points[0][1] - 18)}" width="40" height="14" />\n        </bpmndi:BPMNLabel>`
      : '';
    return `      <bpmndi:BPMNEdge id="${flowId[index]}_di" bpmnElement="${flowId[index]}">\n${waypoints}${label}\n      </bpmndi:BPMNEdge>`;
  });

  const collaboration = hasRoles
    ? `  <bpmn:collaboration id="Collaboration_1">\n    <bpmn:participant id="Participant_1" name="${xml(draft.name)}" processRef="${processId}" />\n  </bpmn:collaboration>\n`
    : '';
  const planeElement = hasRoles ? 'Collaboration_1' : processId;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Processbase" exporterVersion="1.0">
${collaboration}  <bpmn:process id="${processId}" name="${xml(draft.name)}" isExecutable="false">
${[...laneSet, ...elements, ...sequence].join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${planeElement}">
${[...shapes, ...edges].join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
