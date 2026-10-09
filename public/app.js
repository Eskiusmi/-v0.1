/* 海龟汤前端。没有构建步骤，改完刷新就生效。
   两种模式共用同一套界面：
   - 单人（solo）：/api/start、/api/ask……一问一答
   - 房间（room）：/api/room/…，状态由服务端推送（SSE），所有人看到同一份 */

/* ---- 所有玩家看得到的文字都在这里。加语言 = 加一个 key。 ---- */
const I18N = {
  zh: {
    bowl: "汤底",
    count: (r, t) => `已揭开 ${r} / ${t}`,
    countDone: "全部揭开",
    diff: "难度",
    fold: "收起题目", unfold: "展开题目",
    empty: "提一个能用「是」或「否」回答的问题。每想到一个关键点，汤底就会揭开一段。",
    emptyRoom: "房间里的人都能提问，谁问出了答案，这一碗就结束。每想到一个关键点，汤底揭开一段。",
    inputLabel: "你的问题",
    placeholder: "问一个能用是或否回答的问题",
    send: "提问",
    hintFree: "免费提示",
    hintPaid: cost => `提示（${cost} 积分）`,
    hintMore: "更多提示",
    hintDone: "提示已用完",
    hintConfirm: cost => `再点一次，用 ${cost} 积分`,
    hintTag: "提示",
    hintBy: name => `提示（${name}）`,
    purse: n => `${n} 积分`,
    chooseTitle: n => `第 ${n} 条提示`,
    chooseLine: "看一段广告，或者用积分换。",
    chooseLineNoAds: "用积分换。",
    payAd: "看一段广告",
    adLoading: "广告加载中…",
    adNone: "暂时没有可看的广告",
    payPoints: (cost, have) => `用 ${cost} 积分换（你有 ${have} 分）`,
    notEnough: (cost, per) => `积分不够，要 ${cost} 分。解开一道新题得 ${per} 分。`,
    cancel: "取消",
    adsNote: "广告由 Google 提供，隐私说明",
    adDismissed: "广告没看完，这次没有拿到提示。",
    adFailed: "广告没能确认看完，没有扣你的分，可以再试一次。",
    earned: (n, total) => `获得 ${n} 积分，现在有 ${total} 分。`,
    solvedBefore: "这道题你以前解开过，这次不加分。",
    mockAd: "测试广告",
    mockWait: n => `${n} 秒后可以领取`,
    mockClaim: "领取提示",
    mockClose: "关闭",
    giveup: "揭晓汤底",
    giveupConfirm: "再点一次揭晓",
    giveupHostOnly: "房主可揭晓",
    verdict: { "是": "是", "否": "否", "无关": "无关", "换个问法": "换个问法" },
    gain: n => (n > 1 ? `汤底揭开了 ${n} 段` : "汤底揭开了一段"),
    cached: "这个问题问过了，答案不变。",
    degraded: "裁判暂时没有回应，这一问没有算数，再问一次。",
    busy: "现在提问的人有点多，这一问没有算数，等几秒再问。",
    expired: "服务刚刚更新过，这道题已经重新开始。",
    tooFast: "问得有点快，稍等几秒再问。",
    netErr: "网络连接不上，检查一下再问一次。",
    bootErr: "题目没能加载出来，刷新页面再试一次。",
    exhausted: "题库里的题你都做过了，这一道是重做的。",
    solvedTitle: "见底了",
    gaveTitle: "汤底在这儿",
    solvedLine: (n, h) => `${n} 个问题` + (h ? `，用了 ${h} 条提示。` : "，没用提示。"),
    gaveLine: n => `问了 ${n} 个问题。`,
    roomSolvedMe: "你问出来了",
    roomSolvedBy: name => `${name}问出来了`,
    roomLine: n => `全房间一共问了 ${n} 个问题。`,
    share: "分享成绩", shared: "已复制到剪贴板",
    next: "下一碗",
    nextWait: "等房主开下一碗",
    shareText: (n, seq, solved, url) =>
      `海龟汤 ${solved ? `${n} 问见底` : `${n} 问后揭晓`}\n${seq}\n${url}`,
    hidden: "（未揭开）",
    // 联机
    roomBtn: "联机",
    roomBtnIn: "房间",
    lobbyTitle: "和朋友一起喝",
    lobbyLine: "开一个房间，把房间号发给朋友；或者输入朋友给你的房间号。",
    lobbyJoinLine: code => `加入房间 ${code}，先起个昵称。`,
    nick: "你的昵称",
    createRoom: "开一个房间",
    codePh: "房间号",
    joinRoom: "加入",
    roomLabel: code => `房间 ${code}`,
    people: (names, n) => `${n} 人：${names}`,
    invite: "邀请",
    invited: "已复制",
    leave: "退出",
    inviteText: (code, url) => `来一起喝海龟汤，房间号 ${code}\n${url}`,
    roomNotFound: "没有这个房间，检查一下房间号。",
    roomFull: "这个房间满了。",
    roomGone: "房间已经关闭了，回到单人模式。",
    notInRoom: "你已经不在这个房间里了。",
    asking: "正在问"
  }
};
const t = I18N.zh;
const MODE = new URLSearchParams(location.search).get("mode") === "daily" ? "daily" : "fresh";
const GLYPH = { "是": "■", "否": "□", "无关": "◌" };
const CHIP = { "是": "yes", "否": "no", "无关": "moot", "换个问法": "again" };

const $ = id => document.getElementById(id);
const api = (path, body) => fetch(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body || {})
}).then(async r => {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { data, status: r.status });
  return data;
});
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 无痕模式 */ } }
};

/* ---- 状态 ---- */
let mode = "solo";                      // solo | room
let sid = null, puzzle = null;          // 单人：当前对局
let asked = 0, hintsUsed = 0, busy = false, over = false, solved = false;
let seq = [], revealed = new Map();
let points = 0, quote = null, solvedBefore = false;
let CONFIG = { ads: {}, hintCost: 1, freeHints: 1, pointsPerSolve: 1 };
// 房间
let roomCode = null, es = null, isHost = false;
let renderedGame = null, renderedLog = 0, roomAsked = 0;
let myInflight = null, lastViewAt = 0;

/* ---- 静态文案 ---- */
function paintStatic() {
  $("bowlName").textContent = t.bowl;
  $("inputLabel").textContent = t.inputLabel;
  $("input").placeholder = t.placeholder;
  $("send").setAttribute("aria-label", t.send);
  $("giveupLabel").textContent = t.giveup;
  $("chooseCancel").textContent = t.cancel;
  $("adsNote").textContent = t.adsNote;
  $("shareLabel").textContent = t.share;
  $("next").textContent = t.next;
  $("roomBtn").setAttribute("aria-label", t.roomBtn);
  $("roomBtn").title = t.roomBtn;
  $("lobbyTitle").textContent = t.lobbyTitle;
  $("nickLabel").textContent = t.nick;
  $("createRoom").textContent = t.createRoom;
  $("codeInput").placeholder = t.codePh;
  $("joinRoom").textContent = t.joinRoom;
  $("lobbyCancel").textContent = t.cancel;
  $("invite").textContent = t.invite;
  $("leave").textContent = t.leave;
}

/* ---- 模糊的假字：只用来占位，和真汤底没有任何关系 ---- */
const POOL = "的一是在不了有和人这中大为上个我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天四日那事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道此变条只没结解问意建月公无系很情者最立代想已通并提直题程展五果料象员位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严";
function seeded(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
}
function fake(shape, seed) {
  const rnd = seeded(seed);
  return [...shape].map(c => (c === "□" ? POOL[Math.floor(rnd() * POOL.length)] : c)).join("");
}

/* ---- 汤底 ---- */
function paintBowl() {
  const box = $("answer");
  box.textContent = "";
  puzzle.reveal.forEach((seg, i) => {
    const span = document.createElement("span");
    span.dataset.i = i;
    if (revealed.has(i)) {
      span.className = "seg";
      span.textContent = revealed.get(i);
    } else {
      span.className = "seg hidden";
      span.setAttribute("aria-hidden", "true");
      span.textContent = fake(seg.shape, puzzle.id + ":" + i);
    }
    box.append(span);
  });
  // 读屏软件读不到假字；告诉它这一段还没揭开
  const sr = document.createElement("span");
  sr.className = "sr";
  sr.textContent = revealed.size < puzzle.reveal.length ? t.hidden : "";
  box.append(sr);
  paintCount();
}

function paintCount() {
  const keyed = puzzle.reveal.filter(s => s.keyed).length;
  const shownKeyed = puzzle.reveal.filter((s, i) => s.keyed && revealed.has(i)).length;
  $("bowlCount").textContent = revealed.size === puzzle.reveal.length ? t.countDone : t.count(shownKeyed, keyed);
}

function uncover(items, stagger = 0) {
  items.forEach(({ i, text }, n) => {
    revealed.set(i, text);
    const span = $("answer").querySelector(`[data-i="${i}"]`);
    if (!span) return;
    setTimeout(() => {
      span.className = "seg shown";
      span.removeAttribute("aria-hidden");
      span.textContent = text;
      span.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, n * stagger);
  });
  const sr = $("answer").querySelector(".sr");
  if (sr && revealed.size === puzzle.reveal.length) sr.textContent = "";
  paintCount();
}

/* ---- 换一道题时把界面摆好（单人和房间共用） ---- */
function setupPuzzle(pv, emptyText) {
  puzzle = pv;
  asked = 0; hintsUsed = 0; busy = false; over = false; solved = false;
  seq = []; revealed = new Map();

  $("scene").textContent = puzzle.scene;
  setTag("tagBroth", puzzle.broth, puzzle.broth === "红汤" ? "red" : "");
  setTag("tagGenre", puzzle.genre);
  const d = Math.max(1, Math.min(4, puzzle.difficulty || 1));
  $("tagDiff").hidden = false;
  $("tagDiff").innerHTML = `${t.diff}<span class="dots" aria-hidden="true">${[1, 2, 3, 4].map(n => `<i class="${n <= d ? "on" : ""}"></i>`).join("")}</span>`;
  $("tagDiff").setAttribute("aria-label", `${t.diff} ${d} / 4`);

  $("head").classList.remove("compact");
  paintBowl();

  $("log").innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "empty"; empty.id = "empty"; empty.textContent = emptyText;
  $("log").append(empty);

  $("dock").classList.remove("done", "choosing");
  $("input").disabled = false;
  $("send").disabled = false;
  armGiveup(false);
  armHint(false);
  paintFold();
}

function setTag(id, text, cls = "") {
  const el = $(id);
  el.hidden = !text;
  el.textContent = text || "";
  el.className = "tag " + cls;
}

/* ---- 题目太长时可以收起，给问答记录腾地方 ---- */
function paintFold() {
  const s = $("scene");
  const compact = $("head").classList.contains("compact");
  // 收起状态下量不出真实行数，按展开时的高度算
  const lh = parseFloat(getComputedStyle(s).lineHeight);
  const lines = compact ? 3 : Math.round(s.getBoundingClientRect().height / lh);
  $("fold").hidden = !compact && lines <= 2;
  $("fold").textContent = compact ? t.unfold : t.fold;
  $("fold").setAttribute("aria-expanded", String(!compact));
}
$("fold").onclick = () => { $("head").classList.toggle("compact"); paintFold(); };
// 字体晚到、窗口变化都会改变题目的行数：只要题目尺寸变了就重新判断
new ResizeObserver(() => puzzle && paintFold()).observe($("scene"));

/* ---- 问答记录 ---- */
function note(text, cls, tag) {
  const el = document.createElement("div");
  el.className = "note " + cls;
  if (tag) { const b = document.createElement("b"); b.textContent = tag; el.append(b); }
  el.append(document.createTextNode(text));
  insertLog(el);
  scrollLog();
  return el;
}
function sysLine(text) {
  const el = document.createElement("p");
  el.className = "sysline";
  el.textContent = text;
  insertLog(el);
}
function sub(row, text, cls = "") {
  const el = document.createElement("div");
  el.className = "sub " + cls;
  el.textContent = text;
  row.append(el);
}
// 新内容放在「正在问」的那几行前面，正在问的永远在最下面
function insertLog(el) {
  const box = $("pendingBox");
  if (box) $("log").insertBefore(el, box); else $("log").append(el);
}
function makeRow({ n = "", q, who = null, mine = false, verdict = null }) {
  const row = document.createElement("div");
  row.className = "row" + (verdict ? "" : " pending");
  row.innerHTML = `<span class="n"></span><span class="q"></span><span class="chip"></span>`;
  row.querySelector(".n").textContent = n;
  const qEl = row.querySelector(".q");
  if (who) {
    const w = document.createElement("span");
    w.className = "who" + (mine ? " mine" : "");
    w.textContent = who;
    qEl.append(w);
  }
  qEl.append(document.createTextNode(q));
  setChip(row, verdict);
  return row;
}
function setChip(row, verdict) {
  const chip = row.querySelector(".chip");
  if (!verdict) { chip.className = "chip wait"; chip.setAttribute("aria-label", "等待裁定"); chip.textContent = ""; return; }
  chip.className = "chip " + (CHIP[verdict] || "moot");
  chip.removeAttribute("aria-label");
  chip.textContent = t.verdict[verdict] || verdict;
  row.classList.remove("pending");
}
function scrollLog() { $("log").scrollTop = $("log").scrollHeight; }

/* ================= 单人 ================= */

async function start(puzzleId) {
  const res = await api("/api/start", { puzzleId, mode: puzzleId ? undefined : MODE });
  mode = "solo";
  sid = res.sessionId;
  setupPuzzle(res.puzzle, t.empty);
  points = res.points ?? points; quote = res.hint || null; solvedBefore = !!res.solvedBefore;
  if (res.exhausted) note(t.exhausted, "err");
  paintHint(); paintPurse(); paintRoomUi();
  history.replaceState(null, "", `?p=${encodeURIComponent(puzzle.id)}`);
}

async function askSolo(text) {
  const row = makeRow({ n: asked + 1, q: text });
  insertLog(row);
  scrollLog();
  try {
    const r = await api("/api/ask", { sessionId: sid, question: text });
    setChip(row, r.verdict);
    if (r.cached) { row.querySelector(".n").textContent = ""; sub(row, t.cached); }
    else if (r.degraded) { row.querySelector(".n").textContent = ""; sub(row, r.busy ? t.busy : t.degraded, "warn"); }
    else if (r.verdict === "换个问法") { row.querySelector(".n").textContent = ""; if (r.note) sub(row, r.note); }
    else { asked = r.asked; seq.push(GLYPH[r.verdict] || "·"); }

    const fresh = (r.reveal || []).filter(x => !revealed.has(x.i));
    if (r.solved) {
      uncover(fresh, 160);
      if (typeof r.points === "number") points = r.points;
      finish(true, fresh.length * 160 + 500, r.earned || 0);
    } else if (fresh.length) {
      sub(row, t.gain(fresh.length), "gain");
      uncover(fresh);
    }
    return null;
  } catch (err) {
    row.remove();
    if (err.message === "session_expired") { note(t.expired, "err"); await start(puzzle?.id); }
    else note({ too_many_requests: t.tooFast }[err.message] || t.netErr, "err");
    return text;   // 把问题放回输入框
  }
}

/* ================= 房间 ================= */

async function askRoom(text) {
  myInflight = text;
  renderPending(lastPending);
  try {
    const r = await api(`/api/room/${roomCode}/ask`, { question: text });
    if (r.earned) { points = r.points; pendingEarned = r.earned; paintPurse(true); paintResultLine(); }
    return null;
  } catch (err) {
    if (err.message === "game_over") return null;
    if (await roomErrorHandled(err)) return null;
    note({ too_many_requests: t.tooFast }[err.message] || t.netErr, "err");
    return text;
  } finally {
    myInflight = null;
    renderPending(lastPending);
    // 推送通常比这个回应先到；万一推送断了，主动拉一次
    const asOf = Date.now();
    setTimeout(() => { if (mode === "room" && lastViewAt < asOf) refreshRoom(); }, 1500);
  }
}

let lastPending = [], pendingEarned = 0, lastGame = null;

function renderRoom(v) {
  if (mode !== "room" || v.code !== roomCode) return;
  lastViewAt = Date.now();
  const g = v.game;
  lastGame = g;
  isHost = v.me.host;

  // 房间条
  $("roomLabel").textContent = t.roomLabel(v.code);
  const online = v.members.filter(m => m.online);
  const names = (online.length ? online : v.members).map(m => m.name + (m.host ? "（房主）" : "")).join("、");
  $("roomPeople").textContent = t.people(names, (online.length || v.members.length));

  // 换题了：整个重画
  if (g.id !== renderedGame) {
    renderedGame = g.id; renderedLog = 0; roomAsked = 0; pendingEarned = 0;
    setupPuzzle(g.puzzle, t.emptyRoom);
    const box = document.createElement("div");
    box.id = "pendingBox";
    $("log").append(box);
  }

  // 只追加新的记录
  for (; renderedLog < g.log.length; renderedLog++) renderLogItem(g.log[renderedLog]);
  lastPending = v.pending;
  renderPending(v.pending);

  // 汤底
  const fresh = g.revealed.filter(x => !revealed.has(x.i));
  if (fresh.length) uncover(fresh, g.over ? 160 : 0);

  points = v.me.points; quote = v.me.hint; hintsUsed = g.hintsUsed; asked = g.asked;
  paintPurse(); paintHint(); paintRoomUi();
  if (g.over && !over) finishRoom(g, fresh.length);
  scrollLog();
}

function renderLogItem(e) {
  if (e.t === "sys") return sysLine(e.text);   // 系统消息不顶掉玩法说明
  $("empty")?.remove();
  if (e.t === "hint") return note(e.text, "hint", e.mine ? t.hintTag : t.hintBy(e.name));
  const counted = e.verdict !== "换个问法" && !e.degraded && !e.cached;
  if (counted) { roomAsked++; seq.push(GLYPH[e.verdict] || "·"); }
  const row = makeRow({ n: counted ? roomAsked : "", q: e.q, who: e.name, mine: e.mine, verdict: e.verdict });
  if (e.cached) sub(row, t.cached);
  else if (e.degraded) sub(row, e.busy ? t.busy : t.degraded, "warn");
  else if (e.verdict === "换个问法" && e.note) sub(row, e.note);
  if (e.gained) sub(row, t.gain(e.gained), "gain");
  insertLog(row);
}

// 「正在问」的几行：别人的 + 我刚发出去还没到服务器的
function renderPending(list) {
  const box = $("pendingBox");
  if (!box) return;
  box.textContent = "";
  const items = [...list];
  if (myInflight && !items.some(p => p.mine && p.q === myInflight)) items.push({ name: "", q: myInflight, mine: true });
  for (const p of items) box.append(makeRow({ q: p.q, who: p.name || null, mine: p.mine }));
  if (items.length) scrollLog();
}

function finishRoom(g, freshCount) {
  over = true; solved = g.solved;
  closeChooser();
  $("input").disabled = true;
  $("send").disabled = true;
  $("head").classList.remove("compact"); paintFold();
  $("resultTitle").textContent = g.solved ? (g.solvedByMe ? t.roomSolvedMe : t.roomSolvedBy(g.solvedByName)) : t.gaveTitle;
  paintResultLine();
  $("shareLabel").textContent = t.share;
  setTimeout(() => {
    $("dock").classList.add("done");
    $("head").scrollTop = 0;
    requestAnimationFrame(scrollLog);
  }, Math.min(freshCount * 160 + 500, 1400));
}
function paintResultLine() {
  if (mode !== "room" || !lastGame?.over) return;
  $("resultLine").textContent = t.roomLine(lastGame.asked) + (pendingEarned ? t.earned(pendingEarned, points) : "");
}

async function refreshRoom() {
  try {
    const r = await fetch(`/api/room/${roomCode}`).then(x => x.ok ? x.json() : Promise.reject(x.status));
    if (r.joined) renderRoom(r.state);
    else { note(t.notInRoom, "err"); exitRoom(); }
  } catch (status) {
    if (status === 404) { note(t.roomGone, "err"); exitRoom(); }
  }
}

// 房间不在了 / 我被移出了：回单人
async function roomErrorHandled(err) {
  if (err.message === "room_not_found") { exitRoom(); note(t.roomGone, "err"); return true; }
  if (err.message === "not_in_room") { exitRoom(); note(t.notInRoom, "err"); return true; }
  return false;
}

function enterRoom(code, state) {
  if (es) es.close();
  mode = "room"; roomCode = code; renderedGame = null;
  closeLobby();
  history.replaceState(null, "", `?room=${code}`);
  renderRoom(state);
  es = new EventSource(`/api/room/${code}/events`);
  es.addEventListener("state", e => renderRoom(JSON.parse(e.data)));
  let checking = null;
  es.onerror = () => {
    // 断线 EventSource 会自己重连；只在房间真的没了时退出
    clearTimeout(checking);
    checking = setTimeout(() => { if (mode === "room") refreshRoom(); }, 1500);
  };
}

function exitRoom() {
  if (es) { es.close(); es = null; }
  mode = "solo"; roomCode = null; renderedGame = null; isHost = false;
  paintRoomUi();
  start().catch(() => note(t.bootErr, "err"));
}

$("leave").onclick = async () => {
  const code = roomCode;
  try { await api(`/api/room/${code}/leave`); } catch { /* 无论如何都回单人 */ }
  exitRoom();
};

$("invite").onclick = async () => {
  const url = `${location.origin}/?room=${roomCode}`;
  const text = t.inviteText(roomCode, url);
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); $("invite").textContent = t.invited; setTimeout(() => ($("invite").textContent = t.invite), 2000); }
  } catch { /* 用户取消 */ }
};

function paintRoomUi() {
  const inRoom = mode === "room";
  $("roomStrip").hidden = !inRoom;
  $("roomBtn").classList.toggle("on", inRoom);
  $("roomBtn").setAttribute("aria-label", inRoom ? t.roomBtnIn : t.roomBtn);
  // 房间里只有房主能揭晓、开下一碗
  const hostOnly = inRoom && !isHost;
  $("giveup").disabled = over || hostOnly;
  $("giveupLabel").textContent = hostOnly ? t.giveupHostOnly : ($("giveup").classList.contains("confirm") ? t.giveupConfirm : t.giveup);
  $("next").disabled = hostOnly;
  $("next").textContent = hostOnly ? t.nextWait : t.next;
}

/* ---- 联机面板 ---- */
function openLobby(code = "", line = t.lobbyLine) {
  closeChooser();
  $("lobbyLine").textContent = line;
  $("lobbyErr").textContent = "";
  $("nick").value = store.get("hg_nick") || `汤友${10 + Math.floor(Math.random() * 90)}`;
  $("codeInput").value = code;
  $("dock").classList.add("lobbying");
  (code ? $("joinRoom") : $("nick")).focus();
}
function closeLobby() { $("dock").classList.remove("lobbying"); }
$("lobbyCancel").onclick = closeLobby;
$("roomBtn").onclick = () => {
  if (mode === "room") return $("roomStrip").scrollIntoView({ block: "nearest" });
  $("dock").classList.contains("lobbying") ? closeLobby() : openLobby();
};
function nick() {
  const v = $("nick").value.trim().slice(0, 12);
  if (v) store.set("hg_nick", v);
  return v;
}
$("createRoom").onclick = async () => {
  $("createRoom").disabled = true;
  try {
    const r = await api("/api/room", { name: nick() });
    enterRoom(r.code, r.state);
  } catch (err) {
    $("lobbyErr").textContent = err.message === "too_many_requests" ? t.tooFast : t.netErr;
  } finally { $("createRoom").disabled = false; }
};
async function joinRoom(code, name) {
  const r = await api(`/api/room/${code}/join`, { name });
  enterRoom(r.code, r.state);
}
$("joinRoom").onclick = async () => {
  const code = $("codeInput").value.replace(/\D/g, "");
  if (code.length < 4) { $("lobbyErr").textContent = t.roomNotFound; return; }
  $("joinRoom").disabled = true;
  try { await joinRoom(code, nick()); }
  catch (err) {
    $("lobbyErr").textContent = { room_not_found: t.roomNotFound, room_full: t.roomFull, too_many_requests: t.tooFast }[err.message] || t.netErr;
  } finally { $("joinRoom").disabled = false; }
};
$("codeInput").addEventListener("keydown", e => { if (e.key === "Enter") $("joinRoom").click(); });

/* ================= 提问（两种模式共用入口） ================= */

async function ask(e) {
  e?.preventDefault();
  const text = $("input").value.trim();
  if (!text || busy || over) return;
  busy = true; $("send").disabled = true;
  $("empty")?.remove();
  $("input").value = ""; grow();
  try {
    const giveBack = mode === "room" ? await askRoom(text) : await askSolo(text);
    if (giveBack) { $("input").value = giveBack; grow(); }
    if ((mode === "room" ? roomAsked : asked) === 1 && innerHeight < 760) { $("head").classList.add("compact"); paintFold(); }
  } finally {
    busy = false;
    $("send").disabled = over;
    if (!over) $("input").focus({ preventScroll: true });
    scrollLog();
  }
}
$("form").addEventListener("submit", ask);
$("input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) ask(e);
});
function grow() {
  const el = $("input");
  el.style.height = "auto";
  el.style.height = Math.min(120, el.scrollHeight) + "px";
}
$("input").addEventListener("input", grow);

/* ================= 提示：前几条免费，之后花积分（开了广告时也可以看广告） ================= */

function paintHint() {
  const q = quote;
  const ads = adsOn();
  let label = "";
  if (q) label = q.exhausted ? t.hintDone : q.free ? t.hintFree : ads ? t.hintMore : t.hintPaid(q.cost);
  if (!$("hint").classList.contains("confirm")) $("hintLabel").textContent = label;
  $("hint").disabled = over || !q || q.exhausted;
}
function paintPurse(bump = false) {
  $("purseLabel").textContent = t.purse(points);
  if (bump) { const el = $("purse"); el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
}

// 花积分要点两次，防误触
let hintTimer = null;
function armHint(on) {
  clearTimeout(hintTimer);
  $("hint").classList.toggle("confirm", on);
  if (on) {
    $("hintLabel").textContent = t.hintConfirm(CONFIG.hintCost);
    hintTimer = setTimeout(() => { armHint(false); paintHint(); }, 3000);
  }
}

$("hint").onclick = () => {
  if (over || !quote || quote.exhausted) return;
  if (quote.free) return takeHint({});
  if (adsOn()) return openChooser();
  if (points < CONFIG.hintCost) { note(t.notEnough(CONFIG.hintCost, CONFIG.pointsPerSolve), "err"); return; }
  if (!$("hint").classList.contains("confirm")) return armHint(true);
  armHint(false);
  takeHint({ pay: "points" });
};

async function takeHint(body) {
  try {
    const inRoom = mode === "room";
    const r = inRoom
      ? await api(`/api/room/${roomCode}/hint`, body)
      : await api("/api/hint", { sessionId: sid, ...body });
    points = r.points ?? points;
    if (!inRoom) {                 // 房间里提示由推送画出来，这里不重复
      hintsUsed = r.hintsUsed; quote = r.next;
      note(r.hint, "hint", t.hintTag);
    }
    closeChooser();
    paintPurse(r.paid === "points");
    return true;
  } catch (err) {
    if (err.message === "session_expired") { closeChooser(); note(t.expired, "err"); await start(puzzle?.id); }
    else if (await roomErrorHandled(err)) { /* 已处理 */ }
    else if (err.message === "not_enough_points") { points = err.data.points ?? points; note(t.notEnough(CONFIG.hintCost, CONFIG.pointsPerSolve), "err"); paintChooser(); }
    else if (err.message === "ad_not_finished") throw err;
    else if (err.message.startsWith("ad_")) { closeChooser(); note(t.adFailed, "err"); }
    else if (err.message !== "game_over") { closeChooser(); note(t.netErr, "err"); }
    return false;
  } finally {
    paintHint(); paintPurse();
  }
}

/* ---- 选择面板（只在开了广告时用） ---- */
function openChooser() {
  closeLobby();
  $("dock").classList.add("choosing");
  paintChooser();
  prepareAd();
  $("chooseCancel").focus();
}
function closeChooser() { $("dock").classList.remove("choosing"); }
$("chooseCancel").onclick = closeChooser;

function paintChooser() {
  const cost = CONFIG.hintCost;
  $("chooseTitle").textContent = t.chooseTitle(hintsUsed + 1);
  $("chooseLine").textContent = adsOn() ? t.chooseLine : t.chooseLineNoAds;
  $("payAd").hidden = !adsOn();
  $("adsNote").hidden = !adsOn();
  const enough = points >= cost;
  $("payPoints").disabled = !enough;
  $("payPoints").textContent = enough ? t.payPoints(cost, points) : t.notEnough(cost, CONFIG.pointsPerSolve);
  $("payPoints").classList.toggle("primary", !adsOn() && enough);
}
$("payPoints").onclick = () => takeHint({ pay: "points" });

/* ---- Google 激励广告（H5 Games Ads）。现在没开：不设 ADSENSE_CLIENT / ADS_MOCK 就不会加载。
   流程：打开选择面板时问 Google 有没有广告（beforeReward 被调用 = 有）；
   点「看一段广告」→ 先领服务端票据 → 播广告 → adViewed → 拿票据换提示。 */
let adShow = null, adTicket = null, adTicketAt = 0;
const adsOn = () => mode === "solo" && !!(CONFIG.ads && (CONFIG.ads.client || CONFIG.ads.mock));

function setupAds() {
  const a = CONFIG.ads || {};
  if (a.mock) { window.adBreak = mockAdBreak; return; }
  if (!a.client) return;
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); };
  const el = document.createElement("script");
  el.async = true;
  el.crossOrigin = "anonymous";
  el.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(a.client);
  if (a.test) el.setAttribute("data-adbreak-test", "on");
  document.head.append(el);
  window.adConfig({ preloadAdBreaks: "on", sound: "off" });
}

function paintAdButton(state) {
  $("payAd").disabled = state !== "ready";
  $("payAdLabel").textContent = state === "ready" ? t.payAd : state === "loading" ? t.adLoading : t.adNone;
}

function prepareAd() {
  adShow = null;
  if (!adsOn() || typeof window.adBreak !== "function") return paintAdButton("none");
  paintAdButton("loading");
  let offered = false;
  window.adBreak({
    type: "reward",
    name: "hint",
    beforeAd: () => {},
    afterAd: () => {},
    beforeReward: (showAdFn) => { offered = true; adShow = showAdFn; paintAdButton("ready"); },
    adDismissed: () => { adTicket = null; closeChooser(); note(t.adDismissed, "err"); },
    adViewed: () => claimAdHint(),
    adBreakDone: () => { if (!offered) paintAdButton("none"); }
  });
}

$("payAd").onclick = async () => {
  if (!adShow) return;
  try {
    const r = await api("/api/ad/ticket", { sessionId: sid });
    adTicket = r.ticket; adTicketAt = Date.now();
  } catch (err) {
    closeChooser(); note(err.message === "session_expired" ? t.expired : t.netErr, "err");
    return;
  }
  const show = adShow; adShow = null;
  show();
};

async function claimAdHint() {
  if (!adTicket) return;
  const ticket = adTicket;
  try {
    await takeHint({ pay: "ad", ticket });
  } catch (err) {
    // 广告比服务端要求的最短时间还短：等到时间够了再领一次
    const wait = Math.max(0, (CONFIG.adMinSeconds || 5) * 1000 + 300 - (Date.now() - adTicketAt));
    await new Promise(r => setTimeout(r, wait));
    try { await takeHint({ pay: "ad", ticket }); }
    catch { closeChooser(); note(t.adFailed, "err"); }
  } finally {
    adTicket = null;
  }
}

/* 本地模拟广告：不连 Google，走一遍同样的回调。只在 ADS_MOCK=1 时启用。 */
function mockAdBreak(o) {
  if (o.type !== "reward") { o.adBreakDone?.({ breakStatus: "notReady" }); return; }
  setTimeout(() => o.beforeReward?.(() => {
    o.beforeAd?.();
    const wrap = document.createElement("div");
    wrap.className = "mock-ad";
    wrap.innerHTML = `<div class="box"><div></div><div class="big"></div><div class="wait"></div><button type="button"></button></div>`;
    const [label, big, wait, btn] = [wrap.querySelector(".box > div"), wrap.querySelector(".big"), wrap.querySelector(".wait"), wrap.querySelector("button")];
    label.textContent = t.mockAd;
    let left = 6, done = false;
    const end = (viewed) => {
      if (done) return; done = true; clearInterval(timer); wrap.remove();
      o.afterAd?.();
      viewed ? o.adViewed?.() : o.adDismissed?.();
      o.adBreakDone?.({ breakStatus: viewed ? "viewed" : "dismissed" });
    };
    const tick = () => {
      big.textContent = left;
      wait.textContent = left > 0 ? t.mockWait(left) : "";
      btn.textContent = left > 0 ? t.mockClose : t.mockClaim;
      left--;
    };
    tick();
    const timer = setInterval(() => { if (left < 0) return clearInterval(timer); tick(); }, 1000);
    btn.onclick = () => end(left < 0);
    document.body.append(wrap);
    btn.focus();
  }), 300);
}

/* ================= 揭晓：点两次，防误触 ================= */
let armTimer = null;
function armGiveup(on) {
  clearTimeout(armTimer);
  $("giveup").classList.toggle("confirm", on);
  $("giveupLabel").textContent = on ? t.giveupConfirm : t.giveup;
  if (on) armTimer = setTimeout(() => { armGiveup(false); paintRoomUi(); }, 3000);
}
$("giveup").onclick = async () => {
  if (over) return;
  if (!$("giveup").classList.contains("confirm")) return armGiveup(true);
  armGiveup(false);
  try {
    if (mode === "room") { await api(`/api/room/${roomCode}/giveup`); return; }   // 结果由推送画
    const r = await api("/api/giveup", { sessionId: sid });
    const fresh = (r.reveal || []).filter(x => !revealed.has(x.i));
    uncover(fresh, 160);
    asked = r.asked;
    finish(false, fresh.length * 160 + 400);
  } catch (err) {
    if (err.message === "session_expired") { note(t.expired, "err"); await start(puzzle?.id); }
    else if (!(await roomErrorHandled(err))) note(t.netErr, "err");
  }
};

/* ================= 结束（单人） ================= */
function finish(didSolve, delay, earned = 0) {
  over = true; solved = didSolve;
  closeChooser();
  $("input").disabled = true;
  $("send").disabled = true;
  $("head").classList.remove("compact"); paintFold();
  $("resultTitle").textContent = didSolve ? t.solvedTitle : t.gaveTitle;
  $("resultLine").textContent = didSolve
    ? t.solvedLine(asked, hintsUsed) + (earned ? t.earned(earned, points) : solvedBefore ? t.solvedBefore : "")
    : t.gaveLine(asked);
  $("shareLabel").textContent = t.share;
  paintHint(); paintRoomUi();
  setTimeout(() => {
    $("dock").classList.add("done");
    $("head").scrollTop = 0;
    requestAnimationFrame(scrollLog);
    if (earned) paintPurse(true);
  }, Math.min(delay, 1400));
}

$("share").onclick = async () => {
  const url = `${location.origin}/?p=${encodeURIComponent(puzzle.id)}`;
  const n = mode === "room" ? roomAsked : asked;
  const text = t.shareText(n, seq.join(""), solved, url);
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); $("shareLabel").textContent = t.shared; }
  } catch (_) { /* 用户取消分享 */ }
};
$("next").onclick = async () => {
  if (mode === "room") {
    try { await api(`/api/room/${roomCode}/next`); } catch (err) { if (!(await roomErrorHandled(err))) note(t.netErr, "err"); }
    return;
  }
  start();   // 不指定题目，服务端发一道没做过的
};

/* ================= 开局 ================= */
async function boot() {
  paintStatic();
  try { CONFIG = await fetch("/api/config").then(r => r.json()); } catch { /* 用默认值 */ }
  setupAds();
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || "").replace(/\D/g, "");
  try {
    if (room) {
      await start();             // 先有个能玩的界面，同时确保有玩家 cookie
      const saved = store.get("hg_nick");
      if (saved) {
        try { await joinRoom(room, saved); return; }
        catch (err) {
          note({ room_not_found: t.roomNotFound, room_full: t.roomFull }[err.message] || t.netErr, "err");
          return;
        }
      }
      history.replaceState(null, "", `?room=${room}`);   // 刷新后还记得要进哪个房间
      openLobby(room, t.lobbyJoinLine(room));
      return;
    }
    await start(params.get("p") || undefined);
  } catch {
    $("scene").textContent = t.bootErr;
    $("input").disabled = true;
    $("send").disabled = true;
  }
}

boot();
