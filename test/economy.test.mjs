// 积分和提示收费 —— 纯逻辑，不打 API
import { test } from "node:test";
import assert from "node:assert/strict";
const { newPlayer, awardSolve, hintQuote, issueAdTicket, chargeHint } = await import("../economy.js");

const econ = { pointsPerSolve: 1, hintCost: 1, freeHints: 1, adMinMs: 5000, adMaxMs: 600000 };
const puzzle = { hints: ["第一条", "第二条"] };
const fresh = () => ({ session: { hintsUsed: 0 }, player: newPlayer(0) });

test("第一次解开 +1，重玩同一道不加分", () => {
  const p = newPlayer(0);
  assert.equal(awardSolve(p, "a", econ), 1);
  assert.equal(awardSolve(p, "a", econ), 0);
  assert.equal(awardSolve(p, "b", econ), 1);
  assert.equal(p.points, 2);
});

test("第一条提示免费，不扣分", () => {
  const { session, player } = fresh();
  const r = chargeHint({ session, puzzle, player, econ });
  assert.equal(r.ok, true); assert.equal(r.method, "free"); assert.equal(r.hint, "第一条");
  assert.equal(player.points, 0);
});

test("第二条没说怎么付 → 402，什么都不变", () => {
  const { session, player } = fresh(); session.hintsUsed = 1;
  const r = chargeHint({ session, puzzle, player, econ });
  assert.equal(r.status, 402); assert.equal(session.hintsUsed, 1);
});

test("第二条用积分：够就扣，不够就 402 且不扣", () => {
  const { session, player } = fresh(); session.hintsUsed = 1;
  assert.equal(chargeHint({ session, puzzle, player, pay: "points", econ }).error, "not_enough_points");
  player.points = 3;
  const r = chargeHint({ session, puzzle, player, pay: "points", econ });
  assert.equal(r.ok, true); assert.equal(r.hint, "第二条"); assert.equal(player.points, 2);
});

test("第二条看广告：票据过 5 秒才认，只能用一次", () => {
  const { session, player } = fresh(); session.hintsUsed = 1;
  const t = issueAdTicket(session, 1000);
  assert.equal(chargeHint({ session, puzzle, player, pay: "ad", ticket: t, now: 3000, econ }).error, "ad_not_finished");
  const ok = chargeHint({ session, puzzle, player, pay: "ad", ticket: t, now: 7000, econ });
  assert.equal(ok.ok, true); assert.equal(ok.method, "ad");
  assert.deepEqual(session.hintPays, ["ad"]);
});

test("没有票据、票据对不上、票据重用 → 都被拒", () => {
  const { session, player } = fresh(); session.hintsUsed = 1;
  assert.equal(chargeHint({ session, puzzle, player, pay: "ad", econ, now: 9e9 }).error, "ad_ticket_invalid");
  issueAdTicket(session, 0);
  assert.equal(chargeHint({ session, puzzle, player, pay: "ad", ticket: "fake", econ, now: 6000 }).error, "ad_ticket_invalid");
  const p3 = { hints: ["一", "二", "三"] };
  const t = issueAdTicket(session, 0);
  assert.equal(chargeHint({ session, puzzle: p3, player, pay: "ad", ticket: t, econ, now: 6000 }).ok, true);
  // 同一张票据想再换第三条
  assert.equal(chargeHint({ session, puzzle: p3, player, pay: "ad", ticket: t, econ, now: 7000 }).error, "ad_ticket_invalid");
});

test("票据太旧（超过 10 分钟）→ 拒", () => {
  const { session, player } = fresh(); session.hintsUsed = 1;
  const t = issueAdTicket(session, 0);
  assert.equal(chargeHint({ session, puzzle, player, pay: "ad", ticket: t, econ, now: 700000 }).error, "ad_ticket_expired");
});

test("提示用完 → 409", () => {
  const { session, player } = fresh(); session.hintsUsed = 2; player.points = 5;
  assert.equal(chargeHint({ session, puzzle, player, pay: "points", econ }).status, 409);
  assert.equal(player.points, 5);
});

test("hintQuote 告诉前端下一条要多少", () => {
  const { session, player } = fresh();
  assert.deepEqual(hintQuote(session, puzzle, player, econ), { index: 0, total: 2, exhausted: false, free: true, cost: 0, points: 0, canAfford: true });
  session.hintsUsed = 1;
  assert.equal(hintQuote(session, puzzle, player, econ).canAfford, false);
  player.points = 1;
  assert.equal(hintQuote(session, puzzle, player, econ).canAfford, true);
});
