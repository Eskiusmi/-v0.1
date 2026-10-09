// 模拟对局：让一个便宜模型当玩家，真的用是非问句去玩，裁判用线上同一个。
// 生成器的第 3 关和审计的 --sim 都用它。「十问以内盘完」靠这里实测，不靠审校估。

import { anthropic, adjudicate, extractText } from "./adjudicator.js";

const SOLVER_MODEL = process.env.SOLVER_MODEL || "claude-haiku-4-5-20251001";
const MAX_SIM_TURNS = Number(process.env.SIM_TURNS || 10);

export async function simulate(p) {
  const session = { hit: [], history: [] };
  const asked = [];
  let solved = false;

  for (let turn = 0; turn < MAX_SIM_TURNS; turn++) {
    const res = await anthropic.messages.create({
      model: SOLVER_MODEL,
      max_tokens: 1500,   // 只要一个问题，但思考也占预算
      system: `你在玩海龟汤，只能提是非问句。目标是尽快推出汤底。
根据已有的问答缩小范围，不要重复问过的方向。只输出你的下一个问题，不要有其他文字。`,
      messages: [{
        role: "user",
        content: `汤面：${p.scene}\n\n已问：\n${
          asked.length ? asked.map((a, i) => `${i + 1}. ${a.q} → ${a.v}`).join("\n") : "（还没问）"
        }\n\n你的下一个问题：`
      }]
    });
    const q = extractText(res, "solver").trim().slice(0, 100);
    if (!q) break;

    const out = await adjudicate(p, session, q);
    if (out.degraded) return { ok: false, why: "模拟时裁判降级了" };
    if (out.verdict !== "换个问法") {
      session.history.push({ q, verdict: out.verdict });
      session.hit.push(...out.keys);
    }
    asked.push({ q, v: out.verdict });
    if (out.solved) { solved = true; break; }
    if (session.hit.length >= p.keys.length) break;
  }

  const mootRate = asked.filter(a => a.v === "无关").length / Math.max(1, asked.length);
  return {
    ok: (solved || session.hit.length >= p.keys.length) && mootRate < 0.6,
    hit: session.hit.length,
    total: p.keys.length,
    turns: asked.length,
    mootRate: Math.round(mootRate * 100),
    solved,
    why: !solved && session.hit.length < p.keys.length
      ? `${MAX_SIM_TURNS} 问没通关，只命中 ${session.hit.length}/${p.keys.length}`
      : `无关率 ${Math.round(mootRate * 100)}% 过高，facts 太薄`
  };
}

