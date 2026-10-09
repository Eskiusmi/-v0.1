// 房间联机。
//
// 一个房间 = 一群人一起喝同一碗汤：同一道题、同一个汤底、同一份问答记录，谁都能问。
// 谁问出了答案，这一碗就结束，问出答案的人得分。房主可以揭晓汤底、开下一碗。
//
// 实时同步用 SSE（服务端推送）：每次房间有变化，就把房间当前状态推给每个在线的人。
// 推的是整份状态（几 KB），客户端按状态重画，不怕丢消息、不怕乱序。
//
// 两条规矩：
//   1. 玩家的 cookie ID（pid）绝不下发。它等于玩家的密码，别人拿到就能冒充他花积分。
//      房间里互相看到的是另一个公开 ID（mid）。
//   2. 裁定并行，写入串行。几个人同时提问，各自同时去问裁判；结果回来后按房间排队写入，
//      谁也不会把别人的问题覆盖掉。

import crypto from "node:crypto";
import { PUZZLES, byId, publicView } from "./puzzles.js";
import { adjudicate } from "./adjudicator.js";
import { visibleIndexes, revealDiff } from "./reveal.js";
import { awardSolve, hintQuote, chargeHint } from "./economy.js";
import { readPid } from "./players.js";
import { createLimiter } from "./limits.js";

export const MAX_MEMBERS = 8;
const NAME_MAX = 12;

export function cleanName(raw) {
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  return [...s].slice(0, NAME_MAX).join("") || null;
}
export const defaultName = () => `汤友${10 + crypto.randomInt(90)}`;
export function cleanCode(raw) {
  const c = String(raw ?? "").replace(/\D/g, "");
  return /^\d{4,5}$/.test(c) ? c : null;
}

export function newGame(puzzle, now = Date.now()) {
  return {
    id: crypto.randomUUID().slice(0, 8), puzzleId: puzzle.id,
    hit: [], history: [], log: [], hintsUsed: 0, hintPays: [],
    over: false, solved: false, gaveUp: false, solvedBy: null, solvedByName: null, startedAt: now
  };
}

// 房间里还没出过的题优先
export function pickForRoom(room) {
  const played = new Set(room?.played || []);
  const fresh = PUZZLES.filter((p) => !played.has(p.id));
  const from = fresh.length ? fresh : PUZZLES;
  return from[crypto.randomInt(from.length)];
}

// 一个人看到的房间。pid 只在服务端用来算「哪条是我的」，不进结果。
export function roomView(room, pid, { online = () => false, pending = [] } = {}) {
  const g = room.game;
  const p = byId(g.puzzleId);
  const mid = (x) => room.members[x]?.mid ?? null;
  return {
    code: room.code,
    members: Object.entries(room.members)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
      .map(([k, m]) => ({ id: m.mid, name: m.name, host: k === room.host, online: online(k), me: k === pid })),
    game: {
      id: g.id,
      puzzle: publicView(p),
      revealed: visibleIndexes(p, g.hit, g.over).map((i) => ({ i, text: p.reveal[i].text })),
      log: g.log.map((e) => ({
        t: e.t, name: e.name, who: mid(e.by), mine: e.by === pid,
        q: e.q, verdict: e.verdict, note: e.note, degraded: e.degraded, busy: e.busy,
        cached: e.cached, gained: e.gained, text: e.text, paid: e.paid
      })),
      asked: g.history.length,
      hintsUsed: g.hintsUsed, totalHints: p.hints.length,
      over: g.over, solved: g.solved, gaveUp: g.gaveUp,
      solvedByName: g.solvedByName, solvedByMe: !!g.solvedBy && g.solvedBy === pid,
      solution: g.over ? p.solution : undefined
    },
    pending: pending.map((x) => ({ id: x.id, name: x.name, q: x.q, mine: x.by === pid })),
    me: { id: mid(pid), host: pid === room.host, member: !!room.members[pid] }
  };
}

// 把一次裁定结果写进房间。纯函数，方便测并发：裁定是基于提问那一刻的快照做的，
// 写入时以房间当前状态为准合并。
export function commitAsk(room, { gameId, pid, name, q, out, puzzle, now = Date.now() }) {
  const G = room.game;
  if (G.id !== gameId) return { stale: true };   // 这期间房主换了题
  const before = [...G.hit];
  if (out.verdict !== "换个问法" && !out.degraded) {
    G.history.push({ q, verdict: out.verdict, by: pid });
    for (const k of out.keys) if (!G.hit.includes(k)) G.hit.push(k);
  }
  const solvedNow = !!out.solved && !G.over;
  if (solvedNow) Object.assign(G, { over: true, solved: true, solvedBy: pid, solvedByName: name });
  const gained = revealDiff(puzzle, before, G.hit, false).length;
  G.log.push({
    t: "q", by: pid, name, q, verdict: out.verdict, note: out.note || "",
    degraded: !!out.degraded, busy: !!out.busy, gained, at: now
  });
  return { stale: false, solvedNow, gained };
}

const httpErr = (status, code, extra) => Object.assign(new Error(code), { status, code, extra });
const sys = (text) => ({ t: "sys", text, at: Date.now() });

export function mountRooms(app, { rooms, players, playerLimit, ipLimit, onFinish = () => {} }) {
  const subs = new Map();       // code → Set<{ pid, res }>
  const pendings = new Map();   // code → Map<id, { by, name, q }>
  const locks = new Map();      // code → 最后一个排队的 promise
  // 一个房间整体的提问速度。联机会把 API 花费乘上人数，这里封个顶。
  const roomLimit = createLimiter({ max: 40, refillMs: 2000, keyOf: (req) => "room:" + req.params.code });

  const isOnline = (code, pid) => [...(subs.get(code) || [])].some((s) => s.pid === pid);
  const pendingList = (code) => [...(pendings.get(code)?.entries() || [])].map(([id, x]) => ({ id, ...x }));

  async function viewFor(room, pid) {
    const v = roomView(room, pid, { online: (k) => isOnline(room.code, k), pending: pendingList(room.code) });
    const player = await players.get(pid);
    v.me.points = player.points;
    v.me.hint = hintQuote(room.game, byId(room.game.puzzleId), player);
    return v;
  }

  async function broadcast(code, room) {
    const set = subs.get(code);
    if (!set?.size) return;
    room ||= await rooms.get(code);
    if (!room) return;
    for (const s of set) {
      try { s.res.write(`event: state\ndata: ${JSON.stringify(await viewFor(room, s.pid))}\n\n`); }
      catch { /* 连接已断，close 事件会清理 */ }
    }
  }

  // 同一个房间的写入排队执行
  function withLock(code, fn) {
    const prev = locks.get(code) || Promise.resolve();
    const run = prev.then(() => fn());
    const tail = run.catch(() => {});
    locks.set(code, tail);
    tail.then(() => { if (locks.get(code) === tail) locks.delete(code); });
    return run;
  }

  function mutate(code, fn) {
    return withLock(code, async () => {
      const room = await rooms.get(code);
      if (!room) throw httpErr(404, "room_not_found");
      const result = await fn(room);
      await rooms.set(code, room);
      await broadcast(code, room);
      return { room, result };
    });
  }

  async function member(req) {
    const code = cleanCode(req.params.code);
    if (!code) throw httpErr(404, "room_not_found");
    const room = await rooms.get(code);
    if (!room) throw httpErr(404, "room_not_found");
    const pid = readPid(req);
    if (!pid || !room.members[pid]) throw httpErr(403, "not_in_room");
    return { pid, code, room };
  }

  const route = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.code, ...(e.extra || {}) });
      console.error("[room]", e);
      res.status(500).json({ error: "server_error" });
    }
  };

  async function newCode() {
    for (let i = 0; i < 40; i++) {
      const code = String(1000 + crypto.randomInt(9000));
      if (!(await rooms.get(code))) return code;
    }
    return String(10000 + crypto.randomInt(90000));
  }

  /* ---- 开房间 ---- */
  app.post("/api/room", ipLimit, route(async (req, res) => {
    const { pid } = await players.load(req, res);
    const name = cleanName(req.body?.name) || defaultName();
    const code = await newCode();
    const puzzle = pickForRoom(null);
    const now = Date.now();
    const room = {
      code, created: now, host: pid, played: [puzzle.id],
      members: { [pid]: { mid: crypto.randomUUID().slice(0, 8), name, joinedAt: now } },
      game: newGame(puzzle, now)
    };
    room.game.log.push(sys(`${name} 开了房间`));
    await rooms.set(code, room);
    res.json({ code, state: await viewFor(room, pid) });
  }));

  /* ---- 用房间号加入 ---- */
  app.post("/api/room/:code/join", ipLimit, route(async (req, res) => {
    const code = cleanCode(req.params.code);
    if (!code) throw httpErr(404, "room_not_found");
    const { pid } = await players.load(req, res);
    const name = cleanName(req.body?.name) || defaultName();
    const { room } = await mutate(code, (r) => {
      const m = r.members[pid];
      if (m) { if (m.name !== name) { r.game.log.push(sys(`${m.name} 改名为 ${name}`)); m.name = name; } return; }
      if (Object.keys(r.members).length >= MAX_MEMBERS) throw httpErr(409, "room_full");
      r.members[pid] = { mid: crypto.randomUUID().slice(0, 8), name, joinedAt: Date.now() };
      if (!r.members[r.host]) r.host = pid;   // 房主已经走了：第一个回来的人接手
      r.game.log.push(sys(`${name} 加入了房间`));
    });
    res.json({ code, state: await viewFor(room, pid) });
  }));

  /* ---- 房间状态：成员拿完整状态；非成员只知道房间在不在、几个人 ---- */
  app.get("/api/room/:code", route(async (req, res) => {
    const code = cleanCode(req.params.code);
    const room = code && await rooms.get(code);
    if (!room) throw httpErr(404, "room_not_found");
    const pid = readPid(req);
    if (pid && room.members[pid]) return res.json({ joined: true, state: await viewFor(room, pid) });
    const n = Object.keys(room.members).length;
    res.json({ joined: false, members: n, full: n >= MAX_MEMBERS });
  }));

  /* ---- 实时推送 ---- */
  app.get("/api/room/:code/events", route(async (req, res) => {
    const { pid, code } = await member(req);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 3000\n\n");
    const sub = { pid, res };
    if (!subs.has(code)) subs.set(code, new Set());
    subs.get(code).add(sub);
    await broadcast(code);   // 让大家看到他上线了
    // 代理会掐掉长时间没动静的连接，隔一会儿发个注释行保活
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* 已断 */ } }, 20000);
    req.on("close", () => {
      clearInterval(ping);
      const set = subs.get(code);
      set?.delete(sub);
      if (set && !set.size) subs.delete(code);
      broadcast(code);
    });
  }));

  /* ---- 提问 ---- */
  app.post("/api/room/:code/ask", playerLimit, ipLimit, roomLimit, route(async (req, res) => {
    const { pid, code, room } = await member(req);
    const G = room.game;
    if (G.over) throw httpErr(409, "game_over");
    const q = String(req.body?.question || "").trim().slice(0, 200);
    if (!q) throw httpErr(400, "empty_question");
    const name = room.members[pid].name;
    const puzzle = byId(G.puzzleId);

    // 同一句话房间里有人问过：直接给答案，不再花钱问裁判
    const seen = G.history.find((h) => h.q === q);
    if (seen) {
      await mutate(code, (r) => {
        if (r.game.id === G.id) r.game.log.push({ t: "q", by: pid, name, q, verdict: seen.verdict, cached: true, gained: 0, at: Date.now() });
      });
      return res.json({ verdict: seen.verdict, cached: true });
    }

    // 「某某正在问……」让其他人看到
    const id = crypto.randomUUID().slice(0, 8);
    if (!pendings.has(code)) pendings.set(code, new Map());
    pendings.get(code).set(id, { by: pid, name, q });
    broadcast(code, room);

    let out;
    try { out = await adjudicate(puzzle, { hit: G.hit, history: G.history }, q); }
    finally {
      pendings.get(code)?.delete(id);
      if (!pendings.get(code)?.size) pendings.delete(code);
    }

    const { room: after, result } = await mutate(code, (r) =>
      commitAsk(r, { gameId: G.id, pid, name, q, out, puzzle }));

    let earned = 0, points;
    if (result.solvedNow) {
      const player = await players.get(pid);
      earned = awardSolve(player, puzzle.id);
      await players.save(pid, player);
      points = player.points;
      onFinish(after.game, puzzle, "solved", { room: code, members: Object.keys(after.members).length });
      broadcast(code);   // 积分变了，再推一次
    }
    res.json({
      verdict: out.verdict, note: out.note, degraded: !!out.degraded, busy: !!out.busy,
      solved: !!result.solvedNow, stale: !!result.stale, earned, points
    });
  }));

  /* ---- 提示：免费的那条全房间共用；付费的从提问人的积分里扣 ---- */
  app.post("/api/room/:code/hint", playerLimit, route(async (req, res) => {
    const { pid, code } = await member(req);
    const { result } = await mutate(code, async (r) => {
      const G = r.game;
      if (G.over) throw httpErr(409, "game_over");
      const player = await players.get(pid);
      const c = chargeHint({ session: G, puzzle: byId(G.puzzleId), player, pay: req.body?.pay });
      if (!c.ok) throw httpErr(c.status, c.error, { cost: c.cost, points: player.points });
      if (c.method === "points") await players.save(pid, player);
      G.log.push({ t: "hint", by: pid, name: r.members[pid].name, text: c.hint, paid: c.method, at: Date.now() });
      return { hint: c.hint, paid: c.method, points: player.points };
    });
    res.json(result);
  }));

  /* ---- 房主：揭晓汤底 ---- */
  app.post("/api/room/:code/giveup", route(async (req, res) => {
    const { pid, code, room } = await member(req);
    if (room.host !== pid) throw httpErr(403, "host_only");
    await mutate(code, (r) => {
      const G = r.game;
      if (G.over) return;
      Object.assign(G, { over: true, gaveUp: true });
      G.log.push(sys("房主揭晓了汤底"));
      onFinish(G, byId(G.puzzleId), "gaveup", { room: code, members: Object.keys(r.members).length });
    });
    res.json({ ok: true });
  }));

  /* ---- 房主：下一碗 ---- */
  app.post("/api/room/:code/next", ipLimit, route(async (req, res) => {
    const { pid, code, room } = await member(req);
    if (room.host !== pid) throw httpErr(403, "host_only");
    await mutate(code, (r) => {
      if (!r.game.over) throw httpErr(409, "game_not_over");
      const p = pickForRoom(r);
      r.played = [...(r.played || []), p.id].slice(-200);
      r.game = newGame(p);
      r.game.log.push(sys(`第 ${r.played.length} 碗`));
    });
    res.json({ ok: true });
  }));

  /* ---- 离开 ---- */
  app.post("/api/room/:code/leave", route(async (req, res) => {
    const { pid, code } = await member(req);
    await mutate(code, (r) => {
      const name = r.members[pid]?.name;
      delete r.members[pid];
      r.game.log.push(sys(`${name} 离开了房间`));
      if (r.host === pid) {
        const next = Object.entries(r.members).sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
        if (next) { r.host = next[0]; r.game.log.push(sys(`${next[1].name} 成为房主`)); }
      }
    });
    // 断开他自己的推送
    for (const s of subs.get(code) || []) if (s.pid === pid) { try { s.res.end(); } catch { /* 已断 */ } }
    res.json({ ok: true });
  }));

  return { stats: () => ({ rooms: subs.size, connections: [...subs.values()].reduce((a, s) => a + s.size, 0) }) };
}
