// 玩家：匿名 cookie。
//
// 第一次来时发一个随机 ID 放在 cookie 里，积分记在服务端这个 ID 名下。
// 积分本身不放进 cookie：就算签名防改，也挡不住「存一份 10 分的旧 cookie，
// 花完再换回去」的重放。存在服务端，cookie 里只放一个查找用的 ID。
// 清掉 cookie 积分就没了——以后做账号系统再解决。

import crypto from "node:crypto";
import { newPlayer } from "./economy.js";

const PID = "hg_pid";
const isPid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v || "");

export function readPid(req) {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)hg_pid=([^;]+)/);
  const v = m ? decodeURIComponent(m[1]) : null;
  return isPid(v) ? v : null;
}

export function createPlayers(store) {
  async function load(req, res) {
    let pid = readPid(req);
    let player = pid ? await store.get(pid) : null;
    if (!pid) pid = crypto.randomUUID();
    if (!player) { player = newPlayer(); await store.set(pid, player); }
    res.setHeader("Set-Cookie",
      `${PID}=${pid}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax${req.secure ? "; Secure" : ""}`);
    return { pid, player };
  }
  async function get(pid) { return (pid && (await store.get(pid))) || newPlayer(); }
  async function save(pid, player) { if (pid) await store.set(pid, player); }
  return { load, get, save };
}
