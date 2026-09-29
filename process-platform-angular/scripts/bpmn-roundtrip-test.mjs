/**
 * Round-trip BPMN XML (#24 FREE-01, scenar 11): nacitanie a opatovne ulozenie
 * diagramu nesmie stratit prvky, nazvy, spojenia, suradnice, dokumentaciu ani
 * rozsirenia inych nastrojov (Camunda aj uplne neznamy namespace).
 *
 *   node scripts/bpmn-roundtrip-test.mjs                       # serializator (bpmn-moddle ako v modeleri)
 *   node scripts/bpmn-roundtrip-test.mjs stiahnuty.bpmn        # porovna aj subor stiahnuty z modelera v prehliadaci
 *
 * Porovnava sa vyznam, nie text XML (poradie atributov a medzery sa smu lisit).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';

const require = createRequire(import.meta.url);
const camunda = require('camunda-bpmn-moddle/resources/camunda.json');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(here, 'fixtures', 'objednavka.bpmn'), 'utf8');

const moddle = new BpmnModdle({ camunda });

/** Vyznamovy odtlacok modelu: kazdy prvok s ID, typom, nazvom, odkazmi a atributmi. */
function fingerprint(root) {
  const items = new Map();

  // odkaz (napr. sourceRef, bpmnElement, flowNodeRef) = len ID, obsiahnuty prvok = rekurzia
  const isReference = (element, key) =>
    element.$descriptor?.properties?.find((property) => property.name === key)?.isReference ?? false;

  // path = kde prvok lezi (najblizsi predok s ID + vlastnost) — kluc pre prvky bez ID
  function walk(element, path) {
    if (element === null || element === undefined || typeof element !== 'object') return element;
    if (Array.isArray(element)) {
      const mapped = element.map((item, index) => walk(item, `${path}[${index}]`));
      // prvky s ID (tvary v diagrame, uzly v drahe) su mnozina — poradie urcuje len vykreslenie;
      // poradie prvkov bez ID (body ciary) sa porovnava presne
      return mapped.every((item) => typeof item === 'string' && item.startsWith('#')) ? [...mapped].sort() : mapped;
    }
    const own = element.id ?? path;
    const out = { $type: element.$type };
    for (const name of Object.keys(element).sort()) {
      const value = element[name];
      if (name === '$attrs') {
        // neznáme atribúty iných nástrojov (deklarácie namespace sa smú zopakovať)
        const attrs = Object.fromEntries(Object.entries(value).filter(([attr]) => !attr.startsWith('xmlns')));
        if (Object.keys(attrs).length) out.$attrs = attrs;
        continue;
      }
      if (name.startsWith('$') && name !== '$body' && name !== '$children') continue;
      if (isReference(element, name)) {
        out[name] = Array.isArray(value) ? value.map((ref) => `#${ref?.id}`).sort() : `#${value?.id}`;
      } else {
        out[name] = walk(value, `${own}.${name}`);
      }
    }
    items.set(own, out);
    return element.id ? `#${element.id}` : out;
  }

  walk(root, '(koren)');
  return items;
}

function diff(expected, actual) {
  const problems = [];
  for (const [id, item] of expected) {
    if (!actual.has(id)) {
      problems.push(`chyba prvok ${id} (${item.$type})`);
      continue;
    }
    const a = JSON.stringify(item);
    const b = JSON.stringify(actual.get(id));
    if (a !== b) problems.push(`zmeneny prvok ${id}:\n      povodne: ${a.slice(0, 300)}\n      teraz:   ${b.slice(0, 300)}`);
  }
  for (const id of actual.keys()) if (!expected.has(id)) problems.push(`navyse prvok ${id}`);
  return problems;
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const original = await moddle.fromXML(fixture);
check('fixture sa nacita bez varovani', original.warnings.length === 0, original.warnings.map((w) => w.message).join('; '));
const expected = fingerprint(original.rootElement);

const { xml: exported } = await moddle.toXML(original.rootElement, { format: true });
const reloaded = await moddle.fromXML(exported);
const problems = diff(expected, fingerprint(reloaded.rootElement));
check('serializator: vyznam zachovany', problems.length === 0, problems.join('\n    '));
check('neznamy prvok ineho nastroja zachovany', exported.includes('vendor:note'));
check('neznamy atribut ineho nastroja zachovany', /vendor:priority="high"/.test(exported));
check('diakritika ostava citatelne v UTF-8', exported.includes('„úvodzovky“') && exported.includes('ľščťžýáíé'));
check('pocet prvkov', expected.size > 40, `${expected.size} prvkov`);

// subor stiahnuty z modelera v prehliadaci (voliteľne)
const downloaded = process.argv[2];
if (downloaded) {
  const fromBrowser = await moddle.fromXML(readFileSync(downloaded, 'utf8'));
  const browserProblems = diff(expected, fingerprint(fromBrowser.rootElement));
  check('modeler v prehliadaci: vyznam zachovany', browserProblems.length === 0, browserProblems.join('\n    '));
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'OK   ' : 'CHYBA'} ${r.name}${r.ok ? '' : `\n    ${r.detail}`}`);
}
console.log(`\n${results.length - failed}/${results.length} prešlo`);
process.exit(failed > 0 ? 1 : 0);
