# dsh-session-overview 注入验收清单（t4 用）

> 作者：scout-data · 任务 t6 · 供队长在 t4「注入验证与用户验收」按序执行。
> 依据：本人 NOTES-data.md（数据面）、scout-ui NOTES-contract.md（接线契约）、
> 注入器源码【INJ】=`~/.dsh/profiles/web/node_modules/@dsh-external/dsh-super-injector/lib/index.js`、
> 宿主 client-modules【CM】=`...\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-modules\lib\index.js`。
> 约定：包名 `@dsh-external/dsh-session-overview`，插件目录 `<plugin-dir>`，
> GUI 基址 `http://127.0.0.1:3080`。
> ⚠️ 用户红线（记忆 mem_b6bd）：整个验收过程不得自动连接任何远程服务器；只操作本机。

---

## 1. 注入成功的判据

### 1.1 注入命令输出（第一判据）

执行 `dev_inject_plugin dir=<plugin-dir>`，期望输出
（精确格式出自【INJ】:8422，逐字核对）：

```
OK: @dsh-external/dsh-session-overview 已注入（junction=C:\Users\<user>\.dsh\profiles\web\node_modules\@dsh-external\dsh-session-overview）
- host ✓
- client ✓ (lib/client.js)
```

| 检查点 | 通过标准 | 依据 |
|---|---|---|
| 首行 `OK: … 已注入（junction=…）` | 出现且 junction 指向 profile node_modules 下同名目录 | 【INJ】:8380-8395 建 junction、:8422 返回格式 |
| `- host ✓` | 必须出现（loader entry 已激活） | 【INJ】:8419 `hasActiveEntry` |
| `- client ✓ (lib/client.js)` | **必须出现这一整行** | 【INJ】:8300 `clientStatus()` 成功分支 |
| 幂等重入 | `INFO: … 已激活运行，跳过注入` 也算通过 | 【INJ】:8378 |

**已知陷阱**：若输出里 **完全没有 client 行**（既无 ✓ 也无 ✗），说明走了 registry捷径路径、
client 模块行没挂上，浏览器将 404 拿不到 client.js —— 处置固定为
`dev_uninject_plugin` + `dev_inject_plugin` 重走完整注入路径（教训存档 mem_78d02，
2026-08-21 dsh-pi-fleet 实证）。

注入前置自检（预检红线，【INJ】`buildFreshnessProblems` :8535-8606，违反直接拒绝注入）：
- package.json **无 UTF-8 BOM**；
- 声明了 `dsh.client` 则必须存在 `lib/client.js`，且内容含字符串 `__ModuleLoader__`（:8590-8593）；
- 注册的 slot 名 ∈ 白名单（【INJ】:8502-8514，见 NOTES-contract §3.3）。

### 1.2 HTTP 判据（确切 URL 与期望响应）

| # | URL（基址 127.0.0.1:3080） | 期望响应 | 出处 |
|---|---|---|---|
| A | `/plugins/@dsh-external/dsh-session-overview/client.js` | **200**，JS 文本；body 以 ``window.__ModuleLoader__.load({`` 开头且包含字面量 `@dsh-external/dsh-session-overview` | 路由 `/plugins/<id>/client.js`【CM】:457-459、:71；外壳形状【VIZ】lib/client.js:1-8 |
| B | `/plugins/@dsh-external/dsh-session-overview/client.js.map` | 200 或 404 均可（source map 非必需） | 【CM】:458 mapSuffix |
| C | `/dsh-session-overview/api/<子路径>`（engineer 按 NOTES-contract §2.3 注册的 prefix 路由，建议至少一个 `/state`） | **200** + `content-type: application/json`；body 为合法 JSON（期望含 rows 数组，字段见 §2.1） | 契约范例 NOTES-contract §2.3（【INJ】:7007-7042、9629-9695 同构） |
| D | 页面加载 | GUI 正常渲染、DevTools Console 无新报错 | boot 清单机制【CM】:152-160、215-238 |

> 注意：**注入/改代码后必须硬刷新页面**——client bundle 经 `window.__DSH_BOOT__`
> 启动清单加载（带 `?rev=` 穿缓存，【CM】:155），本环境没有 `pnpm run dev:web`
> watcher，不存在自动热更新。

### 1.3 进程内判据（dev 工具读数）

- `dev_injected_list` 新增一行：`- @dsh-external/dsh-session-overview @ <plugin-dir>（<ISO 时间>）`
- `dev_plugin_status` 的 loader entries 尾部出现 `[active] <短id> (@dsh-external/dsh-session-overview) [injected]`
  （真实样例参照现存 `[active] a32597aa (@dsh-external/dsh-graph-engineering) [injected]`）

---

## 2. 数据正确性抽查点

### 2.1 API 数据面抽查（对照 NOTES-data.md）

对 §1.2-C 端点返回的每行 row 断言（字段定义全部见 NOTES-data §3.1/§4）：

1. **行结构完整**：attached 行必含 `sessionId / running / blank / updatedAt`；
   `title` 允许 `null`（blank 会话无标题）；`cwd / origin / agentPreset / parentSessionId` 允许缺省。
2. **总数口径**：`rows.length ≥ 侧边栏可见会话数`（面板含冷会话；若面板默认过滤 blank+归档，
   则两侧应相等，见 §2.2）。
3. **至少一个已知标题出现**：任取一个正在用的会话，其标题（来自投影 `values.title`，
   dsh-session-title/lib/index.js:178-186）在 rows 中能找到。
4. **running 徽章**：向某会话发一条消息使其进入运行 → 该行 running=true（UI 徽章变绿）；
   turn 结束回到 idle → 徽章熄灭。枚举只有 `'idle'|'running'`（dsh-agent runtime-types.d.ts:45），
   翻转沿 `agent/status` 事件（apiproxy index.js:3639-3645）。
5. **updatedAt 排序新→旧**：rows 按 updatedAt 单调不增（官方口径
   `items.sort((a,b)=>b.updatedAt-a.updatedAt)`，apiproxy:2201；数值=max(createdAt,lastPromptAt)，apiproxy:1213-1215）。
6. **workspace 分组**：至少一个分组非空；组内 sessionId ⊆ 该 workspace 的 `sessionIds`
   （实体字段 dsh-workspace types.d.ts:20-43）。

### 2.2 与官方侧边栏对照（用户可视一致性）

1. 数侧边栏会话列表条数 N。
2. 面板开启默认过滤（blank && !running 隐藏、归档隐藏）后，未归档会话计数应等于 N。
   官方可见性两条规则：blank 会话列表隐藏（apiproxy:1184-1193 注释 "list-hidden"）、
   cold 行要求 `meta.cwd !== undefined`（apiproxy:2173）、归档集
   `workspaceRegistry.archivedSessionIds`（dsh-workspace types index.d.ts:116）。
3. 任选侧边栏一个标题 → 面板能定位同一行（标题一致性）。

### 2.3 实时性冒烟

1. 新建空会话 → 发第一条消息 → 总览出现该会话，稍后标题从 null 变为 fallback/provider 标题
   （session-title 服务自动落 `session/title` 事件）。
2. 运行中的会话徽章绿；结束后熄灭（§2.1-4 同源，此处看 UI 反映延迟是否可接受，建议 ≤2s 或手动刷新兜底）。

---

## 3. 边界回归

| 场景 | 操作 | 期望 |
|---|---|---|
| 空 workspace | 选/建一个无会话 workspace | 面板显示空分组 + 空态文案；不报错、不白屏 |
| 冷会话（只存在于 persistence） | 从 `~/.dsh/sessions/<项目目录>/<guid>/` 挑一个当前未打开的会话 id（布局实证：项目 key 如 `--D-apps-dsh_plugins-`，内层为 session 目录 + session.jsonl） | 出现在总览：`attached=false`、`running=false`（冷会话恒 false，apiproxy:1277）、title 取缓存投影或 null（sessionProjectionCache.cachedSnapshot，PCACHE d.ts:79） |
| blank 会话 | 新建会话、不发消息 | 默认被过滤不可见（NOTES-data §5.5 建议）；若有"显示空会话"开关，切换后以"空会话"样式可见 |
| 可选服务缺失降级 | 无法安全卸载宿主服务来模拟——最低标准：rows 中 title=null 的行渲染为占位文案；Console 干净 | 面板不白屏（对应 NOTES-data §4 草稿里全部 `ctx.get(...)` 判空分支生效） |
| 归档会话 | 对比 `archivedSessionIds` 集合 | 默认隐藏，或有明确"已归档"标识且不计入 §2.2 计数 |
| 子 agent 会话 | 找 `origin==='subagent'` 或 `delegationDepth>0` 的行（dsh-session types.d.ts:64-70） | 有视觉区分（分组/徽标），不混入顶层会话流 |
| cwd 缺失的冷会话 | （如有此类数据）| 官方列表不展示（apiproxy:2173）；面板跟随官方口径过滤，或给出"未归类"分区——两者择一并在 UI 说明 |
| 用户红线 | DevTools Network 面板观察 | 全部请求仅指向 127.0.0.1；**零**外部/SSH/轮询连接（mem_b6bd） |

---

## 4. 回滚方法（卸载即净验证）

1. 执行 `dev_uninstall` 对应命令：`dev_uninject_plugin match=dsh-session-overview`。
   期望输出（【INJ】:8483 格式，steps 逐项出现）：
   ```
   OK: 卸载完成
   - entry 已卸载: @dsh-external/dsh-session-overview
   - profile patch 已写 disabled（阻断自装配，防 refresh 加回；…）   ← 若 patch 已有该 id 则显示“幂等跳过”（【INJ】:8446-8451）
   - registry 已清理
   - junction 已删除: …\profiles\web\node_modules\@dsh-external\dsh-session-overview
   - client 模块表已清理
   ```
   （五步的语义分别对应【INJ】:8429-8478 的 entry 卸载 / patch disabled / registry 清理 /
   junction 删除 / client 行清理。）
2. **复验四连**（全部满足才算净）：
   - `dev_injected_list` 不再列出该包；
   - `dev_plugin_status` 无 `(@dsh-external/dsh-session-overview)` 条目；
   - `curl /plugins/@dsh-external/dsh-session-overview/client.js` → **404**；
   - 浏览器硬刷新 → 总览入口消失，GUI 其余功能正常（会话可开、侧边栏正常）。
3. 残留自愈：
   - 若 client.js 仍 200（路由残留）：`dev_clear_routes prefix=/plugins/@dsh-external/dsh-session-overview`，
     以及（若 engineer 用了自有前缀）`dev_clear_routes prefix=/dsh-session-overview`，然后重复复验；
   - profile cordis.patch.yml 里留下的 `disabled: true` 条目是**预期产物**（防 bundle 自装配加回，
     【INJ】:8451），保留勿删；将来转正 bundle 时再处理；
   - 重注即满血复活：重新 `dev_inject_plugin` 会重建 junction（【INJ】:8387-8395）并恢复一切。
4. 可选全链路体检：`dev_self_test`（假插件注入→热重载→节流→预检拦截→卸载即净→patch 合法性，
   全自恢复）——怀疑注入器本身异常时跑一次作旁证。

---

## 5. 快速排障表

| 症状 | 最可能原因 | 处置 |
|---|---|---|
| 注入输出缺 `- client ✓` 整行 | 走了 reload/捷径路径，client 行丢失（mem_78d02） | uninject + inject 完整路径 |
| 注入被预检拒绝 | package.json 带 BOM / lib/client.js 缺 `__ModuleLoader__` / slot 名不在白名单 | NOTES-contract §1.4、§3.2、§3.3 逐项修 |
| curl client.js 404 | 注入未成功或 client 行丢 | 回看 §1.1 输出；必要时 dev_clear_routes 后重注 |
| 面板不出现在 GUI | 注入后没刷新页面（boot 清单只在页面加载时注入）；或 slot 注册失败 | 硬刷新；查 Console 的 slots 报错（`cannot get property 'slots' without inject` 等，NOTES-contract §3.3） |
| rows 为空但 GUI 明明有会话 | host 侧 `ctx.get('sessions')` 判空/时序错误 | 对照 NOTES-data §4 草稿的实现 |
| 所有 title 都是 null | 投影键拼错，或 snapshot 抛错被吞 | 核对键名 `"title"`（TITLE lib/index.js:179）；给 snapshot 包 try/catch 并打日志（官方先例 apiproxy:1418-1426） |
| 卸载后 GUI 异常 | 卸载顺序被打断（极少见） | 再执行一次 uninject（幂等）→ 复验 §4-2 四连 |

---

## 6. 验收结论记录模板（t4 直接填）

```
□ 1.1 注入输出三要素（OK 行 / host ✓ / client ✓）      —— 粘贴原始输出
□ 1.2-A client.js 200 + __ModuleLoader__ 外壳          —— 粘贴 body 前 3 行
□ 1.2-C /api 端点 200 + JSON                           —— 粘贴 rows[0]
□ 1.3 dev_injected_list / dev_plugin_status 含本包      —— 截图或粘贴行
□ 2.1 六项数据断言                                     —— 逐项 ✔/✘
□ 2.2 侧边栏计数一致（N = ?）                          —— 数字
□ 2.3 新会话冒烟                                       —— ✔/✘
□ 3 边界八项                                           —— 逐项 ✔/✘/N.A.
□ 4 卸载即净四连 + 重注恢复                            —— ✔/✘
结论：PASS / FAIL（FAIL 附 §5 排障指向的问题行）
```
