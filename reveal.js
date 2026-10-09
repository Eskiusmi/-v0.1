// 汤底分段揭开。
//
// 页面上那句模糊的汤底，是「假字」：只有长度和标点跟真句子一样。
// 真文字只在对应的关键点命中后，才由服务端下发那一段。
// 不能把真汤底放进页面再加 CSS 模糊——开发者工具删一行样式、或者复制粘贴，就能看到全文。

// 题目没写 reveal 的（比如早期生成的题），用关键点的 need 当段落，
// 再把整句汤底作为通关时才揭开的最后一段。
export function normalizePuzzle(p) {
  if (Array.isArray(p.reveal) && p.reveal.length) {
    p.reveal = p.reveal.map((s) => ({ key: s.key ?? null, text: String(s.text ?? "") }));
    p.solution = p.reveal.map((s) => s.text).join("");
  } else {
    p.reveal = [
      ...(p.keys || []).map((k) => ({ key: k.id, text: k.need })),
      { key: null, text: p.solution || "" }
    ];
  }
  return p;
}

// 标点和空白原样保留，其余每个字换成占位符。客户端拿它画出等长的模糊假字。
const KEEP = /[\p{P}\p{S}\s]/u;
export function revealShape(p) {
  return p.reveal.map((s) => ({
    shape: [...s.text].map((c) => (KEEP.test(c) ? c : "□")).join(""),
    keyed: !!s.key
  }));
}

// 这些关键点命中时，哪几段可以看；all=true（通关或放弃）时全部可以看。
export function visibleIndexes(p, hit, all = false) {
  const h = new Set(hit);
  const out = [];
  p.reveal.forEach((s, i) => { if (all || (s.key && h.has(s.key))) out.push(i); });
  return out;
}

// 这一问新揭开了哪几段（带真文字），只发变化的部分。
export function revealDiff(p, hitBefore, hitAfter, allAfter = false) {
  const before = new Set(visibleIndexes(p, hitBefore));
  return visibleIndexes(p, hitAfter, allAfter)
    .filter((i) => !before.has(i))
    .map((i) => ({ i, text: p.reveal[i].text }));
}
