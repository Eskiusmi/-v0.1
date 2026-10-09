// 校验 AI 按 prompts/generate-zh.md 生成的 JSON，转成游戏能直接读的题。
//
// 能机械检查的规则都在这里查：prompt 里写了，模型也自检了，但模型会给自己放水。
// 查不了的（翻转词好不好、错解释自不自然、段落有没有剧透）留给 --verify 的独立审校和人。

import { normalizePuzzle } from "./reveal.js";

const VERDICTS = ["是", "否", "无关"];
const PUNCT = /[\p{P}\s]/gu;
const ENDS_WITH_PUNCT = /[\p{P}]$/u;
const NEGATIVE = /不|没|无|非|别/;
const strip = (s) => String(s ?? "").replace(PUNCT, "");
const len = (s) => [...String(s ?? "")].length;

// 接受三种形状：{ candidates: [...] }、候选数组、直接是 puzzle 数组
export function extractCandidates(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.candidates) ? json.candidates : null;
  if (!list) throw new Error("没找到 candidates 数组");
  return list.map((c) =>
    c && c.verdict === undefined && c.scene ? { verdict: "pass", puzzle: c } : c
  );
}

// 模型输出常带代码块或前后多余的话，取出 JSON 本体
export function parseLoose(text) {
  const t = String(text).replace(/^﻿/, "").trim();
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start === -1 || end === -1) throw new Error("文件里没有 JSON");
  return JSON.parse(t.slice(start, end + 1));
}

export function checkCandidate(c, ctx = {}) {
  const errors = [];
  const warnings = [];
  const label = c?.puzzle?.id || c?.flip_word || "(无名)";

  if (!c || typeof c !== "object") return { label, skipped: "不是对象" };
  if (c.verdict !== "pass") return { label, skipped: c.reject_reason || "模型自己淘汰了" };
  const p = c.puzzle;
  if (!p || typeof p !== "object") return { label, errors: ["verdict 是 pass 但没有 puzzle"], warnings };

  /* ---- 候选层面：prompt 第四、六、九节里能机械检查的 ---- */
  const conds = Array.isArray(c.conditions) ? c.conditions : null;
  if (conds) {
    const bad = conds.filter((x) => x.must_guess === true && /补充/.test(String(x.source)));
    if (bad.length) errors.push(`必须推到的条件来自「揭晓后补充」：${bad.map((x) => x.condition).join("、")}`);
  }
  const path = Array.isArray(c.question_path) ? c.question_path : null;
  if (path) {
    if (path.length > 8) errors.push(`模拟盘汤用了 ${path.length} 问，超过 8 问`);
    const badA = path.filter((x) => !VERDICTS.includes(x.a));
    if (badA.length) errors.push(`模拟盘汤的回答只能是是/否/无关：${badA.map((x) => x.a).join("、")}`);
  }
  if (c.surface !== undefined && c.surface !== p.scene) errors.push("puzzle.scene 和 surface 不一致");
  if (c.truth_line !== undefined && c.truth_line !== p.twist) errors.push("puzzle.twist 和 truth_line 不一致");

  /* ---- puzzle 层面：游戏和界面需要的 ---- */
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id || "")) errors.push(`id「${p.id}」不合法，要拼音小写加连字符`);
  else if (ctx.ids?.has(p.id)) errors.push(`id「${p.id}」已经存在`);

  if (!["清汤", "红汤"].includes(p.broth)) errors.push(`broth「${p.broth}」只能是清汤或红汤`);
  if (p.genre !== "本格") (p.genre === "变格" ? warnings : errors).push(`genre 是「${p.genre}」，这套标准只出本格`);
  if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 4) errors.push("difficulty 要是 1–4 的整数");

  const scene = String(p.scene || "");
  if (!scene) errors.push("没有汤面");
  if (len(scene) > 60) errors.push(`汤面 ${len(scene)} 字，超过 60`);
  const sentences = (scene.match(/[。！？]/g) || []).length || 1;
  if (sentences > 4) errors.push(`汤面 ${sentences} 句，超过 4 句`);
  if (ctx.scenes?.has(strip(scene))) errors.push("汤面和已有的题重复");

  if (!String(p.twist || "").startsWith("其实")) errors.push("twist 要以「其实」开头");
  if (len(strip(p.twist).replace(/^其实/, "")) > 20) warnings.push("「其实」那句超过 20 字");
  if (!p.core) errors.push("没有 core");

  const keys = Array.isArray(p.keys) ? p.keys : [];
  const ids = keys.map((k) => k.id);
  if (keys.length < 2 || keys.length > 4) errors.push(`关键点 ${keys.length} 个，要 2–4 个`);
  if (new Set(ids).size !== ids.length) errors.push("关键点 id 重复");
  if (keys.some((k) => !/^k\d+$/.test(k.id || "") || !k.need)) errors.push("关键点要有 k1 这样的 id 和 need");

  if (conds) {
    const guessIds = conds.filter((x) => x.must_guess === true).map((x) => x.id);
    if (!same(guessIds, ids)) errors.push(`关键点（${ids.join(",")}）和必须推到的条件（${guessIds.join(",")}）对不上`);
  }
  if (path) {
    const hit = new Set(path.flatMap((x) => (Array.isArray(x.hits) ? x.hits : [])));
    const unreached = ids.filter((k) => !hit.has(k));
    if (unreached.length) errors.push(`模拟盘汤里没有一问触到：${unreached.join("、")}`);
    const n = path.length;
    const expect = n <= 5 ? 2 : n <= 7 ? 3 : 4;
    if (Number.isInteger(p.difficulty) && p.difficulty !== expect && n >= 4) {
      warnings.push(`盘汤 ${n} 问，难度应为 ${expect}，写的是 ${p.difficulty}`);
    }
  }

  const core = Array.isArray(p.coreKeys) ? p.coreKeys : [];
  if (core.length < 1 || core.length > 2) errors.push("coreKeys 要 1–2 个");
  else if (!core.every((k) => ids.includes(k))) errors.push("coreKeys 指向不存在的关键点");
  else if (core.length === ids.length) errors.push("coreKeys 等于全部关键点，通关会太严");

  // 汤底分段：界面一段一段揭开，规则见 prompt 第五节
  const rev = Array.isArray(p.reveal) ? p.reveal : [];
  if (rev.length < 2 || rev.length > 6) errors.push(`汤底分了 ${rev.length} 段，要 2–6 段`);
  rev.forEach((s, i) => {
    const t = String(s?.text || "");
    if (!t) { errors.push(`第 ${i + 1} 段是空的`); return; }
    if (!ENDS_WITH_PUNCT.test(t)) errors.push(`第 ${i + 1} 段「${t}」没有以标点结尾，连起来会粘在一起`);
    if (s.key !== null && s.key !== undefined) {
      if (!ids.includes(s.key)) errors.push(`第 ${i + 1} 段指向不存在的关键点 ${s.key}`);
      if (len(strip(t)) < 4) errors.push(`第 ${i + 1} 段「${t}」太短，单独揭开时读不出意思`);
      else if (len(t) > 40) warnings.push(`第 ${i + 1} 段 ${len(t)} 字，有点长`);
    }
  });
  const uncovered = ids.filter((k) => !rev.some((s) => s?.key === k));
  if (uncovered.length) errors.push(`关键点没有对应的汤底段落：${uncovered.join("、")}`);
  const endings = rev.map((s, i) => (s?.key == null ? i : -1)).filter((i) => i >= 0);
  if (endings.length > 1) errors.push("结局段（key 为 null）只能有一段");
  if (endings.length === 1 && endings[0] !== rev.length - 1) errors.push("结局段要放在最后");
  const total = rev.reduce((a, s) => a + len(s?.text), 0);
  if (total > 100) errors.push(`汤底一共 ${total} 字，太长，碗里放不下`);
  else if (total > 80) warnings.push(`汤底一共 ${total} 字，超过 80`);

  const facts = Array.isArray(p.facts) ? p.facts : [];
  if (facts.length < 8) errors.push(`facts 只有 ${facts.length} 条，要至少 8 条`);
  const neg = facts.filter((f) => NEGATIVE.test(f)).length;
  if (neg < 2) errors.push(`否定事实只有 ${neg} 条，要至少 2 条，不然主持人会自己编`);
  if (p.edgeCases !== undefined && (!Array.isArray(p.edgeCases) || p.edgeCases.some((e) => typeof e !== "string"))) {
    errors.push("edgeCases 要是字符串数组");
  }

  const hints = Array.isArray(p.hints) ? p.hints : [];
  if (hints.length < 1 || hints.length > 3) errors.push(`提示 ${hints.length} 条，要 2 条`);
  else if (hints.length !== 2) warnings.push(`提示 ${hints.length} 条，界面按 2 条设计`);
  const coreText = strip(p.core);
  if (coreText && hints.some((h) => strip(h).includes(coreText))) errors.push("提示里直接写出了 core");
  hints.forEach((h, i) => { if (len(h) > 30) warnings.push(`第 ${i + 1} 条提示 ${len(h)} 字，偏长`); });

  if (ctx.levers?.has(String(p.lever || ""))) warnings.push(`翻转词「${p.lever}」已经用过`);

  if (errors.length) return { label, errors, warnings };

  // 通过：只保留游戏用得到的字段，加上出题时的自检记录方便人工复查
  const out = normalizePuzzle({
    id: p.id, locale: p.locale || "zh", broth: p.broth, genre: p.genre,
    difficulty: p.difficulty, lever: p.lever, portable: p.portable !== false,
    scene: p.scene, twist: p.twist, core: p.core,
    keys: keys.map((k) => ({ id: k.id, need: k.need })),
    coreKeys: core,
    reveal: rev.map((s) => ({ key: s.key ?? null, text: s.text })),
    facts, edgeCases: p.edgeCases || [], hints,
    source: "import",
    authoring: {
      flipWord: c.flip_word, wrongReading: c.wrong_reading,
      overturnDetail: c.overturn_detail, questionPath: path || []
    }
  });
  return { label, puzzle: out, errors: [], warnings };
}

function same(a, b) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
