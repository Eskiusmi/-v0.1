// npm run import -- out.json            检查并把通过的题加进 pool.json
// npm run import -- out.json --dry      只检查，不写文件
// npm run import -- out.json --verify   再走一遍独立审校 + 模拟对局（要 API key）
// npm run import -- --used              列出已用的骨架，粘进 prompt 的 {{USED_LIST}}
//
// out.json 是模型按 prompts/generate-zh.md 输出的 JSON（带不带代码块都行）。

import { readFile, writeFile } from "node:fs/promises";
import { PUZZLES } from "./puzzles.js";
import { loadPool } from "./pool.js";
import { parseLoose, extractCandidates, checkCandidate } from "./ingest.js";

const POOL_PATH = new URL("./pool.json", import.meta.url);
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file = args.find((a) => !a.startsWith("--"));

await loadPool();

if (flags.has("--used")) {
  console.log("\n以下骨架已经用过，不要重复：");
  for (const p of PUZZLES) {
    const flip = String(p.lever || "").replace(/^翻转词：/, "");
    console.log(`- ${flip ? flip + "：" : ""}${p.scene.slice(0, 24)}${p.scene.length > 24 ? "……" : ""}`);
  }
  process.exit(0);
}

if (!file) {
  console.error("用法：npm run import -- 文件.json [--dry] [--verify]，或 npm run import -- --used");
  process.exit(1);
}

let candidates;
try {
  candidates = extractCandidates(parseLoose(await readFile(file, "utf8")));
} catch (e) {
  console.error(`读不了 ${file}：${e.message}`);
  process.exit(1);
}

const norm = (s) => String(s ?? "").replace(/[\p{P}\s]/gu, "");
const ctx = {
  ids: new Set(PUZZLES.map((p) => p.id)),
  scenes: new Set(PUZZLES.map((p) => norm(p.scene))),
  levers: new Set(PUZZLES.map((p) => String(p.lever || "")).filter(Boolean))
};

console.log(`\n${file}：${candidates.length} 个候选\n`);
const passed = [];
let skipped = 0;
for (const c of candidates) {
  const r = checkCandidate(c, ctx);
  if (r.skipped) { skipped++; console.log(`  ·  ${r.label}  模型已淘汰：${r.skipped}`); continue; }
  if (r.errors.length) {
    console.log(`  ✗  ${r.label}`);
    for (const e of r.errors) console.log(`       ${e}`);
  } else {
    console.log(`  ✓  ${r.label}  ${r.puzzle.twist}`);
    passed.push(r.puzzle);
    // 同一批里互相也不能重复
    ctx.ids.add(r.puzzle.id);
    ctx.scenes.add(norm(r.puzzle.scene));
    if (r.puzzle.lever) ctx.levers.add(r.puzzle.lever);
  }
  for (const w of r.warnings || []) console.log(`       ⚠ ${w}`);
}

let accepted = passed;
if (flags.has("--verify") && passed.length) {
  const { reportAuth } = await import("./adjudicator.js");
  const { critique } = await import("./standards.js");
  const { simulate } = await import("./simulate.js");
  reportAuth();
  console.log("\n独立审校 + 模拟对局：");
  accepted = [];
  for (const p of passed) {
    process.stdout.write(`  ${p.id.padEnd(24)}`);
    try {
      const r = await critique(p);
      if (!r.pass) { console.log(`✗ 审校：${r.fails.join("；")}`); continue; }
      const sim = await simulate(p);
      if (!sim.ok) { console.log(`✗ 模拟：${sim.why}`); continue; }
      p.verified = { turns: sim.turns, mootRate: sim.mootRate, at: new Date().toISOString() };
      accepted.push(p);
      console.log(`✓ ${sim.turns} 问${sim.solved ? "通关" : "命中全部关键点"}`);
    } catch (e) {
      console.log(`? 出错：${e.message}`);
    }
  }
}

console.log(`\n通过 ${accepted.length} · 不通过 ${candidates.length - skipped - passed.length + (passed.length - accepted.length)} · 模型自己淘汰 ${skipped}`);

if (!accepted.length) process.exit(0);
if (flags.has("--dry")) { console.log("（--dry：没有写入 pool.json）"); process.exit(0); }

let pool = [];
try { pool = JSON.parse(await readFile(POOL_PATH, "utf8")); } catch { /* 第一次导入 */ }
const at = new Date().toISOString();
pool.push(...accepted.map((p) => ({ ...p, importedAt: at })));
await writeFile(POOL_PATH, JSON.stringify(pool, null, 2) + "\n", "utf8");
console.log(`已加入 pool.json，题池共 ${pool.length} 道。打开扫一遍，无聊的删掉；重启服务后生效。`);
