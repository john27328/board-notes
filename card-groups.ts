import type { Card } from "./types";

export interface CardGroupNode {
  card: Card;
  visible: boolean;
  group: boolean;
  children: CardGroupNode[];
}

/** Build column-local groups, keeping ancestor labels even across columns/filters. */
export function groupCards(
  cards: Card[],
  allCards: Card[],
  targetsOf: (card: Card) => string[],
  compare: (left: Card, right: Card) => number
): CardGroupNode[] {
  const byPath = new Map(allCards.map((card) => [card.file.path, card]));
  const parents = new Map<string, string>();
  for (const card of allCards) {
    const parent = targetsOf(card).find((path) => path !== card.file.path && byPath.has(path));
    if (parent) parents.set(card.file.path, parent);
  }

  // Malformed cyclic links must neither hang the board nor hide cards. Pick one
  // stable root per cycle. Walk iteratively so depth is not limited by the stack.
  const visited = new Set<string>();
  for (const path of byPath.keys()) {
    if (visited.has(path)) continue;
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = path;
    while (current && !visited.has(current) && !positions.has(current)) {
      positions.set(current, chain.length);
      chain.push(current);
      current = parents.get(current);
    }
    if (current && positions.has(current)) {
      const cycle = chain.slice(positions.get(current)!);
      parents.delete(cycle.sort()[0]);
    }
    chain.forEach((item) => visited.add(item));
  }

  const basePaths = new Set(parents.values());
  const visiblePaths = new Set(cards.map((card) => card.file.path));
  const nodes = new Map<string, CardGroupNode>();
  for (const card of cards) {
    let path: string | undefined = card.file.path;
    while (path && !nodes.has(path)) {
      const item = byPath.get(path);
      if (!item) break;
      nodes.set(path, { card: item, visible: visiblePaths.has(path), group: basePaths.has(path), children: [] });
      path = parents.get(path);
    }
  }

  const roots: CardGroupNode[] = [];
  for (const [path, node] of nodes) {
    const parent = nodes.get(parents.get(path) ?? "");
    (parent ? parent.children : roots).push(node);
  }
  const sort = (left: CardGroupNode, right: CardGroupNode) =>
    Number(right.group) - Number(left.group) || compare(left.card, right.card);
  roots.sort(sort);
  for (const node of nodes.values()) node.children.sort(sort);
  return roots;
}
