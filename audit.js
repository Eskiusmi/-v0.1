// npm run audit                    审全部题（只审校，不模拟）
// npm run audit -- tangge          只审一道
// npm run audit -- --sim           审校通过的题，再真的模拟玩十问
// npm run audit -- tangge --sim
//
// 拿 standards.js 里的出题标准去审已有题库。只读不改：结果打出来，
// 删不删、改不改由你决定。

import { writeFile } from "node:fs/promises";
import { reportAuth } from "./adjudicator.js";
import { PUZZLES, byId } from "./puzzles.js";
import { critique } from "./standards.js";
import { simulate } from "./simulate.js";

reportAuth();
const args = process.argv.slice(2);
const withSim = args.includes("--sim");
const only = args.find((a) => !a.startsWith("--"));
const list = only ? [byId(only)].filter(Boolean) : PUZZLES;
if (!list.length) { console.error(`没有 ${only} 这道题`); process.exit(1); }

console.log(`\n按出题标准审 ${list.length} 道题${withSim ? "，通过的再模拟玩十问" : ""}…\n`);
const pad = " ".repeat(25);
const results = [];

for (const p of list) {
  process.stdout.write(`${p.id.padEnd(22)}`);
  let r;
  try {
    r = await critique(p);
  } catch (e) {
    results.push({ id: p.id, error: e.message });
    console.log(`?  审校出错：${e.message}`);
    continue;
  }
  console.log(r.pass ? `✓  ${r.twist}` : `✗  ${r.fails.join("；")}`);
  if (r.warn) console.log(pad + "⚠ " + r.warn);

  if (withSim && r.pass) {
    process.stdout.write(pad + "模拟十问… ");
    try {
      r.sim = await simulate(p);
      console.log(r.sim.ok
        ? `✓ ${r.sim.turns} 问${r.sim.solved ? "通关" : "命中全部关键点"}`
        : `✗ ${r.sim.why}`);
      if (!r.sim.ok) r.pass = false;
    } catch (e) {
      r.sim = { error: e.message };
      console.log(`? 模拟出错：${e.message}`);
    }
  }
  results.push({ id: p.id, scene: p.scene, ...r });
}

const passed = results.filter((r) => r.pass);
const failed = results.filter((r) => r.pass === false);
const errored = results.filter((r) => r.error);
console.log(`\n通过 ${passed.length} · 不通过 ${failed.length} · 出错 ${errored.length}`);

const reasons = {};
for (const r of failed) {
  for (const f of r.fails || []) {
    const k = f.split("：")[0];
    reasons[k] = (reasons[k] || 0) + 1;
  }
  if (r.sim && !r.sim.ok && !r.sim.error) reasons["模拟十问没盘完"] = (reasons["模拟十问没盘完"] || 0) + 1;
}
if (Object.keys(reasons).length) {
  console.log("\n不通过的原因：");
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);
}
if (errored.length) console.log(`\n${errored.length} 道审校出错，没审成。再跑一次 npm run audit -- <id> 单独补审。`);

await writeFile(new URL("./audit-report.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
console.log("\n完整结果写在 audit-report.json。审校是模型判的，会有误判——不通过的题先看理由再决定。");
