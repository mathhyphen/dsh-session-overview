// ============================================================================
// dsh-session-overview — DSH 会话总览面板（纯 JS 免构建 · host 侧）
//
// 设计依据（队友研究笔记）：
//   NOTES-contract.md §2.2  一切资源注册必须挂 ctx.effect（热重载/卸载自动清理）
//   NOTES-contract.md §2.3  webServer.register({ kind:'prefix' }) 多端点范式
//   NOTES-data.md      §2-§4 会话聚合：attached ∪ cold 去重、投影取 title、
//                      running 取 agents.status、updatedAt 官方口径、新→旧排序
//
// 路由（前缀 /dsh-session-overview）：
//   GET /dsh-session-overview            → 面板页（完整 HTML，中文界面）
//   GET /dsh-session-overview/api/state  → 全部会话摘要 JSON
//     { ok, ts, count, rows: [{ id, title, workspace, running, archived,
//                               lastActivity, attached, cwd, origin }] }
//   t24：子代理/团队会话（origin==='subagent' 或 delegationDepth>0）不进总览。
//   t30 性能：插件内维护 rows 缓存，session/event + agent/status 触发脏标记
//   （防抖 ≥500ms 合并后台重算），/api/state 直接返回缓存；单会话行按
//   (createdAt|lastEventAt|running|origin|depth|cwd) 增量复用，blank 廉价判定前置；
//   ?debug=1 附带 stats（ms/hits/misses/fromCache）；面板页另有 localStorage
//   'dsh-so-cache' 秒开 + 行点击乐观已读（ok=false 回滚）。
//
// 说明：本插件不声明 GUI slot 之外的重逻辑；lib/client.js 只负责在 GUI 侧边栏
// 提供入口按钮，面板本体即本路由返回的独立页面（浏览器新标签页同样可用）。
// ============================================================================

export const name = 'dsh-session-overview'

// 要用 webServer 服务就必须声明（NOTES-contract §2.3）；其余服务一律 ctx.get 可选降级。
export const inject = ['webServer']

export function apply(ctx) {
  const dataSource = createDataSource(ctx)

  // t30：事件驱动脏标记——session/event（全事件火线，API:3565）与 agent/status
  // （ART:169）触发缓存失效，≥500ms 防抖合并后台重算；挂 ctx.effect 随卸载清理。
  ctx.effect(() => {
    const offs = []
    const on = (evt, fn) => {
      try {
        const off = ctx.on(evt, fn)
        if (typeof off === 'function') offs.push(off)
      } catch (error) {
        try { ctx.logger?.warn?.('[session-overview] watcher ' + evt + ' failed: ' + (error?.message ?? error)) } catch {}
      }
    }
    on('session/event', dataSource.markDirty)
    on('agent/status', dataSource.markDirty)
    return () => { for (const off of offs) { try { off() } catch (e) {} } }
  }, 'dsh-session-overview: dirty watchers')

  // 前缀路由 + 子路径分发（范式出处：【INJ】9629-9695 管理 API 同款写法）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-session-overview',
    handler: async (req, res) => {
      const send = (code, body, type = 'application/json; charset=utf-8') => {
        res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
        res.end(body)
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const pathname = url.pathname.replace(/^\/dsh-session-overview/, '')
        if (req.method === 'GET' && (pathname === '' || pathname === '/' || pathname === '/index.html')) {
          return send(200, PAGE_HTML, 'text/html; charset=utf-8')
        }
        if (req.method === 'GET' && (pathname === '/api/state' || pathname === '/api/sessions')) {
          const rows = await dataSource.listRows()
          const body = { ok: true, ts: Date.now(), count: rows.length, rows }
          try {
            if (url.searchParams.get('debug') === '1') body.stats = dataSource.getStats()   // t30：耗时/命中率
          } catch (e) {}
          return send(200, JSON.stringify(body))
        }
        return send(404, JSON.stringify({ ok: false, error: 'not found: ' + url.pathname }))
      } catch (error) {
        return send(500, JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
      }
    },
  }), 'dsh-session-overview: routes')
}

// ----------------------------------------------------------------------------
// 数据面：与 NOTES-data.md §4 草稿同构，全部可选服务判空降级。
// ----------------------------------------------------------------------------

function createDataSource(ctx) {
  const warn = (message) => {
    try { ctx.logger?.warn?.('[session-overview] ' + message) } catch {}
  }
  const svc = (serviceName) => {
    try { return ctx.get(serviceName) } catch { return undefined }
  }
  const normPath = (value) => String(value ?? '').split('\\').join('/').replace(/\/+$/, '').toLowerCase()

  // 投影 snapshot 可能对脏数据抛错 → try/catch 降级为空值（API:1418-1426 先例）
  const safeValues = (fn) => {
    try { return fn()?.values ?? {} } catch (error) {
      warn('snapshot failed: ' + (error?.message ?? error))
      return {}
    }
  }

  const tailEventTime = (session) => {
    try {
      const events = session?.events
      if (!events || !events.length) return null
      const last = typeof events.at === 'function' ? events.at(-1) : events[events.length - 1]
      return Number.isFinite(last?.time) ? last.time : null
    } catch { return null }
  }

  // blank 判定兜底：没有 turn/start 就不算开始（API:1191-1193）
  const started = (session) => {
    try {
      const events = session?.events
      if (!events || !events.some) return false
      return events.some((event) => event?.type === 'turn/start')
    } catch { return false }
  }

  // running：agents.get(id)?.status === 'running'（ART:45；冷会话天然 undefined→false）
  const agentStatus = (sessionId) => {
    try { return svc('agents')?.get(sessionId)?.status ?? null } catch { return null }
  }

  // —— 单行摘要（attached）：与 API:2160-2167 summarizeAttached 同构 ——
  function rowOfAttached(session) {
    const values = safeValues(() => svc('sessionProjections')?.snapshot(session))   // PROJ:153 同步
    const meta = values.sessionListMetadata ?? {}
    const header = session?.header ?? {}
    return {
      id: session.id,
      title: values.title ?? null,                                                  // 投影 key "title"
      running: agentStatus(session.id) === 'running',
      blank: typeof meta.blank === 'boolean' ? meta.blank : !started(session),
      updatedAt: Math.max(header.createdAt ?? 0, meta.lastPromptAt ?? 0),           // API:1213-1215 官方口径
      lastEventAt: tailEventTime(session),
      cwd: header.cwd ?? null,
      origin: header.origin ?? null,                                                // SESt:64-70（t24 子代理过滤）
      delegationDepth: header.delegationDepth ?? 0,
      attached: true,
    }
  }

  // —— 单行摘要（cold，零 I/O）：与 API:2178-2186 summarizeCold 思路同构 ——
  function rowOfCold(headerRow) {
    const values = safeValues(() => svc('sessionProjectionCache')?.cachedSnapshot(headerRow)) // PCACHE:79
    const meta = values.sessionListMetadata ?? {}
    return {
      id: headerRow.id,
      title: values.title ?? null,
      running: false,                                                               // 冷会话必不 running
      blank: meta.blank ?? false,
      updatedAt: Math.max(headerRow.createdAt ?? 0, meta.lastPromptAt ?? 0),
      lastEventAt: null,
      cwd: headerRow.cwd ?? null,
      origin: headerRow.origin ?? null,                                             // SESt:64-70（t24 子代理过滤）
      delegationDepth: headerRow.delegationDepth ?? 0,
      attached: false,
    }
  }

  // ── t30 缓存状态：事件驱动失效 + 增量行复用 ──
  let cacheRows = null            // 最近一次全量结果（/api/state 直接返回，毫秒级）
  let cacheDirty = true
  let lastComputeAt = 0
  let inflight = null
  let dirtyTimer = null
  let lastStats = null            // { ms, hits, misses, total }
  let servedFromCache = false     // 最近一次 listRows 是否直接命中缓存
  const rowCache = new Map()      // id → { key, out }：key 未变的会话跳过投影快照重算

  const dbgOn = () => { try { return localStorage.getItem('dsh-so-debug') === '1' } catch { return false } }

  // 廉价部分（不碰投影快照）：attached 用事件扫描，cold 全来自持久化 header
  function cheapPartAttached(session) {
    const header = session?.header ?? {}
    return {
      id: session.id,
      running: agentStatus(session.id) === 'running',
      origin: header.origin ?? null,
      delegationDepth: header.delegationDepth ?? 0,
      cwd: header.cwd ?? null,
      createdAt: header.createdAt ?? 0,
      lastEventAt: tailEventTime(session),
      startedOk: started(session),                       // blank 廉价判定前置（与投影同义 API:1191-1193）
      attached: true,
    }
  }
  function cheapPartCold(headerRow) {
    return {
      id: headerRow.id,
      running: false,                                    // 冷会话必不 running
      origin: headerRow.origin ?? null,
      delegationDepth: headerRow.delegationDepth ?? 0,
      cwd: headerRow.cwd ?? null,
      createdAt: headerRow.createdAt ?? 0,
      lastEventAt: null,
      startedOk: true,                                   // cold 无事件可扫 → 不做廉价过滤，交给全量复核
      attached: false,
    }
  }

  // 全量聚合（增量版）：attached ∪ cold 去重、归档打标、过滤 blank/子代理、新→旧；
  // key（createdAt|lastEventAt|running|origin|depth|cwd）未变的会话整行复用，
  // 变化/新增才走投影快照。
  async function computeRows() {
    const t0 = Date.now()
    var hits = 0
    var misses = 0
    const byId = new Map()

    for (const session of svc('sessions')?.list() ?? []) {                          // SES:398 创建序
      if (session?.id) byId.set(session.id, { attached: true, session })
    }

    const persistence = svc('sessionPersistence')
    if (persistence?.list) {
      try {
        for (const headerRow of (await persistence.list()) ?? []) {                 // PERS:176 轻量元数据
          if (headerRow?.id && !byId.has(headerRow.id)) byId.set(headerRow.id, { attached: false, headerRow })
        }
      } catch (error) { warn('persistence.list failed: ' + (error?.message ?? error)) }
    }

    // workspace 归属：会话 cwd 归一化后对 ws.path 匹配；未命中显示「未分组」
    let archived = new Set()
    const wsByPath = new Map()
    try {
      const registry = svc('workspaceRegistry')                                     // WST:20-43
      archived = new Set(registry?.archivedSessionIds ?? [])
      for (const ws of registry?.list() ?? []) {
        if (ws?.path) wsByPath.set(normPath(ws.path), ws.title || ws.path)
      }
    } catch {}

    const rows = []
    for (const entry of byId.values()) {
      const part = entry.attached ? cheapPartAttached(entry.session) : cheapPartCold(entry.headerRow)
      if (part.origin === 'subagent' || (part.delegationDepth ?? 0) > 0) continue   // t24：子代理过滤（廉价字段即可判定）
      if (!part.startedOk && !part.running) continue                                // blank 廉价前置过滤

      const key = [part.createdAt, part.lastEventAt, part.running ? 1 : 0, part.origin,
        part.delegationDepth, part.cwd, part.attached ? 1 : 0].join('|')
      const cached = rowCache.get(part.id)
      if (cached && cached.key === key) {                                           // t30：未变 → 整行复用
        hits++
        cached.out.archived = archived.has(cached.out.id)
        cached.out.workspace = (cached.out.cwd && wsByPath.get(normPath(cached.out.cwd))) || null
        rows.push(cached.out)
        continue
      }
      misses++
      const full = entry.attached ? rowOfAttached(entry.session) : rowOfCold(entry.headerRow)
      if (full.blank && !full.running) continue                                     // 权威 blank 复核（兜底）
      const out = {
        id: full.id,
        title: full.title,
        workspace: (full.cwd && wsByPath.get(normPath(full.cwd))) || null,
        running: full.running === true,
        archived: archived.has(full.id),
        lastActivity: Math.max(full.updatedAt ?? 0, full.lastEventAt ?? 0) || null,
        attached: full.attached,
        cwd: full.cwd,
        origin: full.origin ?? null,                                                // t24：顺带带出便于调试
      }
      rowCache.set(part.id, { key: key, out: out })
      rows.push(out)
    }
    rows.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))              // API:2201 新→旧
    lastStats = { ms: Date.now() - t0, hits: hits, misses: misses, total: rows.length }
    if (dbgOn()) {
      try { (console.debug || console.log).call(console, '[session-overview][cache]', JSON.stringify(lastStats)) } catch (e) {}
    }
    return rows
  }

  // 重算入口：合并并发；完成后更新缓存快照
  function recompute() {
    if (inflight) return inflight
    inflight = (async () => {
      cacheRows = await computeRows()
      cacheDirty = false
      lastComputeAt = Date.now()
      return cacheRows
    })()
    inflight.then(function () { inflight = null }, function () { inflight = null })
    return inflight
  }

  // t30：脏标记 → ≥500ms 防抖合并后台重算
  function markDirty() {
    cacheDirty = true
    if (dirtyTimer) return
    dirtyTimer = setTimeout(function () {
      dirtyTimer = null
      if (cacheDirty) recompute().catch(function () {})
    }, 500)
  }

  async function listRows() {
    if (cacheRows && !cacheDirty) {
      servedFromCache = true                                                 // 缓存命中（毫秒级）
      if (Date.now() - lastComputeAt > 10000) {                              // 自愈保险：事件监听失效时后台刷新
        cacheDirty = true
        recompute().catch(function () {})
      }
      return cacheRows
    }
    servedFromCache = false                                                  // 脏/首载：同步重算一次
    await recompute()
    return cacheRows ?? []
  }

  function getStats() {
    return Object.assign({}, lastStats || {}, {
      fromCache: servedFromCache,
      cached: !!(cacheRows && !cacheDirty),
      ageMs: cacheRows ? (Date.now() - lastComputeAt) : null,
    })
  }

  return { listRows: listRows, markDirty: markDirty, getStats: getStats }
}

// ----------------------------------------------------------------------------
// 面板页（完整 HTML，中文界面）。内嵌脚本刻意不用模板字符串，避免转义问题。
// ----------------------------------------------------------------------------

const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>会话总览 · dsh-session-overview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f1117; color: #e5e7eb;
         font: 14px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; justify-content: space-between; align-items: center;
           gap: 12px; flex-wrap: wrap; }
  h1 { font-size: 18px; margin: 0; letter-spacing: .5px; }
  .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  input[type="search"] { background: #161a23; border: 1px solid #2a3040; border-radius: 8px;
                         color: #e5e7eb; padding: 7px 10px; width: 240px; outline: none; }
  input[type="search"]:focus { border-color: #4b82f0; }
  label.toggle { color: #9ca3af; display: flex; gap: 6px; align-items: center;
                 cursor: pointer; user-select: none; white-space: nowrap; }
  button { background: #2563eb; border: none; border-radius: 8px; color: #fff;
           padding: 7px 14px; cursor: pointer; font-size: 13px; }
  button:hover { background: #1d4ed8; }
  button:disabled { opacity: .6; cursor: default; }
  @keyframes sofade { from { opacity: .55; } to { opacity: 1; } }
  .so-fade { animation: sofade .35s ease; }
  .meta { color: #8b93a7; margin: 14px 2px 10px; font-size: 12.5px; }
  .banner { background: #3f1d24; border: 1px solid #7f2e3c; color: #fca5a5;
            padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; background: #12151d;
          border: 1px solid #232936; border-radius: 10px; overflow: hidden; }
  thead th { text-align: left; font-size: 12px; color: #8b93a7; font-weight: 600;
             padding: 10px 12px; background: #171b25; border-bottom: 1px solid #232936; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #1b202b; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: #161a24; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block;
         margin-right: 7px; vertical-align: middle; }
  .dot.run { background: #34d399; box-shadow: 0 0 8px rgba(52,211,153,.55);
             animation: pulse 1.6s ease-in-out infinite; }
  .dot.idle { background: #6b7280; }
  .dot.unread { background: #4b82f0; }
  .dot.archived { background: #d97706; }
  @keyframes pulse { 50% { opacity: .45; } }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 2px 10px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 6px;
          background: transparent; border: 1px solid #2a3040; color: #9aa3b5;
          font-size: 12px; padding: 3px 10px; border-radius: 999px; cursor: pointer; }
  .chip.on { border-color: #4b82f0; color: #c9cfdb; background: rgba(75,130,240,.14); }
  .chip .dot { margin-right: 0; }
  .dot.all { background: transparent; border: 2px solid #6b7280; width: 7px; height: 7px; }
  .chip.on .dot.all { border-color: #4b82f0; }
  tr.group-row td { background: #171b25; color: #aab3c5; font-size: 12px; font-weight: 600;
                    letter-spacing: .4px; border-bottom: 1px solid #232936; padding: 8px 12px; }
  td.act { width: 96px; text-align: right; white-space: nowrap; }
  .mini { background: transparent; border: 1px solid #2a3040; color: #9aa3b5;
          font-size: 12px; padding: 3px 9px; border-radius: 6px; }
  .mini:hover { border-color: #4b82f0; color: #c9cfdb; background: rgba(75,130,240,.08); }
  .st { font-size: 13px; color: #c9cfdb; white-space: nowrap; }
  .title { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ws { color: #9aa3b5; font-size: 13px; max-width: 260px; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
  .ws.none { color: #586074; }
  .time { color: #9aa3b5; font-size: 13px; white-space: nowrap; }
  .empty { text-align: center; color: #6b7280; padding: 42px 0; font-size: 13.5px; }
  footer { margin-top: 18px; color: #4b5265; font-size: 12px; text-align: center; }
  @media (prefers-color-scheme: light) {
    body { background: #f5f6f8; color: #24292f; }
    table { background: #fff; border-color: #dde1e7; }
    thead th { background: #eef1f5; color: #57606a; border-color: #dde1e7; }
    tbody td { border-color: #eceff3; }
    tbody tr:hover { background: #f6f8fa; }
    input[type="search"] { background: #fff; border-color: #d0d7de; color: #24292f; }
    button { background: #0969da; } button:hover { background: #0757ba; }
    .meta, .ws, .time { color: #656d76; } .ws.none { color: #9ea7b3; }
    .empty { color: #8c959f; } footer { color: #a0a8b4; } .st { color: #3a4149; }
    .banner { background: #ffebe9; border-color: #ffc1bc; color: #b35957; }
    tr.group-row td { background: #eef1f5; color: #57606a; border-color: #dde1e7; }
    .mini { border-color: #d0d7de; color: #656d76; }
    .mini:hover { border-color: #0969da; color: #24292f; background: rgba(9,105,218,.06); }
    .chip { border-color: #d0d7de; color: #656d76; }
    .chip.on { border-color: #0969da; color: #24292f; background: rgba(9,105,218,.08); }
    .dot.all { border-color: #9aa3b5; } .chip.on .dot.all { border-color: #0969da; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>📋 会话总览</h1>
    <div class="toolbar">
      <input id="q" type="search" placeholder="按标题搜索…" autocomplete="off">
      <label class="toggle"><input id="auto" type="checkbox"> 自动刷新(5s)</label>
      <label class="toggle"><input id="grouped" type="checkbox" checked> 分组</label>
      <button id="refresh" type="button">手动刷新</button>
      <button id="ackall" type="button">全部标为已读</button>
    </div>
  </header>
  <div class="chips" id="chips">
    <button type="button" class="chip on" data-filter="all"><i class="dot all"></i>全部</button>
    <button type="button" class="chip" data-filter="running"><i class="dot run"></i>运行中</button>
    <button type="button" class="chip" data-filter="unread"><i class="dot unread"></i>未读</button>
    <button type="button" class="chip" data-filter="idle"><i class="dot idle"></i>空闲</button>
    <button type="button" class="chip" data-filter="archived"><i class="dot archived"></i>归档</button>
  </div>
  <div class="meta" id="meta">加载中…</div>
  <div class="banner" id="banner" hidden></div>
  <div id="tblbox"></div>
  <div class="empty" id="empty" hidden></div>
  <footer>dsh-session-overview · 数据来自本机 DSH 宿主进程，仅本地展示</footer>
</div>
<script>
(function () {
  var AUTO_MS = 5000;
  var SEEN_KEY = 'dsh-so-seen';
  var GROUP_KEY = 'dsh-so-grouped';
  var AUTOREF_KEY = 'dsh-so-autorefresh';
  var FILTERS_KEY = 'dsh-so-filters';
  var CACHE_KEY = 'dsh-so-cache';     // t30 秒开：最近一次成功 rows
  var FILTER_VALUES = ['all', 'running', 'unread', 'idle', 'archived'];
  var FILTER_TO_STATE = { running: 'run', unread: 'unread', idle: 'idle', archived: 'arch' };
  var rows = [];
  var seen = loadSeen();
  var activeFilter = loadFilter();   // 单选：'all'|'running'|'unread'|'idle'|'archived'（t13）
  var timer = null;
  var loading = false;
  var renderFromCache = false;       // 最近一次 render 是否来自缓存（新数据到达时轻微淡入）
  var pendingRollback = {};          // t30 乐观已读回滚账本：sessionId → 写入前 seen（null=原本无记录）
  var STATE_LABEL = { run: '运行中', unread: '新完结·未读', idle: '空闲', arch: '已归档' };
  var STATE_DOT = { run: 'run', unread: 'unread', idle: 'idle', arch: 'archived' };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rel(ts) {
    if (!ts) return '—';
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    if (diff < 45000) return '刚刚';
    var m = Math.floor(diff / 60000);
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + ' 个月前';
    return new Date(ts).toLocaleDateString('zh-CN');
  }
  function clock() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function loadSeen() {
    try {
      var obj = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch (e) { return {}; }
  }
  function saveSeen() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
  }
  // 状态筛选：单选语义；localStorage 存单字符串 'all'|'running'|'unread'|'idle'|'archived'，
  // 旧多选对象值解析后不是合法字符串 → 优雅降级为 'all'（t13）
  function loadFilter() {
    try {
      var v = JSON.parse(localStorage.getItem(FILTERS_KEY) || 'null');
      if (typeof v === 'string' && FILTER_VALUES.indexOf(v) !== -1) return v;
    } catch (e) {}
    return 'all';
  }
  function saveFilter() {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(activeFilter)); } catch (e) {}
  }
  function paintChips() {
    var chips = document.querySelectorAll('#chips .chip');
    for (var i = 0; i < chips.length; i++) {
      var f = chips[i].getAttribute('data-filter');
      if (f) chips[i].className = 'chip' + (f === activeFilter ? ' on' : '');
    }
  }
  // 未读：本地判定，账本持久于 localStorage，刷新不清账
  function isUnread(r) {
    return !r.running && !r.archived && !!r.lastActivity && r.lastActivity > (seen[r.id] || 0);
  }
  // 四态优先级：running > archived > unread > idle
  function stateOf(r) {
    if (r.running) return 'run';
    if (r.archived) return 'arch';
    if (isUnread(r)) return 'unread';
    return 'idle';
  }
  function grouped() { return $('grouped').checked; }
  function filtered() {
    var q = ($('q').value || '').trim().toLowerCase();
    return rows.filter(function (r) {
      if (activeFilter !== 'all' && FILTER_TO_STATE[activeFilter] !== stateOf(r)) return false;   // 单选门控（t13）
      if (!q) return true;
      var hay = ((r.title || '') + ' ' + (r.id || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  function rowHtml(r) {
    var st = stateOf(r);
    var badge = '<span class="dot ' + STATE_DOT[st] + '"></span>' + STATE_LABEL[st];
    var title = r.title ? esc(r.title) : '<span class="ws none">(未命名)</span>';
    var wsCell = r.workspace ? esc(r.workspace) : '<span class="ws none">未分组</span>';
    var full = r.lastActivity ? new Date(r.lastActivity).toLocaleString('zh-CN') : '';
    var act = isUnread(r)
      ? '<button type="button" class="mini mark" data-id="' + esc(r.id) + '">标为已读</button>'
      : '';
    return '<tr data-session="' + esc(r.id) + '">'
      + '<td class="st">' + badge + '</td>'
      + '<td class="title" title="' + esc(r.id) + '">' + title + '</td>'
      + '<td class="ws" title="' + esc(r.cwd || '') + '">' + wsCell + '</td>'
      + '<td class="time" title="' + esc(full) + '">' + rel(r.lastActivity) + '</td>'
      + '<td class="act">' + act + '</td>'
      + '</tr>';
  }
  // 工作区分组：组间按组内最新活动新→旧，「未分组」固定最后
  function buildGroups(list) {
    var map = new Map();
    for (var i = 0; i < list.length; i++) {
      var key = list[i].workspace || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(list[i]);
    }
    var arr = [];
    map.forEach(function (items, key) {
      var latest = 0;
      for (var k = 0; k < items.length; k++) {
        if ((items[k].lastActivity || 0) > latest) latest = items[k].lastActivity || 0;
      }
      arr.push({ name: key || '未分组', none: !key, items: items, latest: latest });
    });
    arr.sort(function (a, b) {
      if (a.none !== b.none) return a.none ? 1 : -1;
      return b.latest - a.latest;
    });
    return arr;
  }
  function render(cacheNote) {
    var list = filtered();
    var runCount = 0, unreadCount = 0, archCount = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].running) runCount++;
      if (isUnread(list[i])) unreadCount++;
      if (list[i].archived) archCount++;
    }
    // 统计跟随当前筛选口径；总数以「显示 x / 共 N」注明（t11）
    $('meta').textContent = '显示 ' + list.length + ' / 共 ' + rows.length
      + ' · 运行中 ' + runCount + ' · 未读 ' + unreadCount + ' · 归档 ' + archCount
      + ' · 上次刷新 ' + clock() + (cacheNote ? '（' + cacheNote + '）' : '');

    var bodies = '';
    if (grouped()) {
      var groups = buildGroups(list);
      for (var g = 0; g < groups.length; g++) {
        bodies += '<tbody><tr class="group-row"><td colspan="5">'
          + esc(groups[g].name) + ' · ' + groups[g].items.length + ' 个</td></tr>';
        for (var m = 0; m < groups[g].items.length; m++) bodies += rowHtml(groups[g].items[m]);
        bodies += '</tbody>';
      }
    } else {
      bodies += '<tbody>';
      for (var n = 0; n < list.length; n++) bodies += rowHtml(list[n]);
      bodies += '</tbody>';
    }
    $('tblbox').innerHTML = bodies
      ? '<table><thead><tr><th>状态</th><th>会话标题</th><th>Workspace</th><th>最近活动</th><th></th></tr></thead>'
        + bodies + '</table>'
      : '';
    var emptyEl = $('empty');
    if (list.length === 0) {
      emptyEl.hidden = false;
      if (rows.length === 0) {
        emptyEl.textContent = '暂无会话 —— 打开或新建一个会话后，这里就会出现它们。';
      } else if (activeFilter !== 'all') {
        emptyEl.textContent = '当前状态筛选下没有会话 —— 点「全部」chip 恢复显示。';
      } else {
        emptyEl.textContent = '没有匹配「' + ($('q').value || '').trim() + '」的会话。';
      }
    } else {
      emptyEl.hidden = true;
    }
  }
  async function load() {
    if (loading) return;
    loading = true;
    $('refresh').disabled = true;
    try {
      var res = await fetch('/dsh-session-overview/api/state', { cache: 'no-store' });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      rows = data.rows || [];   // 刷新只换数据，不动 seen 账本
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rows: rows })); } catch (e) {}   // t30 秒开缓存
      $('banner').hidden = true;
      if (renderFromCache) {                                // t30：缓存秒开后的新数据轻微淡入
        var boxEl = $('tblbox');
        boxEl.classList.remove('so-fade');
        void boxEl.offsetWidth;
        boxEl.classList.add('so-fade');
        renderFromCache = false;
      }
    } catch (e) {
      $('banner').textContent = '加载失败：' + (e && e.message ? e.message : e);
      $('banner').hidden = false;
    }
    loading = false;
    $('refresh').disabled = false;
    render();
  }
  function setAuto(on) {
    if (timer) { clearInterval(timer); timer = null; }
    if (on) timer = setInterval(load, AUTO_MS);
  }
  $('q').addEventListener('input', render);
  $('refresh').addEventListener('click', load);
  $('auto').addEventListener('change', function () {
    try { localStorage.setItem(AUTOREF_KEY, this.checked ? '1' : '0'); } catch (e) {}   // t11：偏好记忆
    setAuto(this.checked);
  });
  $('chips').addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button.chip') : null;
    if (!btn) return;
    var f = btn.getAttribute('data-filter');
    if (!f) return;
    // 单选互斥：点状态 chip 只显示该状态；再点已选中项或点「全部」→ 恢复显示全部（t13）
    activeFilter = (f === activeFilter) ? 'all' : f;
    saveFilter();
    paintChips();
    render();
  });
  $('tblbox').addEventListener('click', function (ev) {
    if (!ev.target || !ev.target.closest) return;
    var mark = ev.target.closest('button.mark');
    if (mark) {                                           // 已读按钮优先，不触发跳转
      var mid = mark.getAttribute('data-id');
      if (mid) { seen[mid] = Date.now(); saveSeen(); render(); }
      return;
    }
    var tr = ev.target.closest('tr[data-session]');
    if (!tr) return;
    var id = tr.getAttribute('data-session');
    if (!id) return;
    // t30 乐观已读：点击瞬间写账本并重渲染（蓝点即消）；navigated ok=false 时按
    // pendingRollback 回滚。仅 GUI 内嵌 iframe 有父界面；独立标签页只记已读不跳转。
    if (!Object.prototype.hasOwnProperty.call(pendingRollback, id)) {
      pendingRollback[id] = Object.prototype.hasOwnProperty.call(seen, id) ? seen[id] : null;
    }
    seen[id] = Date.now();
    saveSeen();
    render();
    // 行点击跳转（NOTES-nav §3）：仅 GUI 内嵌 iframe 有父界面；独立标签页静默忽略。
    if (window.parent && window.parent !== window) {
      try {
        if (localStorage.getItem('dsh-so-debug') === '1') {
          (console.debug || console.log).call(console, '[session-overview][page]', JSON.stringify({ evt: 'navigate-posted', sessionId: id }));
        }
      } catch (e) {}
      window.parent.postMessage({ type: 'dsh-so:navigate', sessionId: id }, location.origin);
    }
  });
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin) return;            // 同源校验
    var d = ev.data;
    if (!d || d.type !== 'dsh-so:navigated' || !d.sessionId) return;
    if (!d.ok) {                                          // t30：跳转失败 → 回滚乐观已读（蓝点恢复）
      if (Object.prototype.hasOwnProperty.call(pendingRollback, d.sessionId)) {
        var prev = pendingRollback[d.sessionId];
        if (prev === null) delete seen[d.sessionId]; else seen[d.sessionId] = prev;
        delete pendingRollback[d.sessionId];
        saveSeen();
        render();
      }
      return;
    }
    seen[d.sessionId] = Date.now();                       // 跳转成功：确认乐观已读
    delete pendingRollback[d.sessionId];
    saveSeen();
    render();                                             // t28：立即更新内存账本并重渲染（不等下次 load）
    try {
      if (localStorage.getItem('dsh-so-debug') === '1') {
        (console.debug || console.log).call(console, '[session-overview][page]', JSON.stringify({ evt: 'navigated-ok', sessionId: d.sessionId }));
      }
    } catch (e) {}
  });
  $('ackall').addEventListener('click', function () {
    for (var i = 0; i < rows.length; i++) {
      if (isUnread(rows[i])) seen[rows[i].id] = Date.now();
    }
    saveSeen();
    render();
  });
  $('grouped').addEventListener('change', function () {
    try { localStorage.setItem(GROUP_KEY, this.checked ? '1' : '0'); } catch (e) {}
    render();
  });
  try { $('grouped').checked = localStorage.getItem(GROUP_KEY) !== '0'; } catch (e) {}
  try { $('auto').checked = localStorage.getItem(AUTOREF_KEY) === '1'; } catch (e) {}   // t11：默认关
  paintChips();
  try {                                                     // t30 秒开：先渲染本地缓存，再后台取新
    var cachedBoot = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cachedBoot && Array.isArray(cachedBoot.rows)) {
      rows = cachedBoot.rows;
      renderFromCache = true;
      render('缓存');
    }
  } catch (e) {}
  setAuto($('auto').checked);
  load();
})();
</script>
</body>
</html>
`
