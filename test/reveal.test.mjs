// 汤底分段揭开 —— 纯逻辑，不打 API
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY ||= "test";
const { normalizePuzzle, revealShape, visibleIndexes, revealDiff } = await import("../reveal.js");
const { PUZZLES, publicView, byId } = await import("../puzzles.js");

const glove = () => byId("yi-zhi-shoutao");

test("33 道题都有分段，solution 由分段拼成", () => {
  assert.equal(PUZZLES.length >= 33, true);
  for (const p of PUZZLES) {
    assert.ok(p.reveal.length >= 2, p.id);
    assert.equal(p.solution, p.reveal.map((s) => s.text).join(""), p.id);
  }
});

test("每个关键点都至少对应一段，段落的 key 都真实存在", () => {
  for (const p of PUZZLES) {
    const ids = p.keys.map((k) => k.id);
    for (const s of p.reveal) if (s.key) assert.ok(ids.includes(s.key), `${p.id} 的段落指向不存在的 ${s.key}`);
    for (const k of ids) assert.ok(p.reveal.some((s) => s.key === k), `${p.id} 的 ${k} 没有对应段落`);
  }
});

test("开局下发的只有形状：长度、标点一致，没有任何真文字", () => {
  for (const p of PUZZLES) {
    const v = publicView(p);
    // 题面本来就公开，去掉题面后再查
    const json = JSON.stringify({ ...v, scene: "" });
    for (const s of p.reveal) {
      // 汤底里任何连续 4 个以上的汉字片段都不该出现在下发内容里（题面里本来就有的除外）
      const chunks = (s.text.match(/[一-鿿]{4,}/g) || []).filter((c) => !p.scene.includes(c));
      for (const c of chunks) assert.ok(!json.includes(c), `${p.id} 泄露了「${c}」`);
    }
    v.reveal.forEach((r, i) => assert.equal([...r.shape].length, [...p.reveal[i].text].length, p.id));
    assert.ok(!("solution" in v) && !("core" in v) && !("coreKeys" in v));
  }
});

test("形状保留标点", () => {
  const [seg] = revealShape({ reveal: [{ key: "k1", text: "他的右手，失去了。" }] });
  assert.equal(seg.shape, "□□□□，□□□。");
});

test("命中关键点只揭开对应的段，结局段要等通关", () => {
  const p = glove();   // k2, k1, k3, (结局)
  assert.deepEqual(visibleIndexes(p, ["k2"]), [0]);
  assert.deepEqual(visibleIndexes(p, ["k1", "k2", "k3"]), [0, 1, 2]);
  assert.deepEqual(visibleIndexes(p, ["k1", "k2", "k3"], true), [0, 1, 2, 3]);
});

test("revealDiff 只发新揭开的段，带真文字", () => {
  const p = glove();
  assert.deepEqual(revealDiff(p, [], ["k2"]), [{ i: 0, text: p.reveal[0].text }]);
  assert.deepEqual(revealDiff(p, ["k2"], ["k2"]), []);
  // 通关：补齐剩下的全部，已经揭开的不重复发
  assert.deepEqual(revealDiff(p, ["k2"], ["k2"], true).map((r) => r.i), [1, 2, 3]);
  // 放弃：before 为空、all=true → 全部
  assert.deepEqual(revealDiff(p, [], [], true).map((r) => r.i), [0, 1, 2, 3]);
});

test("没写 reveal 的生成题：关键点当段落，整句汤底作为最后一段", () => {
  const p = normalizePuzzle({ solution: "整句汤底。", keys: [{ id: "k1", need: "第一点。" }, { id: "k2", need: "第二点。" }] });
  assert.deepEqual(p.reveal.map((s) => s.key), ["k1", "k2", null]);
  assert.equal(p.solution, "整句汤底。");
});
