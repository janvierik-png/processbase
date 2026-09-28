/**
 * Pomocne funkcie pre stromy (zlozky, nadriadenost miest) — #12.
 * Poradie surodencov zostava tak, ako prislo z API.
 */

export interface TreeRow<T> {
  item: T;
  depth: number;
}

/**
 * Strom do plocheho zoznamu s hlbkou (pre odsadenie). Polozka s neznamym
 * rodicom sa berie ako korenova; pripadny cyklus v datach sa neopakuje donekonecna.
 */
export function flattenTree<T extends { id: string }>(items: T[], parentOf: (item: T) => string | null): TreeRow<T>[] {
  const ids = new Set(items.map((item) => item.id));
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const parent = parentOf(item);
    const key = parent && ids.has(parent) ? parent : null;
    children.set(key, [...(children.get(key) ?? []), item]);
  }

  const rows: TreeRow<T>[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const item of children.get(parent) ?? []) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      rows.push({ item, depth });
      walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Id uzla a vsetkych jeho potomkov — tie nemozu byt jeho rodicom. */
export function subtreeIds<T extends { id: string }>(items: T[], parentOf: (item: T) => string | null, rootId: string): Set<string> {
  const result = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const item of items) {
      const parent = parentOf(item);
      if (parent && result.has(parent) && !result.has(item.id)) {
        result.add(item.id);
        grew = true;
      }
    }
  }
  return result;
}
