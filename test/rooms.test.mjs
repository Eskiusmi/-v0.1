// 房间的纯逻辑 —— 不打 API、不开服务器
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY ||= "test";
const { roomView, commitAsk, newGame, cleanName, cleanCode, pickForRoom } = await import("../rooms.js");
const { byId } = await import("../puzzles.js");

const P = byId("yi-zhi-shoutao");          // k2 是核心
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function room() {
  return {
    code: "4821", host: A, played: [P.id],
    members: { [A]: { mid: "m-a", name: "小明", joinedAt: 1 }, [B]: { mid: "m-b", name: "阿花", joinedAt: 2 } },
    game: newGame(P, 0)
  };
}
const out = (verdict, keys = [], extra = {}) => ({ verdict, keys, touched: keys, solved: false, note: "", ...extra });

test("房间视图里没有任何人的 cookie ID", () => {
  const r = room();
  commitAsk(r, { gameId: r.game.id, pid: A, name: "小明", q: "他是买错了吗？", out: out("否"), puzzle: P });
  const json = JSON.stringify(roomView(r, B));
  assert.ok(!json.includes(A) && !json.includes(B));
  assert.ok(json.includes("m-a"));
});

test("没结束时不下发汤底，只下发已揭开的段", () => {
  const r = room();
  commitAsk(r, { gameId: r.game.id, pid: A, name: "小明", q: "他只需要一只吗？", out: out("是", ["k1"]), puzzle: P });
  const v = roomView(r, B);
  assert.equal(v.game.solution, undefined);
  assert.deepEqual(v.game.revealed.map((x) => x.i), [1]);
  assert.ok(!JSON.stringify(v).includes("右手在多年前"));
});

test("「我的」按看的人算：同一条记录，小明看是 mine，阿花看不是", () => {
  const r = room();
  commitAsk(r, { gameId: r.game.id, pid: A, name: "小明", q: "q", out: out("否"), puzzle: P });
  assert.equal(roomView(r, A).game.log[0].mine, true);
  assert.equal(roomView(r, B).game.log[0].mine, false);
  assert.equal(roomView(r, B).game.log[0].who, "m-a");
});

test("两个人同时问：都基于同一个快照裁定，写入时都保留，关键点合并", () => {
  const r = room();
  const gid = r.game.id;
  // 两个裁定都是在 hit=[] 时做的
  commitAsk(r, { gameId: gid, pid: A, name: "小明", q: "只需要一只吗？", out: out("是", ["k1"]), puzzle: P });
  commitAsk(r, { gameId: gid, pid: B, name: "阿花", q: "店员认识他吗？", out: out("是", ["k3"]), puzzle: P });
  assert.equal(r.game.history.length, 2);
  assert.deepEqual(r.game.hit.sort(), ["k1", "k3"]);
  assert.equal(r.game.log.length, 2);
});

test("同一个关键点两人同时问中，只算一次", () => {
  const r = room();
  commitAsk(r, { gameId: r.game.id, pid: A, name: "小明", q: "a", out: out("是", ["k1"]), puzzle: P });
  const x = commitAsk(r, { gameId: r.game.id, pid: B, name: "阿花", q: "b", out: out("是", ["k1"]), puzzle: P });
  assert.deepEqual(r.game.hit, ["k1"]);
  assert.equal(x.gained, 0);
});

test("两人同时说中答案：先写入的那个人算解开，另一个不再触发", () => {
  const r = room();
  const a = commitAsk(r, { gameId: r.game.id, pid: A, name: "小明", q: "只有一只手？", out: out("是", ["k2"], { solved: true }), puzzle: P });
  const b = commitAsk(r, { gameId: r.game.id, pid: B, name: "阿花", q: "失去一只手？", out: out("是", ["k2"], { solved: true }), puzzle: P });
  assert.equal(a.solvedNow, true); assert.equal(b.solvedNow, false);
  assert.equal(r.game.solvedByName, "小明");
  assert.equal(roomView(r, B).game.solvedByMe, false);
  assert.equal(roomView(r, A).game.solvedByMe, true);
  assert.ok(roomView(r, B).game.solution);
});

test("裁定回来时房主已经换了题 → 丢弃，不写进新题", () => {
  const r = room();
  const old = r.game.id;
  r.game = newGame(byId("tangge"));
  assert.equal(commitAsk(r, { gameId: old, pid: A, name: "小明", q: "q", out: out("是", ["k1"]), puzzle: P }).stale, true);
  assert.equal(r.game.log.length, 0);
});

test("换个问法、降级：只进记录，不算提问数", () => {
  const r = room();
  commitAsk(r, { gameId: r.game.id, pid: A, name: "小明", q: "为什么？", out: out("换个问法"), puzzle: P });
  commitAsk(r, { gameId: r.game.id, pid: A, name: "小明", q: "q", out: out("无关", [], { degraded: true, busy: true }), puzzle: P });
  assert.equal(r.game.history.length, 0);
  assert.equal(roomView(r, A).game.log[1].busy, true);
});

test("昵称和房间号清洗", () => {
  assert.equal(cleanName("  小明<script>  "), "小明script");
  assert.equal(cleanName("一二三四五六七八九十十一十二十三"), "一二三四五六七八九十十一");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanCode(" 48-21 "), "4821");
  assert.equal(cleanCode("12"), null);
});

test("房间优先出没出过的题", () => {
  const r = room();
  for (let i = 0; i < 20; i++) assert.notEqual(pickForRoom(r).id, P.id);
});
