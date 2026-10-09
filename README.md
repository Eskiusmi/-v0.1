# 海龟汤 MVP

AI 主持的海龟汤。裁判层在服务端，汤底不下发。

## 跑起来

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start          # http://localhost:3000
```

`MODEL` 可选，默认 `claude-sonnet-5`。

## 部署到 Render

Build `npm install`，Start `npm start`，环境变量加 `ANTHROPIC_API_KEY`。
Render 会注入 `PORT`，代码已经读了。

## 结构

```
server.js           Express：单人路由、对局日志
rooms.js            联机房间：开房、加入、实时推送、并发写入
players.js          匿名 cookie 玩家
economy.js          积分和提示收费规则
limits.js           限流（按玩家，IP 只做宽兜底）
gate.js             并发闸门：同时打 API 的请求数上限
sessions.js         存储：Redis 或内存（对局 / 积分 / 房间）
adjudicator.js      裁判层：prompt、解析、API 客户端（线上和离线验证共用）
puzzles.js          手写谜题（solution/facts/keys 永不出服务端）
pool.js             载入 generate.js 产出的 pool.json
generate.js         离线出题 + 三关验证
calibrate.js        校准 key 命中判定
probes.js           校准用的手工标注探针
check.js            诊断 key / workspace / 模型
test/               npm test，纯逻辑不打 API
public/index.html   页面和样式
public/app.js       前端逻辑，无构建；文案全在 I18N 对象里
```

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发，读 .env，改代码自动重启 |
| `npm run check` | 确认 key 通不通 |
| `npm test` | 解析层单元测试 |
| `npm run calibrate` | 用探针测裁判判定准不准 |
| `npm run generate -- 5` | 离线生成 5 道通过验证的题 |
| `npm start` | Render 用，不读 .env |

## 接口

| 路由 | 作用 |
|---|---|
| `GET  /api/puzzles` | 谜题列表（只有 id / 汤色 / 格 / 难度） |
| `POST /api/start`   | 开局，返回 sessionId + 汤面 |
| `POST /api/ask`     | 裁定一问 |
| `POST /api/hint`    | 取下一条提示（`pay`: `points` 或 `ad` + `ticket`） |
| `POST /api/ad/ticket` | 看广告前领票据 |
| `GET  /api/config`  | 广告和积分配置 |
| `POST /api/room` | 开房间，返回房间号 |
| `POST /api/room/:code/join` | 用房间号加入（带昵称） |
| `GET  /api/room/:code/events` | 房间实时推送（SSE） |
| `POST /api/room/:code/ask` `hint` `giveup` `next` `leave` | 房间里提问 / 提示 / 揭晓 / 下一碗 / 离开 |
| `POST /api/giveup`  | 投降，返回汤底 |

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✓ | |
| `ANTHROPIC_WORKSPACE_ID` | 跨 workspace 的 key 才要 | `wrkspc_` 开头 |
| `MODEL` | | 生成用，默认 `claude-sonnet-5` |
| `JUDGE_MODEL` | | 裁判用，默认同 MODEL。**建议换 Haiku**，见下 |
| `SOLVER_MODEL` | | 生成时模拟对局的提问方，默认 Haiku |
| `DEBUG_RAW` | | 设 1 打印模型原始输出，调完关掉 |
| `JUDGE_EFFORT` | | 裁判思考力度，默认 `low`；判定变差就改 `medium` |
| `JUDGE_CONCURRENCY` `JUDGE_QUEUE_SECONDS` `JUDGE_BUDGET_SECONDS` | | 同时几个请求 / 最多排队几秒 / 一次裁定最多几秒，默认 8 / 10 / 25 |
| `ADSENSE_CLIENT` | | AdSense 发布商 ID；现在没开广告，不设就只能用积分换提示 |
| `ADS_TEST` / `ADS_MOCK` | | Google 测试模式 / 本地假广告，见「广告」 |
| `POINTS_PER_SOLVE` `HINT_COST` `FREE_HINTS` `AD_MIN_SECONDS` | | 积分规则，默认 1 / 1 / 1 / 5 |

### 裁判模型的选择

裁判是「查表 + 判断」，每次调用 Sonnet 5 都会先自适应思考，你付 thinking token 的钱换来的判断可能并不比 Haiku 好。**用数据决定**：

```bash
npm run calibrate                                          # Sonnet 5
JUDGE_MODEL=claude-haiku-4-5-20251001 npm run calibrate    # Haiku
```

两个跑完比漏报 / 误报 / 不稳定三个数。Haiku 不明显差的话就用 Haiku，成本大概差一个数量级。

## 三条设计约束，改代码时别破坏

**1. 客户端不是可信边界。**
`solution`、`facts`、`keys` 的文本永远不出服务端。已命中的 key 和提问历史存在
服务端 session 里，不由客户端上报——否则玩家可以伪造进度直接触发通关。
`publicView()` 是唯一的下发白名单，加字段时经过它。

**2. 模型没有输出汤底的路径。**
不是靠 prompt 里写「不要泄露」，而是输出 schema 里根本没有那个字段，
`parseVerdict` 只提取 `verdict / keys / solved / note` 四项，`note` 还只在
「换个问法」时保留并截断到 60 字。prompt injection 就算部分成功也无处可去。

**3. 降级优于报错。**
模型返回非法 JSON 时重试一次，再失败就判「无关」。误判一次「无关」代价很小，
崩一次代价是整局。`ANTHROPIC_API_KEY` 填错时整个游戏仍然可玩（全判无关），
这是故意的。

## 多人同时提问为什么会卡，以及怎么改的

不是 API key 的问题。限流是**按组织**算的，多建几个 key 不会多出额度。真正的原因有三个：

1. **每次裁定很慢。** Sonnet 5 默认 `effort: high`，每个「是/否」之前都要想很久。
   现在裁判用 `effort: low`（`JUDGE_EFFORT`）。改完跑一次 `npm run calibrate` 确认判定没变差。
2. **同一道题的规则和事实每问都重发。** 现在这一大块做了提示缓存，后续提问起步更快；
   联机房间里所有人问同一道题，共用一份缓存。
3. **我们自己的限流按 IP 算。** 同一个 Wi-Fi 下的人共用一个 IP，会互相限住。
   现在按玩家限，IP 只留很宽的兜底。

另外加了并发闸门（`gate.js`）：同时最多 8 个请求打 API，其余排队；排队超过 10 秒、
或者上游限流要等很久，就直接告诉玩家「人有点多，等几秒再问」，不陪着卡。

## 联机房间

- 点右上角的联机按钮：开一个房间，或者输入房间号加入。邀请链接是 `/?room=房间号`。
- 房间里所有人看到同一道题、同一个汤底、同一份问答记录；谁都能问，别人提问时能看到「正在问」。
- 谁问出了答案这一碗就结束，**问出答案的人**得 1 分（第一次解开这道题时）。
- 第一条提示全房间共用、免费；之后谁点谁花自己的积分。
- 只有房主能揭晓汤底、开下一碗。房主离开后，最早进来的人接任。
- 最多 8 人；房间 6 小时没人动自动删除。
- 实时同步用 SSE，订阅关系在进程内存里：**只能单实例运行**。以后要开多实例，得把推送换成 Redis pub/sub。
- 玩家的 cookie ID 不会发给房间里的其他人（`test/rooms.test.mjs` 检查）。

## 积分和提示

- 每道题第一条提示免费；之后每条**花 1 积分**（点两次确认，防误触）。开了广告的话也可以看广告换。
- **第一次**解开某道题得 1 积分。重玩同一道（比如点分享链接）不加分，否则可以无限刷。
- 积分记在服务端（`economy.js`），玩家用一个匿名 cookie 区分。不放浏览器里，是因为那样改一下就有 9999 分。清 cookie 积分会丢，以后做账号再解决。
- 数值都是环境变量：`POINTS_PER_SOLVE`、`HINT_COST`、`FREE_HINTS`、`AD_MIN_SECONDS`。

### 广告（Google H5 Games Ads，现在没开）

用的是 Google 给网页游戏的激励广告（Ad Placement API 的 `adBreak({ type: "reward" })`），
不是普通 AdSense 横幅。上线前要做的事：

1. 申请 AdSense 账号，网站过审。
2. 单独申请 H5 Games Ads（需要申请，不保证批）。
3. 批下来后设 `ADSENSE_CLIENT=ca-pub-…`，先加 `ADS_TEST=1` 用 Google 的测试模式走一遍，再关掉。
4. `/ads.txt` 会按 `ADSENSE_CLIENT` 自动生成。
5. 把 `public/privacy.html` 里的联系邮箱填上。

本地开发设 `ADS_MOCK=1`，页面会用自带的 6 秒假广告走完同样的回调，不连 Google。

**网页激励广告没有服务端验证**：「看完了」是浏览器告诉我们的。所以看广告前先向服务端领一张票据，
至少过 `AD_MIN_SECONDS` 秒、且只能用一次，才换得到提示。这挡得住直接调接口的脚本，挡不住
有心人改前端——所以奖励只能是提示这种小东西，别拿广告去换任何值钱的。

`test/economy.test.mjs` 覆盖了各种绕过方式：不付钱、积分不够、假票据、票据太早、票据重用、重玩刷分。

## 汤底分段揭开

页面上方是题目，题目下面是模糊的汤底。玩家每想到一个关键点，汤底就揭开对应的一段；
通关或放弃时全部揭开。每道题的 `reveal` 数组是汤底本身，按关键点切段，
`solution` 由这些段拼出来（`reveal.js`）。

模糊的那句是**假字**，只有长度和标点跟真句子一致。真文字在对应关键点命中后才由服务端下发。
不要改成「把真汤底放进页面再加 CSS 模糊」——开发者工具删一行样式就能看到全文。
`test/reveal.test.mjs` 会检查开局下发的内容里有没有汤底原文。

写新题时：每个关键点至少对应一段；只揭开某一段时，读到的不能是没头没尾的半句；
最后一段可以 `key: null`，作为通关才揭开的结局。

## Session 在哪

`render.yaml` 里声明了一个免费的 Key Value（Redis），`REDIS_URL` 自动注入。
每次部署进程重启，session 不会丢——玩家玩到一半不会再被「这局已过期」。
本地不设 `REDIS_URL` 就走内存，零配置。Redis 连不上会退回内存并打警告，不会卡死启动。

万一还是撞上过期（比如你手动改了 Redis），前端会自动用同一道题重开一局，不会卡住。

## 已经做了的防护

- `/api/ask` 和 `/api/start` 都有按 IP 的令牌桶限流（20 次突发，6 秒回一次）
- session 总数上限 5000，超了淘汰最久没动的
- 原句重复提问直接回缓存，不打 API；降级的裁定不入历史、不缓存
- 基本安全头（nosniff / DENY frame / no-referrer）
- 每局结束一行 JSON 日志：`grep '"event":"finish"'` 就能看弃局率和平均问数

## 已知未做

- **限流存在内存里**，多实例时各限各的。session 已经走 Redis 了（`sessions.js`），
  限流要的话照着改。
- **没有 Anthropic 消费上限。** 去 Console → Billing 设一个，那是最后一道保险。
- **谜题只有 3 题。** 见下。

## 下一步：先校准，再扩库

```bash
npm run calibrate
```

它拿 `probes.js` 里手工标注的 23 条问题去打真裁判，报漏报 / 误报 / 通关误判 /
注入没挡住 / 方差，末尾直接告诉你偏紧还是偏松、该改哪。每条探针跑两次，
同一问题两次结果不同会标「不稳定」——现在没有 temperature 了，方差要盯着。

**校准过了再 `npm run generate`。** 库先大后调，等于用错误的尺子量了一整批。

给新题写探针的原则：每个 key 至少一条正例 + 一条近似反例。反例是关键——
只测正例的话，一个「什么都给 key」的坏判定也能满分。

---

## 出题标准

在 `standards.js` 里，来自 2026-09-09 那次讨论。三条判定：一句话说完「其实……」、
汤底每个未知在汤面上有钩子、每个钩子能支撑二分型问题（十问以内盘完）。
生成、审校、审计用的是同一份文本，改那一处就全改。

```bash
npm run audit                 # 拿标准审已有题库，结果写进 audit-report.json
npm run audit -- tangge       # 只审一道
npm run audit -- --sim        # 审校通过的再真的模拟玩十问
```

审校对照【核心】来审：只有说出核心必须知道的事才需要钩子；汤底里的叙事细节和
审校估的问数只警告不卡，「十问以内」以模拟对局实测为准。

## 出题：用 prompt 批量生成 + 导入

`prompts/generate-zh.md` 是出题 prompt：可以贴进 claude.ai，也可以接 API。
模型输出的 JSON 存成文件后：

```bash
npm run import -- --used              # 已用骨架，粘进 prompt 的 {{USED_LIST}}
npm run import -- out.json --dry      # 只检查
npm run import -- out.json            # 检查通过的加进 pool.json
npm run import -- out.json --verify   # 再走一遍独立审校 + 模拟对局
```

`ingest.js` 机械检查 prompt 里能查的规则：必须推到的条件不能来自补充、盘汤 ≤8 问、
回答只能是是/否/无关、每个关键点都被问到、关键点和汤底段落一一对应、段落以标点结尾、
coreKeys 不等于全部关键点、否定事实 ≥2 条、提示不能写出 core。查不了的（翻转词好不好、
段落有没有剧透）靠 `--verify` 和人。

`edgeCases`（出题人标好的易错问法）会进裁判 prompt 的【易错问题】一节。

## 出题：离线生成 + 自动验证

```bash
npm run generate -- 5     # 生成到通过 5 题为止
```

题**不在玩家请求路径上生成**。生成器跑在你的机器上，产出的候选要过三关，
只有活下来的写进 `pool.json`，服务端启动时并入题库。

| 关卡 | 检查什么 | 成本 |
|---|---|---|
| 1. 结构 | 汤面 ≤60 字、facts ≥8 条且含否定事实、keys 3–5 | 免费 |
| 2. 出题标准审校 | 三条判定 + 题面诚实 + 内容红线，由代码按审校结果判通过 | 1 次调用 |
| 3. 模拟对局 | 让模型真的玩 10 问（`SIM_TURNS`），看能否通关、无关率是否过高 | ~10 次调用 |

第 3 关是质量线第 3 条的自动化版本，也是最贵的一关，所以放最后——
前两关先把明显的废品筛掉。

**预期通过率不高。** 生成 4 题留 1 题是正常的，脚本按这个比例设了上限
（`MAX_TRIES = WANT * 4`）。没凑够就再跑一次。

### 反套路

不加约束的话模型会反复产出「死去的妻子 / 镜子 / 盲人 / 双胞胎」。
`generate.js` 里的 `LEVERS` 和 `SETTINGS` 每次随机组合，强制它换手法和场景。
如果你发现生成的题还是同质化，往这两个数组里加条目，比改 prompt 有效。

### 每题成本

一题算下来约 1 次生成 + 1 次审校 + 12 次裁定。模拟对局用便宜模型
（`SOLVER_MODEL`，默认 Haiku）——它只负责提问，不负责裁定。
按 4 题留 1 题算，收录一道题的实际成本是这个数字的四倍。先小批量跑，
确认质量再放量。

### 人还是要看

自动验证挡得住「题面撒谎」和「不可解」，挡不住「无聊」。
`pool.json` 是纯 JSON，收录后自己扫一遍，把没意思的删掉——
这一步没法自动化，但它比前三关快得多。
