// 出题标准。来自 2026-09-09「海龟汤创意写作指南」那次讨论。
//
// 生成器（generate.js）写题时照着它写，审校（critique）按它逐条判，
// 审计（audit.js）拿它去查已有题库。三处用的是同一份文本，改这里就全改。

import { anthropic, MODEL, extractText } from "./adjudicator.js";

export const STANDARD = `【三条判定】——任何一条不过，这碗汤就不能用
1. 一句话说完「其实……」：汤底的反转能用一句「其实……」讲完。
   需要两句，说明有两个反转，应该拆成两道题或者删掉一个。
2. 每个未知都有钩子：汤底里玩家必须知道的每一件事，汤面上都要有一个词把玩家
   往那里牵。没有钩子的未知（某个具体身份、某个具体地点、某个具体行为），
   玩家只能穷举，那不是推理，是二十问。
3. 每个钩子能二分：钩子要能支撑一个「能排除一半可能」的是非问句，
   而不是只把玩家引向一个大方向。「是在给人发信号吗→是」没有排除任何具体答案，
   这种钩子不算。整碗汤要能在十问以内盘完。

【写作手法】
- 只翻转一个前提：不是人的「人」、不是那个地方的「地方」、不是现在的「现在」。
- 汤面用日常词，汤底用日常词的第二义。不堆「血、尸体、诡异」这类形容词，
  恐怖和心酸来自读者自己的脑补。
- 汤面每个词都要被汤底用上。没有闲字。
- 留一个入口：汤面里一个略不自然的词——不是错误，只是「为什么用这个词」，
  敏锐的玩家会咬住它。
- 装饰不是谜底：故事里舍不得删的细节（具体是女儿、在写作业、哪栋楼）
  不能出现在【核心】里让玩家去猜。汤底揭晓时可以留少量叙事细节，但能删就删。
- 汤底最后一句是结局，不是说明书。

【流程】先想谜底，再倒推汤面，再在脑子里模拟十问。走不通就扔掉。`;

// 审校：逐条判三条判定 + 诚实 + 内容安全。
// 对照【核心】审：只有玩家通关必须知道的事才需要钩子——通关只看核心，
// 汤底里多出来的叙事细节玩家不需要猜，只报出来提醒，不卡。
// 不依赖题目自带的 hooks 字段，自己从汤面里找，这样也能审手写题库。
const CRITIC_SYSTEM = `你在审一道中文海龟汤，标准如下：

${STANDARD}

另外两条底线：
- 诚实：在汤底成立的前提下，汤面每一句都必须字面为真。误导读者可以，陈述假事实不行。
- 内容红线：汤底不能落在自杀方式上；不能涉及未成年人的性内容或虐待；
  不能是种族、民族、宗教的刻板印象。

重要：玩家说出【核心】就算通关，不需要说出整个汤底。所以——
- 「未知」只列玩家要说出【核心】必须知道的事。汤底里其余的叙事细节（具体楼层、
  具体年数、谁付的钱、具体哪一侧）不算未知，列到 decoration 里。
- 「几问能盘完」也是估到说出【核心】为止。

请按这个顺序做：
1. 用一句「其实……」写出这碗汤的反转。写不成一句就如实说。
2. 列出玩家要说出【核心】必须知道的每一个未知。
3. 对每个未知，在汤面里找钩子——必须是汤面上原本就有的词，原样引用；找不到就写「无」。
4. 对每个钩子，写一个它能支撑的二分型是非问句，并判断它能不能排除大约一半的可能。
5. 估一下一个认真的玩家几问能说出【核心】。

只输出 JSON。字符串里引用原文请用「」，不要用英文双引号：
{
  "twist": "其实……",
  "oneLine": true/false,
  "oneFlip": true/false,
  "unknowns": [{"what":"...","hook":"汤面原词或无","question":"...","bisects":true/false}],
  "decoration": ["汤底里不影响说出核心的叙事细节"],
  "coreDecoration": ["核心里本不该有的具体细节，比如某个具体身份、地点"],
  "idleWords": ["汤面里没被汤底用上的词"],
  "estQuestions": 数字,
  "honest": true/false,
  "safe": true/false,
  "why": "不通过的地方，具体到哪个词哪句话"
}`;

async function critiqueOnce(p) {
  const res = await anthropic.messages.create({
    model: MODEL,
    // 逐条分析很耗思考。3000 不够：思考把预算吃光，一个字都吐不出来。
    max_tokens: 16000,
    system: CRITIC_SYSTEM,
    messages: [{
      role: "user",
      content: `汤面：${p.scene}\n汤底：${p.solution}\n【核心】${p.core || p.solution}`
    }]
  });
  // 输出被截断时 text 可能非空但 JSON 只有半截，必须当失败处理
  if (res.stop_reason === "max_tokens") {
    throw new Error("审校输出被截断（max_tokens）");
  }
  const t = extractText(res, "critique");
  const o = t.indexOf("{"), c = t.lastIndexOf("}");
  if (o === -1 || c === -1) throw new Error("审校没有返回 JSON");
  return JSON.parse(t.slice(o, c + 1));
}

export async function critique(p) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await critiqueOnce(p);
      return { ...r, ...verdictOf(r, p) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// 由代码按审校结果判通过与否，而不是让模型自己说「通过」——
// 和通关判定同一个思路：模型给事实，规则做决定。
export function verdictOf(r, p) {
  const fails = [];
  if (r.safe === false) fails.push("内容红线");
  if (r.honest === false) fails.push("题面有假话");
  if (r.oneLine === false) fails.push("一句话说不完「其实」");
  if (r.oneFlip === false) fails.push("翻转不止一个前提");

  const unknowns = Array.isArray(r.unknowns) ? r.unknowns : [];
  // 钩子必须是汤面上原本就有的词。比对前去掉标点和空白，避免引号、逗号造成误判。
  const norm = (x) => String(x ?? "").replace(/[\s「」"“”'‘’，。、！？：；,.!?:;（）()]/g, "");
  const scene = norm(p?.scene);
  const noHook = unknowns.filter((u) => !u.hook || u.hook === "无" || (scene && !scene.includes(norm(u.hook))));
  if (noHook.length) fails.push(`没有钩子：${noHook.map((u) => u.what).join("、")}`);
  const noBisect = unknowns.filter((u) => u.hook && u.hook !== "无" && u.bisects === false);
  if (noBisect.length) fails.push(`钩子不能二分：${noBisect.map((u) => u.hook).join("、")}`);

  if (Array.isArray(r.coreDecoration) && r.coreDecoration.length) {
    fails.push(`核心里有装饰：${r.coreDecoration.join("、")}`);
  }

  // 以下只提示不卡：
  // - 汤底里的叙事细节不影响通关（通关只看核心）
  // - 问数是审校估的，不可靠（上次审出来清一色 15、18）；十问靠模拟对局实测
  // - 闲字的判断模型偏严，人看一眼更准
  const warns = [];
  if (Array.isArray(r.decoration) && r.decoration.length) warns.push(`汤底叙事细节：${r.decoration.join("、")}`);
  if (typeof r.estQuestions === "number" && r.estQuestions > 10) warns.push(`审校估 ${r.estQuestions} 问（仅参考，以模拟对局为准）`);
  if (Array.isArray(r.idleWords) && r.idleWords.length) warns.push(`可能的闲字：${r.idleWords.join("、")}`);
  const warn = warns.join("；");

  return { pass: fails.length === 0, fails, warn };
}
