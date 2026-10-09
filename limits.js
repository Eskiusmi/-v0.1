// 限流。令牌桶：一开始有 max 个，之后每 refillMs 回一个。
//
// 以前只按 IP 限：20 次之后每 6 秒一次。问题是一群朋友在同一个 Wi-Fi 下一起玩时，
// 出口 IP 是同一个，会互相把对方限住——联机房间里尤其明显。
// 现在主要按玩家（cookie 里的匿名 ID）限，IP 只做一道很宽的兜底，挡脚本用。

export function createLimiter({ max, refillMs, keyOf }) {
  const buckets = new Map();

  setInterval(() => {
    const cutoff = Date.now() - Math.max(refillMs * max, 60_000) * 2;
    for (const [k, b] of buckets) if (b.last < cutoff) buckets.delete(k);
  }, 60_000).unref();

  // 返回 true 表示放行
  function take(key, now = Date.now()) {
    let b = buckets.get(key);
    if (!b) { b = { tokens: max, last: now }; buckets.set(key, b); }
    b.tokens = Math.min(max, b.tokens + (now - b.last) / refillMs);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  const middleware = (req, res, next) => {
    const key = keyOf(req);
    if (key && !take(key)) return res.status(429).json({ error: "too_many_requests" });
    next();
  };
  middleware.take = take;
  return middleware;
}
