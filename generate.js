// npm run generate -- [数量]
//
// 离线生成谜题，逐个跑验证，只把活下来的写进 pool.json。
// 不在玩家的请求路径上——这是整个设计的关键。
//
// 验证有三关：
//   1. 结构检查（纯代码，免费）
//   2. 题面诚实性（一次模型调用）—— 题面里有没有假话
//   3. 模拟对局（约 12 次调用）—— 让模型真的去玩，看能不能收敛
//
// 第 3 关是质量线第 3 条的自动化版本，也是最贵的一关，所以放最后。

import { readFile, writeFile } from "node:fs/promises";
import { anthropic, MODEL, adjudicate, reportAuth, extractText } from "./adjudicator.js";
import { STANDARD, critique } from "./standards.js";
import { simulate } from "./simulate.js";
import { PUZZLES } from "./puzzles.js";

const POOL_PATH = new URL("./pool.json", import.meta.url);
const WANT = Number(process.argv[2] || 5);

/* ---------- 反套路：强制换杠杆和题材 ---------- */
// 不给约束的话模型会反复产出「死去的妻子 / 镜子 / 盲人 / 双胞胎」。
// 手写题库里实际用出效果的手法。「数量错位」我试了七八次都没写成可解的题，删了。
const LEVERS = [
  "省略主语——题面从头到尾不出现「谁」，读者会自动补一个错的主语",
  "时间错位——读者默认事件是当下发生的，实际早已结束",
  "场所错位——读者默认人在做某件事，其实只是人在某个地方",
  "意图错位——行为看起来是坏事或怪事，目的其实相反",
  "受众错位——读者默认某样东西是给甲看的，实际是给乙看的",
  "功能错位——一样东西在这里不是它通常的用途",
  "视野错位——题面描述的是某个观察者看到的，而他看不到全部",
  "痕迹错位——某样东西上留下的痕迹暴露了被隐瞒的事",
  "增量错位——读者在找少了什么，关键其实是多了什么",
  "归因错位——读者以为问题出在人身上，其实出在环境上",
  "时序错位——读者默认事件的先后顺序，实际顺序不同",
  "尺度错位——读者默认的大小、速度或距离是错的",
  "观测反身——观察这件事本身改变了被观察的对象",
  "听觉线索——判断依据是声音，而不是看到的东西",
  "测量错位——数字是推算出来的，不是直接量出来的",
  "默契错位——双方都知道，但都假装不知道",
  "亲属称谓——中文称谓本身携带的血缘或姓氏信息是关键",
  "量词——中文量词透露了对象的性质或数量"
];
const SETTINGS = [
  "医院或诊所", "出租车或网约车", "老旧居民楼", "便利店夜班",
  "长途火车", "小学门口", "殡仪馆", "健身房", "菜市场",
  "写字楼电梯", "海边渔村", "汽修厂", "图书馆", "澡堂"
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- 生成 ---------- */
const GEN_PROMPT = `你在为一个中文海龟汤游戏创作原创谜题。

海龟汤规则：玩家只看到【汤面】，通过是非问句向主持人提问，逐步推出【汤底】。

这是出题标准，每一条都要满足：

${STANDARD}

绝对要求（违反其一即作废）：
1. 汤面里不能有任何假陈述。误导只能来自读者的预设，不能来自你撒谎。
   汤面的每一句话，在汤底成立的前提下，都必须字面为真。
2. 汤面不超过 60 字。
3. 汤底的每个环节都必须能被是非问句问出来。不要靠谐音、拆字或字谜。
4. 不要写以自杀方式为谜底的题，也不要让汤底落在「他是怎么自杀的」上。
5. 不要用这些烂大街的套路：死去的妻子、镜子里的人、盲人、双胞胎、
   梦境、机器人、时间循环、其实是动物。
   也不要用这三个结构（题库里已经太多了）：
   「其实他是被雇来做某事的」「其实他是这里的员工」「留一份东西给不会回来的人」。

facts 是主持人裁定时的唯一依据，必须写足 8 条以上，并且**必须包含否定事实**
（例如「不涉及超自然」「没有人被胁迫」「没有人认错人」）。
不写否定事实的话，玩家一探这些方向主持人就会自己编。

keys 是玩家必须想到的 3 个认知，不是故事里的事件。

只输出这个 JSON，不要有任何其他文字：
{
  "id": "英文小写连字符短 id",
  "broth": "清汤或红汤",
  "genre": "本格",
  "difficulty": 2到4的整数,
  "scene": "汤面",
  "reveal": [
    {"key": "k1", "text": "汤底的第一段，对应关键点 k1"},
    {"key": "k2", "text": "第二段"},
    {"key": "k3", "text": "第三段"},
    {"key": null, "text": "（可选）结局，玩家通关时才揭开"}
  ],
  "facts": ["...", "..."],
  "twist": "其实……（一句话的反转）",
  "hooks": [{"unknown":"汤底里玩家必须知道的一件事","hook":"汤面里牵向它的原词","question":"这个钩子支撑的二分型是非问句"}],
  "core": "一句话：玩家说出这个意思就算通关",
  "coreKeys": ["想明白了就算懂了的那一两个关键点 id"],
  "keys": [{"id":"k1","need":"..."},{"id":"k2","need":"..."},{"id":"k3","need":"..."}],
  "hints": ["第一条提示，指向 k1", "第二条提示，指向 k2"]
}

reveal 是汤底本身，切成几段：玩家每想到一个关键点，页面上就揭开对应的那一段。
- 每个关键点至少对应一段；几段按顺序连起来读，就是完整、通顺的汤底
- 段落要能单独揭开——只揭开 k2 那一段时，玩家读到的不能是半句没头没尾的话
- 最后一段可以不对应任何关键点（key 写 null），作为通关时才揭开的结局，
  这正是标准里说的「汤底最后一句是结局，不是说明书」

hooks 是你按标准第 2、3 条自查的结果：汤底里每个未知都要列一条，
hook 必须是汤面上原样出现的词。列不出来的未知，说明这碗汤不合格——改汤面或者删掉那个未知，
不要硬填。

core 和 coreKeys 决定玩家什么时候通关，写的时候想清楚：
- core 是这道题真正的「啊哈」，一句话，不含解释性细节
- coreKeys 只放构成「啊哈」的关键点，通常 1 个、最多 2 个；
  「谁付的钱」「店员知不知道」这类解释性的关键点不要放进去`;

async function generate() {
  const lever = pick(LEVERS);
  const setting = pick(SETTINGS);
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,   // 生成整道题 + 思考预算
    system: GEN_PROMPT,
    messages: [{
      role: "user",
      content: `出一道新题。\n本题必须使用这个手法：${lever}\n场景设定在：${setting}\n只输出 JSON。`
    }]
  });
  const text = extractText(res, "generate");
  const o = text.indexOf("{"), c = text.lastIndexOf("}");
  if (o === -1) throw new Error("生成结果里没有 JSON：" + text.slice(0, 200));
  const p = JSON.parse(text.slice(o, c + 1));
  p.locale = "zh";
  // 汤底以 reveal 为准，solution 由它拼出来，两处不会对不上
  if (Array.isArray(p.reveal)) p.solution = p.reveal.map((x) => x.text).join("");
  p.lever = lever.split("——")[0];
  p.generated = true;
  return p;
}

/* ---------- 第 1 关：结构 ---------- */
function checkStructure(p) {
  const bad = [];
  const len = [...(p.scene || "")].length;
  if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) bad.push("id 不合法");
  if (!p.scene || len > 60) bad.push(`汤面 ${len} 字，超过 60`);
  if (!p.solution) bad.push("没有汤底");
  const kids = (p.keys || []).map((k) => k.id);
  if (!Array.isArray(p.reveal) || p.reveal.length < 2) bad.push("汤底没有分段（reveal）");
  else {
    if (p.reveal.some((x) => !x.text)) bad.push("有空的汤底段落");
    if (p.reveal.some((x) => x.key && !kids.includes(x.key))) bad.push("汤底段落指向不存在的关键点");
    const uncovered = kids.filter((k) => !p.reveal.some((x) => x.key === k));
    if (uncovered.length) bad.push(`关键点没有对应段落：${uncovered.join("、")}`);
  }
  if (!Array.isArray(p.facts) || p.facts.length < 8) bad.push(`facts 只有 ${p.facts?.length ?? 0} 条，少于 8`);
  if (!Array.isArray(p.keys) || p.keys.length < 3 || p.keys.length > 5) bad.push("keys 数量不在 3-5");
  if (!Array.isArray(p.hints) || p.hints.length < 2) bad.push("提示少于 2 条");
  if (!["清汤", "红汤"].includes(p.broth)) bad.push("broth 不合法");
  if (!p.core) bad.push("没有 core");
  if (!p.twist || !String(p.twist).startsWith("其实")) bad.push("没有「其实……」一句话反转");
  if (!Array.isArray(p.hooks) || !p.hooks.length) bad.push("没有 hooks 自查");
  else {
    const norm = (x) => String(x ?? "").replace(/[\s「」"“”'‘’，。、！？：；,.!?:;（）()]/g, "");
    const missing = p.hooks.filter(h => !h.hook || h.hook === "无" || !norm(p.scene).includes(norm(h.hook)));
    if (missing.length) bad.push(`自查里有未知没钩子：${missing.map(h => h.unknown).join("、")}`);
  }
  const keyIds = (p.keys || []).map(k => k.id);
  if (!Array.isArray(p.coreKeys) || !p.coreKeys.length) bad.push("没有 coreKeys");
  else if (!p.coreKeys.every(k => keyIds.includes(k))) bad.push("coreKeys 指向不存在的关键点");
  else if (p.coreKeys.length === keyIds.length) bad.push("coreKeys 等于全部关键点——那就没标，通关会太严");
  // 否定事实：facts 里至少要有几条是在排除可能性的
  const negatives = (p.facts || []).filter(f => /不|没有|无/.test(f)).length;
  if (negatives < 2) bad.push(`否定事实只有 ${negatives} 条，主持人会自己编`);
  return bad;
}

/* ---------- 第 2 关：出题标准审校 —— 见 standards.js ---------- */

/* ---------- 第 3 关：模拟对局 —— 见 simulate.js ---------- */

/* ---------- 主流程 ---------- */
reportAuth();

let pool = [];
try { pool = JSON.parse(await readFile(POOL_PATH, "utf8")); } catch { /* 首次运行 */ }
const taken = new Set([...PUZZLES.map(p => p.id), ...pool.map(p => p.id)]);

let kept = 0, tried = 0;
const MAX_TRIES = WANT * 4;   // 预期要扔掉大部分

while (kept < WANT && tried < MAX_TRIES) {
  tried++;
  process.stdout.write(`\n[${tried}] 生成… `);
  let p;
  try { p = await generate(); }
  catch (e) { console.log("✗ 生成失败:", e.message); continue; }

  if (taken.has(p.id)) p.id = `${p.id}-${Date.now().toString(36).slice(-4)}`;
  process.stdout.write(`「${p.scene.slice(0, 20)}…」\n`);

  const structural = checkStructure(p);
  if (structural.length) { console.log("   ✗ 结构:", structural.join("；")); continue; }
  console.log("   ✓ 结构");

  // 第 2 关：按出题标准逐条审——不信生成器自己填的 hooks，审校重新找一遍
  let review;
  try { review = await critique(p); }
  catch (e) { console.log("   ✗ 审校出错:", e.message); continue; }
  if (!review.pass) { console.log("   ✗ 不合标准:", review.fails.join("；")); continue; }
  console.log(`   ✓ 合标准：${review.twist}（预计 ${review.estQuestions ?? "?"} 问）`);
  if (review.warn) console.log("     ⚠ " + review.warn);

  process.stdout.write("   模拟对局…");
  const sim = await simulate(p);
  if (!sim.ok) { console.log(` ✗ ${sim.why}`); continue; }
  console.log(` ✓ ${sim.turns} 问${sim.solved ? "通关" : "命中全部关键点"}（${sim.hit}/${sim.total}），无关率 ${sim.mootRate}%`);

  p.verified = { turns: sim.turns, mootRate: sim.mootRate, at: new Date().toISOString() };
  pool.push(p);
  taken.add(p.id);
  kept++;
  console.log(`   ✓ 收录 ${p.id}`);
}

await writeFile(POOL_PATH, JSON.stringify(pool, null, 2) + "\n", "utf8");
console.log(`\n生成 ${tried} 题，通过 ${kept} 题，题池共 ${pool.length} 题。`);
if (kept < WANT) console.log(`（没凑够 ${WANT} 题，再跑一次即可——扔掉大部分是正常的。）`);
