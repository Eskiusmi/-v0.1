// 并发闸门：同一时间最多 max 个请求在打上游 API，其余排队。
// 排队超过 queueTimeoutMs 就放弃，让调用方快速返回「稍等再问」，而不是一直挂着。
//
// 为什么需要它：几十个人同时提问，几十个请求同时打出去，很容易撞上组织级的
// 突发限流（429），SDK 再按 retry-after 等着重试——在玩家眼里就是「卡住了」。
// 宁可让一部分人排几秒队，或者直接告诉他稍等，也比所有人一起卡住好。

export function createGate({ max = 8, queueTimeoutMs = 12000 } = {}) {
  let active = 0;
  const queue = [];

  const once = (fn) => { let done = false; return () => { if (!done) { done = true; fn(); } }; };
  const release = () => { active--; pump(); };

  function pump() {
    while (active < max && queue.length) {
      const w = queue.shift();
      if (w.expired) continue;
      clearTimeout(w.timer);
      active++;
      w.resolve(once(release));
    }
  }

  return {
    // 拿到一个 release 函数，用完必须调用（放在 finally 里）
    acquire() {
      if (active < max) { active++; return Promise.resolve(once(release)); }
      return new Promise((resolve, reject) => {
        const w = { resolve, expired: false };
        w.timer = setTimeout(() => {
          w.expired = true;
          reject(Object.assign(new Error("gate_timeout"), { code: "busy" }));
        }, queueTimeoutMs);
        queue.push(w);
      });
    },
    stats: () => ({ active, queued: queue.filter((w) => !w.expired).length, max })
  };
}
