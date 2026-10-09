// 出题标准的判定规则 —— 不打 API，只测「模型给出审校结果之后，代码怎么判」
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY ||= "test";
const { verdictOf, STANDARD } = await import("../standards.js");

const scene = { scene: "他每天给妻子写一封信，投进自己家的信箱。每天晚上，妻子都把信读给他听。" };
const good = {
  twist: "其实妻子认不出他，以为信是年轻时的丈夫寄来的。",
  oneLine: true, oneFlip: true, honest: true, safe: true, estQuestions: 7,
  unknowns: [
    { what: "妻子不知道信是他写的", hook: "投进自己家的信箱", question: "妻子知道信是他写的吗？", bisects: true },
    { what: "妻子记忆有问题", hook: "读给他听", question: "妻子认得他是丈夫吗？", bisects: true }
  ],
  decoration: [], idleWords: []
};

test("标准文本包含三条判定", () => {
  for (const k of ["一句话说完", "每个未知都有钩子", "每个钩子能二分", "十问"]) assert.ok(STANDARD.includes(k), k);
});

test("全部满足 → 通过", () => {
  assert.equal(verdictOf(good, scene).pass, true);
});

test("「女儿」那种没有钩子的未知 → 不通过", () => {
  const r = { ...good, unknowns: [...good.unknowns, { what: "对方是他女儿", hook: "无", question: "是家人吗？", bisects: false }] };
  const v = verdictOf(r, scene);
  assert.equal(v.pass, false);
  assert.ok(v.fails.some((f) => f.includes("没有钩子")));
});

test("钩子是模型编的、汤面上根本没有 → 不通过", () => {
  const r = { ...good, unknowns: [{ what: "x", hook: "对面居民楼", question: "q", bisects: true }] };
  assert.equal(verdictOf(r, scene).pass, false);
});

test("钩子带引号或标点也能对上汤面", () => {
  const r = { ...good, unknowns: [{ what: "x", hook: "「投进自己家的信箱。」", question: "q", bisects: true }] };
  assert.equal(verdictOf(r, scene).pass, true);
});

test("钩子只能引导不能二分 → 不通过", () => {
  const r = { ...good, unknowns: [{ what: "x", hook: "读给他听", question: "是在传递信息吗？", bisects: false }] };
  assert.ok(verdictOf(r, scene).fails.some((f) => f.includes("不能二分")));
});

test("两个反转 → 不通过", () => {
  assert.equal(verdictOf({ ...good, oneFlip: false }, scene).pass, false);
});

test("核心里有装饰（「女儿」那种）→ 不通过", () => {
  const v = verdictOf({ ...good, coreDecoration: ["对方是他女儿"] }, scene);
  assert.equal(v.pass, false);
  assert.ok(v.fails.some((f) => f.includes("核心里有装饰")));
});

test("汤底里的叙事细节只警告不卡（通关只看核心）", () => {
  const v = verdictOf({ ...good, decoration: ["十二楼", "没打电话解释"] }, scene);
  assert.equal(v.pass, true);
  assert.ok(v.warn.includes("十二楼"));
});

test("审校估的问数只警告不卡（以模拟对局为准）", () => {
  const v = verdictOf({ ...good, estQuestions: 18 }, scene);
  assert.equal(v.pass, true);
  assert.ok(v.warn.includes("18"));
});

test("闲字只警告不卡", () => {
  const v = verdictOf({ ...good, idleWords: ["每天"] }, scene);
  assert.equal(v.pass, true);
  assert.ok(v.warn.includes("每天"));
});
