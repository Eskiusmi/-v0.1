// 审校的容错：截断、思考吃光预算、半截 JSON —— 用假客户端模拟，不打 API
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY ||= "test";
const { anthropic } = await import("../adjudicator.js");
const { critique } = await import("../standards.js");

const p = { scene: "他每天给妻子写一封信，投进自己家的信箱。", solution: "汤底", core: "核心" };
const ok = JSON.stringify({
  twist: "其实……", oneLine: true, oneFlip: true, honest: true, safe: true, estQuestions: 6,
  unknowns: [{ what: "x", hook: "投进自己家的信箱", question: "q", bisects: true }],
  decoration: [], coreDecoration: [], idleWords: []
});
const reply = (text, stop = "end_turn", thinking = false) => ({
  stop_reason: stop,
  content: [...(thinking ? [{ type: "thinking", thinking: "" }] : []), ...(text ? [{ type: "text", text }] : [])]
});
function stub(...responses) {
  let i = 0;
  anthropic.messages.create = async () => responses[Math.min(i++, responses.length - 1)];
  return () => i;
}

test("思考吃光预算（你遇到的 22 道）→ 重试一次后成功", async () => {
  const calls = stub(reply("", "max_tokens", true), reply(ok));
  const r = await critique(p);
  assert.equal(r.pass, true);
  assert.equal(calls(), 2);
});

test("JSON 被截断一半（你遇到的 3 道）→ 不拿半截去解析，重试", async () => {
  const calls = stub(reply(ok.slice(0, 120), "max_tokens"), reply(ok));
  const r = await critique(p);
  assert.equal(r.pass, true);
  assert.equal(calls(), 2);
});

test("两次都失败 → 抛错，不会假装通过", async () => {
  stub(reply("", "max_tokens", true));
  await assert.rejects(() => critique(p), /截断/);
});

test("审校把核心送进去了", async () => {
  let sent = "";
  anthropic.messages.create = async (req) => { sent = req.messages[0].content; return reply(ok); };
  await critique({ ...p, core: "妻子认不出他" });
  assert.ok(sent.includes("【核心】妻子认不出他"));
});
