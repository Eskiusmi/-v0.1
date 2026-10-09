// 导入校验 —— 纯逻辑，不打 API
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { parseLoose, extractCandidates, checkCandidate } = await import("../ingest.js");
const { publicView } = await import("../puzzles.js");

const raw = readFileSync(new URL("./fixtures/candidates.json", import.meta.url), "utf8");
const [good, rejected] = extractCandidates(parseLoose(raw));
const clone = () => structuredClone(good);
const errs = (c, ctx) => checkCandidate(c, ctx).errors || [];

test("按 prompt 格式写的候选能通过，并转成游戏能读的题", () => {
  const r = checkCandidate(good);
  assert.deepEqual(r.errors, []);
  assert.equal(r.puzzle.solution, "那个人是在下雪之前进的屋，进去的脚印早被雪盖住了。雪下了多久，他就在屋里待了多久，直到刚才。");
  assert.deepEqual(r.puzzle.edgeCases.length, 3);
  // 自检记录和汤底都不会下发给玩家
  const v = JSON.stringify(publicView(r.puzzle));
  assert.ok(!v.includes("直到刚才") && !v.includes("wrongReading") && !v.includes("小偷"));
});

test("模型自己淘汰的候选直接跳过", () => {
  assert.equal(checkCandidate(rejected).skipped, "女儿、对面楼全在台下");
});

test("带代码块和前后废话也能读", () => {
  const list = extractCandidates(parseLoose("好的，以下是结果：\n```json\n" + raw + "\n```\n希望有帮助"));
  assert.equal(list.length, 2);
});

test("直接给 puzzle 数组也能读", () => {
  const list = extractCandidates([good.puzzle]);
  assert.equal(list[0].verdict, "pass");
});

test("必须推到的条件来自补充 → 淘汰（台上原则）", () => {
  const c = clone(); c.conditions[1].source = "补充";
  assert.ok(errs(c).some((e) => e.includes("揭晓后补充")));
});

test("模拟盘汤超过 8 问 → 淘汰", () => {
  const c = clone();
  c.question_path = Array.from({ length: 9 }, (_, i) => ({ q: `问${i}`, a: "否", hits: i === 8 ? ["k1", "k2"] : [] }));
  assert.ok(errs(c).some((e) => e.includes("超过 8 问")));
});

test("回答用了「不是」「不重要」→ 淘汰（界面只有是/否/无关）", () => {
  const c = clone(); c.question_path[0].a = "不重要";
  assert.ok(errs(c).some((e) => e.includes("是/否/无关")));
});

test("有关键点在盘汤路径里没被问到 → 淘汰", () => {
  const c = clone(); c.question_path[4].hits = [];
  assert.ok(errs(c).some((e) => e.includes("没有一问触到：k2")));
});

test("关键点和 must_guess 条件对不上 → 淘汰", () => {
  const c = clone(); c.conditions[2].must_guess = false;
  assert.ok(errs(c).some((e) => e.includes("对不上")));
});

test("coreKeys 等于全部关键点 → 淘汰", () => {
  const c = clone(); c.puzzle.coreKeys = ["k1", "k2"];
  assert.ok(errs(c).some((e) => e.includes("太严")));
});

test("汤底段落：太短、没标点、关键点没段落、结局不在最后 → 各自淘汰", () => {
  let c = clone(); c.puzzle.reveal[1].text = "所以。";
  assert.ok(errs(c).some((e) => e.includes("太短")));
  c = clone(); c.puzzle.reveal[0].text = "那个人是在下雪之前进的屋";
  assert.ok(errs(c).some((e) => e.includes("标点结尾")));
  c = clone(); c.puzzle.reveal[1].key = "k1";
  assert.ok(errs(c).some((e) => e.includes("没有对应的汤底段落：k2")));
  c = clone(); c.puzzle.reveal.unshift({ key: null, text: "开头的结局。" });
  assert.ok(errs(c).some((e) => e.includes("结局")));
});

test("汤面和 surface 不一致、汤面太长 → 淘汰", () => {
  let c = clone(); c.puzzle.scene += "他报了警。";
  assert.ok(errs(c).some((e) => e.includes("不一致")));
  c = clone(); c.surface = c.puzzle.scene = "很".repeat(61) + "。";
  assert.ok(errs(c).some((e) => e.includes("超过 60")));
});

test("否定事实不足、提示泄露 core → 淘汰", () => {
  let c = clone(); c.puzzle.facts = c.puzzle.facts.map((f) => f.replace(/不|没|无|非|别/g, "也"));
  assert.ok(errs(c).some((e) => e.includes("否定事实")));
  c = clone(); c.puzzle.hints[1] = "那个人在下雪之前就已经在他家里了。";
  assert.ok(errs(c).some((e) => e.includes("提示里直接写出了 core")));
});

test("id 或汤面和已有题重复 → 淘汰", () => {
  const ctx = { ids: new Set(["xueye-jiaoyin"]), scenes: new Set() };
  assert.ok(errs(clone(), ctx).some((e) => e.includes("已经存在")));
});
