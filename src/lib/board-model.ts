// 收藏页（书签 / GitHub Star）在前端使用的数据结构，以及批量移动、撤销用到的纯函数

export type BoardKind = "bookmark" | "github";

export type BoardItem = {
  id: string;
  groupId: string | null;
  title: string;
  canonicalTitle?: string;
  href: string;
  description: string;
  note: string;
  tags: string[];
  isPublic: boolean;
  iconUrl?: string | null;
  language?: string | null;
  updatedAt?: string | null;
};

export type BoardGroup = {
  id: string;
  name: string;
  isPublic: boolean;
  items: BoardItem[];
};

// from / to 是前端分组 id，未分组的 Star 用 UNGROUPED_ID
export type ItemMove = { itemId: string; from: string; to: string };

export const UNGROUPED_ID = "ungrouped";

export function databaseGroupId(groupId: string) {
  return groupId === UNGROUPED_ID ? null : groupId;
}

// 按 moves 的顺序把条目追加到目标分组末尾
export function applyItemMoves(groups: BoardGroup[], moves: ItemMove[]) {
  const targets = new Map(moves.map((move) => [move.itemId, move.to]));
  const moving = new Map<string, BoardItem>();
  for (const group of groups) {
    for (const item of group.items) if (targets.has(item.id)) moving.set(item.id, item);
  }
  return groups.map((group) => {
    const kept = group.items.filter((item) => !targets.has(item.id));
    const incoming = moves.flatMap((move) => {
      const item = move.to === group.id ? moving.get(move.itemId) : undefined;
      return item ? [{ ...item, groupId: databaseGroupId(group.id) }] : [];
    });
    return kept.length === group.items.length && !incoming.length ? group : { ...group, items: [...kept, ...incoming] };
  });
}

// 记录来源分组移动前的顺序，撤销时按原位置放回
export function sourceOrders(groups: BoardGroup[], moves: ItemMove[]) {
  const sources = new Set(moves.map((move) => move.from));
  return Object.fromEntries(groups.filter((group) => sources.has(group.id)).map((group) => [group.id, group.items.map((item) => item.id)]));
}

// 撤销：条目回到原分组并恢复原顺序；之后才加入该分组的条目排在后面
export function revertItemMoves(groups: BoardGroup[], moves: ItemMove[], orders: Record<string, string[]>) {
  const reverted = applyItemMoves(groups, moves.map((move) => ({ itemId: move.itemId, from: move.to, to: move.from })));
  return reverted.map((group) => {
    const order = orders[group.id];
    if (!order) return group;
    const rank = new Map(order.map((id, index) => [id, index]));
    const items = group.items
      .map((item, index) => ({ item, rank: rank.get(item.id) ?? order.length + index }))
      .sort((left, right) => left.rank - right.rank)
      .map(({ item }) => item);
    return { ...group, items };
  });
}

// 每个目标分组一次请求：把条目移进该分组，并按最终顺序保存该分组的排序
export function moveRequests(kind: BoardKind, nextGroups: BoardGroup[], moves: ItemMove[]) {
  const byTarget = new Map<string, string[]>();
  for (const move of moves) byTarget.set(move.to, [...(byTarget.get(move.to) ?? []), move.itemId]);
  return [...byTarget].map(([target, itemIds]) => {
    const groupId = databaseGroupId(target);
    const ids = nextGroups.find((group) => group.id === target)?.items.map((item) => item.id) ?? itemIds;
    return { target, body: { entity: "move" as const, kind, itemIds, groupId, orders: [{ groupId, ids }] } };
  });
}
