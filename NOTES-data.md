# dsh-session-overview 数据面地图（ctx 服务与字段映射）

> 研究员：scout-data · 任务 t2 · 2026-08-22
> 所有 API 均从本机 npm 安装版 DSH 源码逐行核实，出处格式 `文件:行号`。
> 根目录缩写：
> - `API` = `C:\Users\<user>\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js`
> - `SES` = `...\node_modules\@deepseek-ai\dsh-session\lib\types\index.d.ts`
> - `AGT` = `...\node_modules\@deepseek-ai\dsh-agent\lib\types\index.d.ts`
> - `ART` = `...\node_modules\@deepseek-ai\dsh-agent\lib\types\runtime-types.d.ts`
> - `WS`  = `...\node_modules\@deepseek-ai\dsh-workspace\lib\types\index.d.ts`
> - `WST` = `...\node_modules\@deepseek-ai\dsh-workspace\lib\types\types.d.ts`
> - `PERS`= `...\node_modules\@deepseek-ai\dsh-session-persistence\lib\types\index.d.ts`
> - `PROJ`= `...\node_modules\@deepseek-ai\dsh-session-projection\lib\types\index.d.ts`
> - `PCACHE`=`...\node_modules\@deepseek-ai\dsh-session-projection-cache\lib\types\index.d.ts`
> - `TITLE`= `...\node_modules\@deepseek-ai\dsh-session-title\lib\index.js`

---

## 0. TL;DR（给工程师的一句话）

宿主进程内插件直接用 cordis ctx：**attached 会话**走 `ctx.sessions.list()`，每个会话的
running 用 `ctx.agents.get(id)?.status === "running"`，标题/最近活动等用
`ctx.sessionProjections.snapshot(session).values`（键 `"title"`、`"sessionListMetadata"`…）；
**冷会话**用 `ctx.get("sessionPersistence").list()` 拿 header + 
`ctx.get("sessionProjectionCache").cachedSnapshot(meta)` 拿零 I/O 投影。官方同款聚合逻辑在
`API:2158-2203 listVisibleSessionSummaries`，可直接照抄思路。

---

## 1. 插件怎么拿到 ctx（约定核实）

本机已装插件的实证（`~/.dsh/profiles/web/node_modules/dsh-pet/lib/index.js`）：

```js
const name = 'dsh-pet'
const inject = ['webServer', 'subprocess']   // 需要的服务名数组（可省略则不声明）
function apply(ctx) { /* ctx 是 cordis Context */ }
export { name, inject, apply }
```

- ESM 包，`package.json` 里 `"main": "lib/index.js"`、`"type": "module"`。
- 宿主把根 Context 传给 `apply(ctx)`；服务用 `ctx.sessions` 直接属性或 `ctx.get("xxx")` 可选获取。
- 我们的面板 host 侧建议 `inject: []` 或不声明（sessions 在 web profile 恒在），对可选服务
  （sessionProjections / sessionPersistence / sessionTitle / workspaceRegistry / jobs /
  sessionQuery / sessionProjectionCache）一律 `ctx.get(...)` 判空降级。

---

## 2. 列出全部会话：准确调用

### 2.1 attached（内存中的活会话）

```js
ctx.sessions.list()   // Session[]，创建顺序
ctx.sessions.get(id)  // Session | undefined
```
- 出处：`SES:393`（get）、`SES:398`（list，“All live sessions, in creation order”）。
- `SessionStore extends Service`，即 cordis 服务名 `sessions`（`SES:290`）。

### 2.2 cold（已持久化但未挂载）

```js
const persistence = ctx.get('sessionPersistence')      // 可能未装配 → undefined
const headers = persistence ? await persistence.list() : []   // SessionHeader[]
```
- 出处：`PERS:176` `abstract list(signal?): Promise<SessionHeader[]>`；
  “Lightweight listing from metadata, without a full-log parse.”
- 官方聚合范例（attached 优先、cold 去重、按 updatedAt 新→旧排序）：
  `API:2158-2203 listVisibleSessionSummaries`；排序在 `API:2201`
  `items.sort((a, b) => b.updatedAt - a.updatedAt)`。
  注意官方还过滤了 `meta.cwd !== void 0` 的 cold 行（`API:2173`）。

### 2.3 变更事件（免轮询刷新）

| 事件 | 载荷 | 出处 |
|---|---|---|
| `ctx.on('session/created', cb)` | `(session: Session)` | `API:3585` |
| `ctx.on('session/disposed', cb)` | `(session: Session)` | `API:3594` |
| `ctx.on('agent/status', cb)` | `({ agent, status })` status ∈ `'idle'\|'running'` | `API:3639-3645`, 枚举 `ART:45` |
| `ctx.on('agent/error', cb)` | `({ agent, error })` | `API:3646-3652` |
| `ctx.on('session/event', cb)` | `(session, event)` 全事件火线 | `API:3565` |
| `ctx.on('agent/created'/'agent/disposed')` | `({ agent })` | `ART:146,157` |

官方 host 流正是用这组事件拼出 `host/session-added / host/session-status / host/session-removed`
帧（`API:3618-3689`），我们的面板可完全复刻同一套监听。

---

## 3. 每个会话的字段取法

### 3.1 字段来源总表

| UI 字段 | 取法 | 出处 |
|---|---|---|
| **id** | `session.id`（= `header.id`） | `SES:122`, `SESt:48`¹ |
| **标题** | ① `ctx.sessionProjections.snapshot(session).values.title`（string \| null）；② `ctx.get('sessionTitle')?.get(session)` → `{title, messageSeqs, source, eventSeq, updatedAt} \| undefined`；③ 兜底：`session.events.findLast(e => e.type === 'session/title')?.data.title` | 投影注册 `TITLE:177-186`（key `"title"`，apply 于 `session/title` 事件）；get `TITLE:217-219`；fold `TITLE:112-122` |
| **是否 running** | `ctx.agents.get(session.id)?.status === 'running'`；枚举仅 `'idle' \| 'running'`，disposed 即从注册表移除（不是第三态） | get `AGT:349`；枚举 `ART:45`；语义注释 `ART:38-44`；官方用法 `API:2161,2164` |
| **运行沿变化** | `ctx.on('agent/status', ({agent,status}) => …)` | `ART:169-172`, `API:3639` |
| **最近活动时间戳** | 官方口径 `updatedAt = Math.max(header.createdAt, lastPromptAt ?? 0)`；lastPromptAt 来自投影 `values.sessionListMetadata.lastPromptAt`（最后一条 user 来源 user/message 的 event.time） | 公式 `API:1213-1215`；投影 fold `API:1195-1201`；汇总 `API:1230-1239` |
| （可选）真实末尾活动 | attached：`session.events.at(-1)?.time`（每事件含 epoch ms `time`）；wire schema 证实事件封套 type/seq/time/data | `API:417-425` |
| **workspace** | 见 §3.2 | — |
| blank（是否空会话，列表可隐藏） | 投影 `values.sessionListMetadata.blank`（无 `turn/start` 即 blank） | `API:1803-1810` 注册、`API:1191-1193` 判定 |
| parentSessionId / origin / cwd / agentPreset | `session.header.parentSession / .origin / .cwd / .agentPreset`（均可选） | `SESt:40-78`；官方展开 `API:1217-1227` |
| 后台任务数（增强项） | `ctx.jobs.list(agent)` 按 agent 查（非 agent caller 只能看到 unowned）；快照 `{id, kind, label, status…}`，status ∈ `'running'|'stopping'|'completed'|'killed'|'failed'` | `dsh-jobs/lib/types/index.d.ts:63`；JobView 字段 `API:1173-1182`；枚举 `dsh-jobs/lib/types/types.d.ts:14`；官方 per-session 用法 `API:3606-3610` |

¹ `SESt` = `dsh-session/lib/types/types.d.ts`

### 3.2 workspace 归属（两种真实路径)

路径 A（registry 反查，权威）：`ctx.workspaceRegistry.list(): Workspace[]`，实体
`{ id, path, title, createdAt, updatedAt, sessionIds }` —— `WST:20-43`，
`sessionIds` 已被启动期 canonical-cwd 头索引过滤（`WS:87-92`）。即：
**workspace→会话** 一跳可得；**会话→workspace** 用 `session.header.cwd` 对 `ws.path` 匹配。

路径 B（异步单查）：`await ctx.workspaceRegistry.resolveByPath(cwd): Promise<Workspace|undefined>`
（`WS:139`）。归档集合：`ctx.workspaceRegistry.archivedSessionIds`（`WS:116`）。
wire 视图同构佐证：`workspaceView()` 返回 `{workspaceId, path, title, sessionIds, createdAt, updatedAt}`
（`API:1622-1631`）。

### 3.3 agents 注册表补充

- `ctx.agents.list(): Agent[]` 全部活 agent（注册序）—— `AGT:363`
- `ctx.agents.roots(): Agent[]` 仅顶层 agent（排除子 agent 运行时归属）—— `AGT:370`
- 子 agent 判定（durable 维度）：`header.origin === 'subagent'`、`header.delegationDepth > 0`（`SESt:64-70`）

### 3.4 投影系统（标题等富字段的正规通道)

服务：`ctx.sessionProjections`（`PROJ:24,121`）。核心读法：

```js
const snap = ctx.sessionProjections.snapshot(session)
// snap.asOfSeq: number(-1 起步)；snap.values: Record<key, wireValue>
```
- 出处：`PROJ:153` snapshot、“Fully synchronous”、值过 schema 校验；形状 `PROJ:81-86`。
- change feed：`ctx.sessionProjections.onChanged((session,key,value,seq)=>…)` —— `PROJ:144`；
  官方广播用法 `API:1788-1798`。
- 本机生态已注册的 key（grep `sessionProjections.register` 全量核实）：
  `title`(dsh-session-title) · `goal`(dsh-goal:523) · `todos`(dsh-tool-todo:81) ·
  `plan`(dsh-plan-mode:153) · `permissions`(dsh-permission-presets:144) ·
  `tokenUsage/contextPressure/contextBreakdown`(dsh-token-meter:242/294/157) ·
  `sessionStats`(dsh-session-stats:51) · `subagent/subagentTiming`(dsh-subagent:2062/1960) ·
  `sessionListMetadata/imageLimits`(apiproxy:1800/1813)。客户端消费同表佐证
  `dsh-client-connection/lib/client.js:7649-7718`。

### 3.5 冷会话拿不到实时字段时的替代方案

| 缺口 | 替代 | 出处 |
|---|---|---|
| 冷会话的 title/todos 等 | 零 I/O：`ctx.get('sessionProjectionCache').cachedSnapshot(meta)` → `ProjectionSnapshot|undefined`（版本匹配才给，可能略陈旧但绝不错） | `PCACHE:79`，语义 `PCACHE:67-77` |
| 要新鲜的 | 温读：`coldSnapshot(id)`（缓存行+尾读回填，fail-soft 写回）或全量 `persistence.inspect(id)` → `{meta, events}` 后本地 fold | `PCACHE:101`；inspect `PERS:148` |
| 冷会话 updatedAt | `Math.max(meta.createdAt, cached.values.sessionListMetadata?.lastPromptAt ?? 0)`（与官方 summarizeCold 同构） | `API:1272-1281` |
| 内容搜索 | `ctx.get('sessionQuery').searchSessions({query, eventFilters, limit, cursor}, {signal})`（可选服务，可能未装） | `API:2404-2443` |
| 单会话历史页 | `persistence.readFrom(id, fromSeq, signal?)` → `{meta, events}` | `PERS:167` |

---

## 4. 最小可行数据聚合（真代码草稿）

纯 JS、无构建、容错优先；可直接作为 ui-panel 插件的 host 侧模块。

```js
// lib/data.js — dsh-session-overview 数据面（ESM）
export function createSessionDataSource(ctx) {
  const sessions = () => /** @type {import('@deepseek-ai/dsh-session').SessionStore|undefined} */ (ctx.get('sessions'))
  const agents = () => ctx.get('agents')
  const projections = () => ctx.get('sessionProjections')
  const persistence = () => ctx.get('sessionPersistence')
  const pcache = () => ctx.get('sessionProjectionCache')

  // —— 单行摘要（attached）—— 与 API:2160-2167 summarizeAttached 同构
  function rowOfAttached(session) {
    const agent = agents().get(session.id)
    let values = {}
    try {
      const snap = projections()?.snapshot(session)          // PROJ:153，同步
      if (snap) values = snap.values ?? {}
    } catch (e) { ctx.logger?.warn?.(`[overview] projections for ${session.id}: ${e}`) }
    const meta = values.sessionListMetadata ?? {}
    return {
      sessionId: session.id,
      title: values.title ?? null,                            // string|null，TITLE:179-185
      running: agent?.status === 'running',                   // ART:45
      blank: meta.blank ?? !session.events.some(ev => ev.type === 'turn/start'), // API:1191-1193
      updatedAt: Math.max(session.header.createdAt ?? 0, meta.lastPromptAt ?? 0), // API:1213-1215
      lastEventAt: session.events.at(-1)?.time ?? null,
      cwd: session.header.cwd ?? null,                        // SESt:52
      origin: session.header.origin ?? null,                  // 'subagent'|undefined
      delegationDepth: session.header.delegationDepth ?? 0,
      parentSessionId: session.header.parentSession ?? null,
      agentPreset: session.header.agentPreset ?? null,
      attached: true,
    }
  }

  // —— 单行摘要（cold，零 I/O 版）—— 与 API:2178-2186 summarizeCold 思路同构
  function rowOfCold(metaHeader) {
    let values = {}
    try { values = pcache()?.cachedSnapshot(metaHeader)?.values ?? {} } catch {} // PCACHE:79
    const meta = values.sessionListMetadata ?? {}
    return {
      sessionId: metaHeader.id,
      title: values.title ?? null,
      running: false,                                         // 冷会话必不 running（API:1277）
      blank: meta.blank ?? false,
      updatedAt: Math.max(metaHeader.createdAt ?? 0, meta.lastPromptAt ?? 0),
      lastEventAt: null,
      cwd: metaHeader.cwd ?? null,
      origin: metaHeader.origin ?? null,
      delegationDepth: metaHeader.delegationDepth ?? 0,
      parentSessionId: metaHeader.parentSession ?? null,
      agentPreset: metaHeader.agentPreset ?? null,
      attached: false,
    }
  }

  // —— 全量聚合：attached ∪ cold，新→旧（API:2158-2203 同构）——
  async function listAll() {
    const store = sessions()
    const byId = new Map()
    for (const s of store?.list() ?? []) byId.set(s.id, rowOfAttached(s))
    const pers = persistence()
    if (pers) {
      try {
        const headers = await pers.list()                     // PERS:176
        for (const h of headers) if (!byId.has(h.id)) byId.set(h.id, rowOfCold(h))
      } catch (e) { ctx.logger?.warn?.(`[overview] persistence.list: ${e}`) }
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // —— workspace 分组（WST:20-43；WS:92 list / WS:116 archived）——
  function workspaces() {
    let list = []
    try { list = ctx.workspaceRegistry.list() ?? [] } catch {}
    return {
      archivedSessionIds: [...(ctx.workspaceRegistry?.archivedSessionIds ?? [])],
      items: list.map(ws => ({
        workspaceId: ws.id, path: ws.path, title: ws.title,
        sessionIds: [...ws.sessionIds],                       // 已过滤的成员表
      })),
    }
  }

  // —— 订阅增量（面板免轮询）——
  function watch(onChange) {
    const disposers = []
    const fire = (...args) => { try { onChange(...args) } catch {} }
    // 新/删会话
    ctx.on('session/created', s => fire({ kind: 'upsert', row: rowOfAttached(s) }))       // API:3585
    ctx.on('session/disposed', s => fire({ kind: 'remove', sessionId: s.id }))            // API:3594
    // running 翻转
    disposers.push(ctx.on('agent/status', ({ agent, status }) =>                          // ART:169
      fire({ kind: 'status', sessionId: agent.id, running: status === 'running' })))
    // 标题/todo/goal… 任一投影变化
    disposers.push(projections()?.onChanged((session, key, value, seq) =>                 // PROJ:144
      fire({ kind: 'projection', sessionId: session.id, key, value, seq })))
    return () => { for (const d of disposers) try { d?.() } catch {} }
  }

  return { listAll, workspaces, watch, rowOfAttached, rowOfCold }
}
```

**面板 host 侧入口（lib/index.js 形态）**

```js
export const name = 'dsh-session-overview'
export const inject = []
export function apply(ctx) {
  const data = createSessionDataSource(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/session-overview',
    // GET /state → { rows, workspaces }；GET /stream → SSE/WS 推 watch 增量
    ...
  }))
}
```
（路由写法参照 dsh-pet `ctx.webServer.register({kind:'exact'|'prefix', path, handler})`，
`~/.dsh/profiles/web/node_modules/dsh-pet/lib/index.js:31-37`。）

---

## 5. 边界与坑（研究结论）

1. **`summarize` 的 wire 行里没有 title**（`API:427-437` sessionSummarySchema 只有
   sessionId/updatedAt/running/blank/parentSessionId/origin/cwd/agentPreset/projections）——
   标题必须另取投影 `"title"`（这正是 Web 端的做法）。别试图从 header 找 title。
2. **`agents.get` 对冷会话返回 undefined** → running=false 天然正确；不要用
   "不在 agents 表"推断"不存在"。
3. **`jobs.list()` 不带 caller 时只返回 unowned 任务**（`dsh-jobs types index.d.ts:57-63`）；
   要看某会话的任务必须传该会话的 agent：`jobs.list(agents.get(sessionId))`。
4. **`sessionPersistence` / `sessionProjections` / `sessionProjectionCache` 都是可选服务**：
   headless 组合可能没挂（`API:2405-2408` 对 sessionQuery 缺失的处理就是先例），全部 `ctx.get` + 判空。
5. **blank 会话**：官方列表语义是"没有 turn/start 就不算开始"（`API:1184-1193`）；
   总览面板建议默认过滤 `blank && !running`，与侧边栏行为一致。
6. **updatedAt 排序是官方口径**（`API:2201`），createdAt 与 lastPromptAt 都是 epoch ms 数值。
7. **投影 snapshot 可能抛**（单元 apply 对脏数据 fail-fast），官方在 listProjectionsFor
   里 try/catch 降级（`API:1418-1426`）——草稿已照做。
8. **workspace.sessionIds 只覆盖 canonical-cwd 匹配的会话**；cwd 缺失或非常规路径的
   会话不属于任何 workspace（UI 显示为"未分组"）。
