// 积分和提示的规则。纯函数，不碰存储，方便测试。
//
// - 第一次解开某道题 +1 分。重玩同一道（比如点分享链接）不再给分，不然可以无限刷。
// - 每道题前 FREE_HINTS 条提示免费，之后每条要么看一段激励广告，要么花 HINT_COST 分。
// - 积分只能换提示，不能买、不能提现——这也是 Google 对激励广告奖励的要求。

import crypto from "node:crypto";

const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

export const ECON = {
  pointsPerSolve: num(process.env.POINTS_PER_SOLVE, 1),
  hintCost: num(process.env.HINT_COST, 1),
  freeHints: num(process.env.FREE_HINTS, 1),
  // 网页激励广告没有服务端验证，「看完了」是浏览器说的。
  // 至少隔这么久才认票据，挡住直接调接口跳过广告的脚本。
  adMinMs: num(process.env.AD_MIN_SECONDS, 5) * 1000,
  adMaxMs: 10 * 60 * 1000
};

export function newPlayer(now = Date.now()) {
  return { points: 0, solved: [], created: now };
}

// 通关加分。返回这次加了几分（重解同一道题是 0）。
export function awardSolve(player, puzzleId, econ = ECON) {
  if (!player.solved.includes(puzzleId)) {
    player.solved.push(puzzleId);
    player.points += econ.pointsPerSolve;
    return econ.pointsPerSolve;
  }
  return 0;
}

// 下一条提示要多少钱，给前端画按钮用
export function hintQuote(session, puzzle, player, econ = ECON) {
  const index = session.hintsUsed;
  const total = puzzle.hints.length;
  const free = index < econ.freeHints;
  return {
    index, total,
    exhausted: index >= total,
    free,
    cost: free ? 0 : econ.hintCost,
    points: player?.points ?? 0,
    canAfford: free || (player?.points ?? 0) >= econ.hintCost
  };
}

export function issueAdTicket(session, now = Date.now()) {
  const id = crypto.randomUUID();
  session.adTicket = { id, at: now, used: false, forHint: session.hintsUsed };
  return id;
}

// 取下一条提示。成功时会改 session.hintsUsed 和 player.points，失败什么都不改。
export function chargeHint({ session, puzzle, player, pay, ticket, now = Date.now(), econ = ECON }) {
  const q = hintQuote(session, puzzle, player, econ);
  if (q.exhausted) return { ok: false, status: 409, error: "no_more_hints" };

  let method;
  if (q.free) {
    method = "free";
  } else if (pay === "points") {
    if (player.points < econ.hintCost) return { ok: false, status: 402, error: "not_enough_points", cost: econ.hintCost };
    player.points -= econ.hintCost;
    method = "points";
  } else if (pay === "ad") {
    const t = session.adTicket;
    if (!t || !ticket || t.id !== ticket || t.used || t.forHint !== session.hintsUsed) {
      return { ok: false, status: 403, error: "ad_ticket_invalid" };
    }
    const age = now - t.at;
    if (age < econ.adMinMs) return { ok: false, status: 425, error: "ad_not_finished" };
    if (age > econ.adMaxMs) return { ok: false, status: 403, error: "ad_ticket_expired" };
    t.used = true;
    method = "ad";
  } else {
    return { ok: false, status: 402, error: "payment_required", cost: econ.hintCost };
  }

  const hint = puzzle.hints[session.hintsUsed];
  session.hintsUsed += 1;
  (session.hintPays ||= []).push(method);
  return { ok: true, hint, method };
}
