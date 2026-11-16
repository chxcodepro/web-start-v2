import assert from "node:assert/strict";
import { test } from "node:test";
import { applyItemMoves, insertGroups, moveRequests, revertItemMoves, sourceOrders } from "../src/lib/board-model.ts";

const item = (id, groupId) => ({ id, groupId, title: id, href: `https://example.com/${id}`, description: "", note: "", tags: [], isPublic: true });
const group = (id, ids) => ({ id, name: id, isPublic: true, items: ids.map((value) => item(value, id === "ungrouped" ? null : id)) });
const ids = (groups) => Object.fromEntries(groups.map((entry) => [entry.id, entry.items.map((value) => value.id)]));

const board = () => [group("tools", ["a", "b"]), group("docs", ["c"]), group("ungrouped", ["x", "y", "z"])];

test("moves append to the target group in move order", () => {
  const moves = [{ itemId: "z", from: "ungrouped", to: "tools" }, { itemId: "x", from: "ungrouped", to: "tools" }, { itemId: "a", from: "tools", to: "docs" }];
  const next = applyItemMoves(board(), moves);
  assert.deepEqual(ids(next), { tools: ["b", "z", "x"], docs: ["c", "a"], ungrouped: ["y"] });
  assert.equal(next[0].items[1].groupId, "tools");
  assert.equal(applyItemMoves(next, [{ itemId: "b", from: "tools", to: "ungrouped" }])[2].items.at(-1).groupId, null);
});

test("undo restores original groups and positions", () => {
  const before = board();
  const moves = [{ itemId: "x", from: "ungrouped", to: "tools" }, { itemId: "z", from: "ungrouped", to: "docs" }];
  const orders = sourceOrders(before, moves);
  assert.deepEqual(orders, { ungrouped: ["x", "y", "z"] });
  const after = applyItemMoves(before, moves);
  assert.deepEqual(ids(revertItemMoves(after, moves, orders)), ids(before));
  // 只撤销成功的那部分
  assert.deepEqual(ids(revertItemMoves(after, moves.slice(0, 1), orders)), { tools: ["a", "b"], docs: ["c", "z"], ungrouped: ["x", "y"] });
});

test("new groups go before the ungrouped bucket", () => {
  assert.deepEqual(insertGroups(board(), [group("ai", [])]).map((entry) => entry.id), ["tools", "docs", "ai", "ungrouped"]);
  assert.deepEqual(insertGroups([group("daily", [])], [group("ai", [])]).map((entry) => entry.id), ["daily", "ai"]);
});

test("one move request per target saves the final order", () => {
  const moves = [{ itemId: "x", from: "ungrouped", to: "tools" }, { itemId: "a", from: "tools", to: "ungrouped" }];
  const requests = moveRequests("github", applyItemMoves(board(), moves), moves);
  assert.deepEqual(requests, [
    { target: "tools", body: { entity: "move", kind: "github", itemIds: ["x"], groupId: "tools", orders: [{ groupId: "tools", ids: ["b", "x"] }] } },
    { target: "ungrouped", body: { entity: "move", kind: "github", itemIds: ["a"], groupId: null, orders: [{ groupId: null, ids: ["y", "z", "a"] }] } }
  ]);
});
