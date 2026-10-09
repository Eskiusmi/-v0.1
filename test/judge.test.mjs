// 裁判在压力下的表现 —— 用假的 API，不花钱
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY ||= "test";
process.env.JUDGE_CONCURRENCY = "4";
process.env.JUDGE_QUEUE_SECONDS = "3";
process.env.JUDGE_BUDGET_SECONDS = "6";
const { anthropic, adjudicate, judgeGate } = await import("../adjudicator.js");
const { byId } = await import("../puzzles.js");
const P = byId("yi-zhi-shoutao");
const ok = { stop_reason: "end_turn", content: [{ type: "text", text: '{"verdict":"否","keys":[],"solved":false}' }] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const session = () => ({ hit: [], history: [] });

test("请求带上 effort low、可缓存的 system 块、不让 SDK 自己重试", async () => {
  let body, opts;
  anthropic.messages.create = async (b, o) => { body = b; opts = o; return ok; };
  await adjudicate(P, session(), "q");
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.equal(body.system[0].cache_control.type, "ephemeral");
  assert.match(body.system[1].text, /已命中/);
  assert.equal(opts.maxRetries, 0);
});

test("模型不认 effort → 自动剥掉重试，不算失败", async () => {
  const seen = [];
  anthropic.messages.create = async (b) => {
    seen.push(!!b.output_config);
    if (b.output_config) throw Object.assign(new Error("x"), { status: 400, error: { error: { message: "output_config.effort: not supported" } } });
    return ok;
  };
  const r = await adjudicate(P, session(), "q");
  assert.equal(r.degraded, undefined);
  assert.deepEqual(seen, [true, false]);
});

test("12 个人同时问、每次裁定 400ms：最多 4 个同时打出去，全部拿到答案", async () => {
  let inFlight = 0, peak = 0;
  anthropic.messages.create = async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await sleep(400);
    inFlight--;
    return ok;
  };
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => adjudicate(P, session(), "q" + i)));
  assert.equal(peak, 4);
  assert.ok(rs.every((r) => r.verdict === "否" && !r.degraded));
  assert.ok(Date.now() - t0 < 2500, `用了 ${Date.now() - t0}ms`);   // 3 轮 × 400ms，不是 12 × 400ms
});

test("上游被限流且要等很久 → 马上告诉玩家稍等，不陪着等", async () => {
  anthropic.messages.create = async () => {
    throw Object.assign(new Error("rate"), { status: 429, headers: { "retry-after": "30" } });
  };
  const t0 = Date.now();
  const r = await adjudicate(P, session(), "q");
  assert.equal(r.degraded, true); assert.equal(r.busy, true);
  assert.ok(Date.now() - t0 < 500);
});

test("排队太久 → 不调 API，直接返回稍等", async () => {
  anthropic.messages.create = async () => { await sleep(5000); return ok; };
  const slow = Array.from({ length: 4 }, () => adjudicate(P, session(), "slow"));
  await sleep(50);
  const t0 = Date.now();
  const r = await adjudicate(P, session(), "排在后面的");
  assert.equal(r.busy, true);
  assert.ok(Date.now() - t0 < 3600);
  await Promise.all(slow);
  assert.equal(judgeGate.stats().active, 0);
});

test("历史只带最近 30 问", async () => {
  let n;
  anthropic.messages.create = async (b) => { n = b.messages.length; return ok; };
  const s = { hit: [], history: Array.from({ length: 50 }, (_, i) => ({ q: "q" + i, verdict: "否" })) };
  await adjudicate(P, s, "最新");
  assert.equal(n, 61);   // 30 问 × 2 + 当前这一问
});
