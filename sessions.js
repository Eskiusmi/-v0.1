// 存储。设了 REDIS_URL 就用 Redis，否则用内存。
//
// 为什么必须有这一层：Render 每次部署都重启进程，内存里的东西全部清空——
// 对局会「过期」，积分会归零。Redis 是唯一让它们活过进程生命周期的办法。
//
// Render 上建一个免费的 Key Value（25MB，对这点数据绰绰有余），
// 把它的 Internal URL 填进 REDIS_URL 即可。本地开发不用设，自动走内存。
//
// 两个存储共用一个 Redis 连接：
//   session —— 一局游戏，3 小时不动就过期
//   player  —— 积分和解过的题，一年不来才过期

let redisClient = null;      // 连接成功后共用
let redisTried = false;

async function connectRedis(url) {
  const { createClient } = await import("redis");
  const client = createClient({
    url,
    socket: {
      connectTimeout: 3000,
      // 启动时连不上就放弃，退回内存；不要无限重试把服务卡死
      reconnectStrategy: (retries) => (retries > 2 ? new Error("redis unreachable") : 300)
    }
  });
  client.on("error", (e) => console.error("[redis]", e.message));
  await Promise.race([
    client.connect(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout")), 5000))
  ]);
  return client;
}

async function getRedis() {
  if (redisTried) return redisClient;
  redisTried = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redisClient = await connectRedis(url);
  } catch (err) {
    console.error("⚠ Redis 连不上：", err.message, "— 退回内存。");
    redisClient = null;
  }
  return redisClient;
}

function memoryStore(ttlSec) {
  const map = new Map();
  setInterval(() => {
    const cutoff = Date.now() - ttlSec * 1000;
    for (const [k, v] of map) if (v.touched < cutoff) map.delete(k);
  }, 1000 * 60 * 10).unref();

  return {
    kind: "memory",
    // 存取都复制一份，和 Redis 的行为一致（Redis 每次读出来都是新对象）。
    // 否则本地「改了没存也生效」，部署到 Redis 才出 bug。
    async get(id) { const v = map.get(id); return v ? structuredClone(v) : null; },
    async set(id, v) { v.touched = Date.now(); map.set(id, structuredClone(v)); },
    async del(id) { map.delete(id); },
    async size() { return map.size; },
    async evictOldest() {
      let oldest = null, at = Infinity;
      for (const [k, v] of map) if (v.touched < at) { oldest = k; at = v.touched; }
      if (oldest) map.delete(oldest);
    }
  };
}

function redisStore(client, prefix, ttlSec) {
  const key = (id) => `${prefix}${id}`;
  return {
    kind: "redis",
    async get(id) {
      const raw = await client.get(key(id));
      return raw ? JSON.parse(raw) : null;
    },
    async set(id, v) {
      v.touched = Date.now();
      // 每次写都续期，活跃的不会中途过期
      await client.set(key(id), JSON.stringify(v), { EX: ttlSec });
    },
    async del(id) { await client.del(key(id)); },
    async size() { return 0; },        // Redis 自己按 TTL 清，不需要手动淘汰
    async evictOldest() {}
  };
}

async function openStore({ prefix, ttlSec, label }) {
  const client = await getRedis();
  if (client) {
    console.log(`✓ ${label}存在 Redis。`);
    return redisStore(client, prefix, ttlSec);
  }
  console.log(`· ${label}存在内存里。部署重启会清空，上线前设 REDIS_URL。`);
  return memoryStore(ttlSec);
}

export const openSessionStore = () => openStore({ prefix: "hg:s:", ttlSec: 60 * 60 * 3, label: "对局" });
export const openPlayerStore = () => openStore({ prefix: "hg:p:", ttlSec: 60 * 60 * 24 * 365, label: "积分" });
export const openRoomStore = () => openStore({ prefix: "hg:r:", ttlSec: 60 * 60 * 6, label: "房间" });
