import express from "express";
import crypto from "node:crypto";
import { PUZZLES, byId, publicView } from "./puzzles.js";
import { loadPool, pickFor, fingerprint, daily, poolSize } from "./pool.js";
import { startTopUp } from "./topup.js";
import { adjudicate, reportAuth } from "./adjudicator.js";
import { revealDiff } from "./reveal.js";
import { openSessionStore, openPlayerStore, openRoomStore } from "./sessions.js";
import { ECON, awardSolve, hintQuote, issueAdTicket, chargeHint } from "./economy.js";
import { createLimiter } from "./limits.js";
import { createPlayers, readPid } from "./players.js";
import { mountRooms } from "./rooms.js";

reportAuth();
await loadPool();          // 把验证通过的生成题并入题库
startTopUp();              // AUTO_GENERATE=1 时后台补货
const sessions = await openSessionStore();   // 一局游戏
const players = createPlayers(await openPlayerStore());   // 积分，见 economy.js / players.js
const rooms = await openRoomStore();                        // 联机房间，见 rooms.js

// 广告配置。ADSENSE_CLIENT 是 AdSense 发布商 ID（ca-pub-开头）。
// ADS_TEST=1：Google 的测试模式，显示模拟广告、不发真实请求。
// ADS_MOCK=1：完全不连 Google，用页面自带的假广告走流程，本地开发用，线上不要开。
const ADS = {
  client: (process.env.ADSENSE_CLIENT || "").trim(),
  test: process.env.ADS_TEST === "1",
  mock: process.env.ADS_MOCK === "1"
};
if (ADS.mock) console.warn("⚠ ADS_MOCK=1：用的是假广告，只能在本地开。");
else if (ADS.client) console.log(`✓ 激励广告：${ADS.client}${ADS.test ? "（测试模式）" : ""}`);
else console.log("· 没设 ADSENSE_CLIENT：第二条提示只能用积分换。");

const app = express();
// Render 在反向代理后面，不设这个拿到的 IP 全是代理的
app.set("trust proxy", 1);
app.use(express.json({ limit: "8kb" }));
app.use(express.static("public"));

app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  });
  next();
});

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// AdSense 要求网站根目录有 ads.txt，声明谁有权卖这个站的广告位
app.get("/ads.txt", (_req, res) => {
  const pub = ADS.client.replace(/^ca-/, "");
  if (!pub) return res.status(404).type("text").send("");
  res.type("text").send(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
});

// 每次提问都要花钱调 Claude API，不限流的话一个脚本几分钟就能刷掉一个月的额度。
// 主要按玩家（cookie 里的 ID）限：20 次之后每 4 秒回一次。
// IP 只做一道很宽的兜底——同一个 Wi-Fi 下一群朋友一起玩，出口 IP 是同一个，不能互相限住。
const playerLimit = createLimiter({ max: 20, refillMs: 4000, keyOf: (req) => readPid(req) || "ip:" + req.ip });
const ipLimit = createLimiter({ max: 150, refillMs: 500, keyOf: (req) => "ip:" + req.ip });

// 积分跟着这局的主人走，不跟着当前请求的 cookie 走——
// 浏览器禁用 cookie 时每个请求都像新玩家，按 session 记更稳。
const ownerOf = (s) => players.get(s.pid);

// 每局结束打一行结构化日志。Render Logs 里 grep "finish" 就能看：
// 哪道题被弃得多、平均几问通关、提示怎么拿的（免费 / 广告 / 积分）。
function logFinish(s, puzzle, outcome, extra = {}) {
  console.log(JSON.stringify({
    event: "finish", outcome, puzzle: puzzle.id, ...extra,
    asked: s.history.length, hits: s.hit.length, totalKeys: puzzle.keys.length,
    hintsUsed: s.hintsUsed, hintPays: s.hintPays || [],
    verdicts: s.history.map((h) => h.verdict).join(""),
    at: new Date().toISOString()
  }));
}

/* ---------------- routes ---------------- */

app.get("/api/config", (_req, res) => {
  res.json({
    ads: { client: ADS.client || null, test: ADS.test, mock: ADS.mock },
    hintCost: ECON.hintCost,
    freeHints: ECON.freeHints,
    adMinSeconds: ECON.adMinMs / 1000,
    pointsPerSolve: ECON.pointsPerSolve
  });
});

app.get("/api/puzzles", (_req, res) => {
  res.json(PUZZLES.map((p) => ({
    id: p.id, broth: p.broth, genre: p.genre, difficulty: p.difficulty
  })));
});

app.post("/api/start", ipLimit, async (req, res) => {
  const { puzzleId, mode } = req.body || {};
  const fp = fingerprint(req);
  const { pid, player } = await players.load(req, res);

  // daily —— 所有人今天同一道，分享才有意义
  // fresh —— 发一道这个玩家没做过的（默认）
  let puzzle, exhausted = false, remaining = null;
  if (mode === "daily" && !puzzleId) {
    puzzle = daily();
  } else {
    const picked = pickFor(fp, puzzleId && byId(puzzleId) ? puzzleId : null);
    // pickFor 走分享链接分支时直接返回题本身
    if (picked.puzzle) ({ puzzle, exhausted, remaining } = picked);
    else puzzle = picked;
  }

  if (await sessions.size() >= 5000) await sessions.evictOldest();
  const sid = crypto.randomUUID();
  const s = { puzzleId: puzzle.id, pid, hit: [], history: [], hintsUsed: 0, hintPays: [], over: false };
  await sessions.set(sid, s);
  res.json({
    sessionId: sid,
    puzzle: publicView(puzzle),
    points: player.points,
    solvedBefore: player.solved.includes(puzzle.id),
    hint: hintQuote(s, puzzle, player),
    // 存货见底时告诉前端，让它换个说法而不是默默重复发老题
    exhausted, remaining, poolSize: poolSize()
  });
});

app.post("/api/ask", playerLimit, ipLimit, async (req, res) => {
  const { sessionId, question } = req.body || {};
  const s = sessionId ? await sessions.get(sessionId) : null;
  if (!s) return res.status(404).json({ error: "session_expired" });
  if (s.over) return res.status(409).json({ error: "game_over" });

  const q = String(question || "").trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: "empty_question" });

  const puzzle = byId(s.puzzleId);
  if (!puzzle) return res.status(404).json({ error: "session_expired" });

  // 原句重复提问：直接回之前的裁定，不再打 API。
  // 省钱，而且避免同一句话两次得到不同答案。
  const seen = s.history.find((h) => h.q === q);
  if (seen) {
    return res.json({
      verdict: seen.verdict, note: "", newKeys: 0, cached: true, reveal: [],
      hitKeys: s.hit.length, totalKeys: puzzle.keys.length,
      asked: s.history.length, solved: false, degraded: false
    });
  }

  const out = await adjudicate(puzzle, s, q);
  const hitBefore = [...s.hit];

  // 「换个问法」不计入提问数，也不推进进度。
  // 降级的裁定不是真答案，同样不入历史——否则重复提问会把假答案缓存住。
  if (out.verdict !== "换个问法" && !out.degraded) {
    s.history.push({ q, verdict: out.verdict });
    s.hit.push(...out.keys);
  }

  let earned = 0, points;
  if (out.solved) {
    s.over = true;
    logFinish(s, puzzle, "solved");
    const player = await ownerOf(s);
    earned = awardSolve(player, puzzle.id);
    await players.save(s.pid, player);
    points = player.points;
  }
  await sessions.set(sessionId, s);

  res.json({
    verdict: out.verdict,
    note: out.note,
    newKeys: out.keys.length,
    hitKeys: s.hit.length,
    totalKeys: puzzle.keys.length,
    asked: s.history.length,
    solved: out.solved,
    degraded: out.degraded === true,
    busy: out.busy === true,
    // 这一问新揭开的汤底段落；通关时补齐剩下的全部
    reveal: revealDiff(puzzle, hitBefore, s.hit, out.solved),
    // 只有通关才下发整句汤底
    solution: out.solved ? puzzle.solution : undefined,
    earned, points
  });
});

// 看广告之前先领一张票据。广告看完后拿票据换提示。
app.post("/api/ad/ticket", playerLimit, async (req, res) => {
  const sid = req.body?.sessionId;
  const s = sid ? await sessions.get(sid) : null;
  if (!s) return res.status(404).json({ error: "session_expired" });
  if (s.over) return res.status(409).json({ error: "game_over" });
  if (!ADS.client && !ADS.mock) return res.status(404).json({ error: "ads_disabled" });
  const ticket = issueAdTicket(s);
  await sessions.set(sid, s);
  res.json({ ticket });
});

// pay: "points"（花积分）| "ad"（带 ticket）。免费的那条不用传。
app.post("/api/hint", playerLimit, async (req, res) => {
  const { sessionId, pay, ticket } = req.body || {};
  const s = sessionId ? await sessions.get(sessionId) : null;
  if (!s) return res.status(404).json({ error: "session_expired" });
  const puzzle = byId(s.puzzleId);
  if (!puzzle) return res.status(404).json({ error: "session_expired" });

  const player = await ownerOf(s);
  const r = chargeHint({ session: s, puzzle, player, pay, ticket });
  if (!r.ok) {
    return res.status(r.status).json({ error: r.error, cost: r.cost, points: player.points });
  }
  await sessions.set(sessionId, s);
  if (r.method === "points") await players.save(s.pid, player);
  res.json({
    hint: r.hint, paid: r.method,
    hintsUsed: s.hintsUsed, totalHints: puzzle.hints.length,
    points: player.points,
    next: hintQuote(s, puzzle, player)
  });
});

app.post("/api/giveup", async (req, res) => {
  const sid = req.body?.sessionId;
  const s = sid ? await sessions.get(sid) : null;
  if (!s) return res.status(404).json({ error: "session_expired" });
  const puzzle = byId(s.puzzleId);
  if (!puzzle) return res.status(404).json({ error: "session_expired" });
  const already = s.over;
  s.over = true;
  await sessions.set(sid, s);
  if (!already) logFinish(s, puzzle, "gaveup");
  res.json({
    solution: puzzle.solution,
    // 全部段落（含已经揭开的），客户端直接整体重绘
    reveal: revealDiff(puzzle, [], [], true),
    asked: s.history.length, hintsUsed: s.hintsUsed, gaveUp: true
  });
});

mountRooms(app, { rooms, players, playerLimit, ipLimit, onFinish: logFinish });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`海龟汤 listening on ${PORT}`));
