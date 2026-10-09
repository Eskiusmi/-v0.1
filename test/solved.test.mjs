// 通关规则的单元测试 —— 不打 API
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ANTHROPIC_API_KEY ||= "test";
const { decideSolved } = await import("../adjudicator.js");

const glove = { keys: [{ id: "k1" }, { id: "k2" }, { id: "k3" }], coreKeys: ["k2"] };
const noCore = { keys: [{ id: "k1" }, { id: "k2" }, { id: "k3" }] };
const out = (verdict, keys, extra = {}) => ({ verdict, keys, touched: keys, solved: false, ...extra });

test("模型判通关就通关", () => {
  assert.equal(decideSolved(glove, [], out("否", [], { solved: true })), true);
});

test("答「是」且触到核心关键点 → 通关（你报的那个情况）", () => {
  assert.equal(decideSolved(glove, [], out("是", ["k1", "k2"])), true);   // 他失去了一只手吗？
  assert.equal(decideSolved(glove, [], out("是", ["k2"])), true);         // 他是残疾人，只有一只手
});

test("只触到辅助关键点不通关", () => {
  assert.equal(decideSolved(glove, [], out("是", ["k1"])), false);        // 他只需要一只手套吗？
  assert.equal(decideSolved(glove, [], out("是", ["k3"])), false);        // 店员认识他吗？
});

test("答「否」时即使触到核心也不通关", () => {
  assert.equal(decideSolved(glove, [], out("否", ["k2"])), false);
});

test("核心早就命中过，后面随便一句「是」不能触发通关", () => {
  // k2 之前在一个「否」里被记下了；现在问店员，答「是」，只触到 k3
  assert.equal(decideSolved(glove, ["k2"], out("是", ["k3"])), false);
});

test("核心早就命中过，再次说出核心 → 通关", () => {
  // keys（新增）为空，但 touched 里有 k2
  assert.equal(decideSolved(glove, ["k2"], { verdict: "是", keys: [], touched: ["k2"], solved: false }), true);
});

test("没标 coreKeys = 全部关键点都要", () => {
  assert.equal(decideSolved(noCore, [], out("是", ["k2"])), false);
  assert.equal(decideSolved(noCore, ["k1", "k3"], out("是", ["k2"])), true);
});

test("清晰度条到 100% 且这一问答「是」→ 通关", () => {
  assert.equal(decideSolved(noCore, ["k1", "k2"], out("是", ["k3"])), true);
});

test("降级结果永远不通关", () => {
  assert.equal(decideSolved(glove, [], { verdict: "无关", keys: [], touched: [], solved: false, degraded: true }), false);
});
