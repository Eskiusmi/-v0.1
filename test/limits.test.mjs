import { test } from "node:test";
import assert from "node:assert/strict";
const { createLimiter } = await import("../limits.js");
const { createGate } = await import("../gate.js");

test("限流按 key 分开：同一 IP 下的两个玩家互不影响", () => {
  const lim = createLimiter({ max: 2, refillMs: 1000, keyOf: () => null });
  assert.equal(lim.take("小明", 0), true);
  assert.equal(lim.take("小明", 0), true);
  assert.equal(lim.take("小明", 0), false);
  assert.equal(lim.take("阿花", 0), true);       // 小明用完了不影响阿花
  assert.equal(lim.take("小明", 1000), true);    // 一秒后回一个
});

test("闸门：超过上限的排队，前面的放出来后接上", async () => {
  const gate = createGate({ max: 2, queueTimeoutMs: 1000 });
  const r1 = await gate.acquire(); const r2 = await gate.acquire();
  let third = false;
  const p3 = gate.acquire().then((r) => { third = true; return r; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(third, false);
  assert.deepEqual(gate.stats(), { active: 2, queued: 1, max: 2 });
  r1();
  const r3 = await p3;
  assert.equal(third, true);
  r2(); r3();
  assert.equal(gate.stats().active, 0);
});

test("闸门：排队超时直接失败（不会一直挂着），release 重复调用无害", async () => {
  const gate = createGate({ max: 1, queueTimeoutMs: 50 });
  const r1 = await gate.acquire();
  await assert.rejects(gate.acquire(), /gate_timeout/);
  r1(); r1();
  assert.equal(gate.stats().active, 0);
});
