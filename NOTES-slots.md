# 补充笔记：slots 落点实证 & client 运行时能力表（t5）

> 研究者：scout-ui · 任务 t5 · 是 NOTES-contract.md 的补充。
> 新证据源：宿主官方包 `...\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`（下称【OFF】内各包）与注入器自己的 client bundle `<plugins-root>\dsh-routing-suite\injector\lib\client.js`（下称【INJ-C】）。
> 注：任务提到的 dsh-pet-desktop junction 已悬空（目标 <plugins-root>\dsh-pet-desktop 不存在）、dsh-graph-engineering 的 client 无 slots/fetch/localStorage 使用，均改用更权威的官方包与注入器本体作实证。

---

## 1) `sidebar.footer.action` 与 `shell.overlay` 的确切用法

### 1.1 权威契约（宿主自带的 slot 目录）

出处：【OFF】`dsh-cordis-client-runner\lib\client.js` 3330–3504 行是宿主运行时内置的 slot 契约目录（每项含 kind/scope/registerOptions/ownerProps/standardProps/declaredBy/occupants/replaceRisk）。两个插槽的关键字段：

| | `shell.overlay`（3348–3384 行） | `sidebar.footer.action`（3443–3479 行） |
|---|---|---|
| kind / scope | **list** / root | **list** / root |
| 语义 | 框架级悬浮层：在所有列之上、滚动容器之外；**默认 click-through**，条目自行选择加入 pointer events 才拦截点击；additive——新 id 加在已有条目旁边，不替换任何东西 | 侧边栏底部 Settings 旁边的动作位（列表槽，多个动作并存） |
| registerOptions | `id` **必填**（"fresh id is added beside… reusing a shipped id puts you in THAT cell and replaces it"）；`order` 可选 number 升序默认 0；`label` 可选 string \| ()=>string（thunk 每次投影重读，跟随语言切换） | 完全相同的三项 |
| ownerProps（宿主喂给组件的列状态） | 无 | `{ wide: boolean }`（false = 56px 窄栏，只显图标） |
| standardProps（宿主喂的标准 hook） | `useSessions`、`useWorkspaces`（SnapshotSelectorHook） | 同左 |
| declaredBy | ui-layout 的 `root` 注册（存在期=AppFrame 挂载期） | ui-sidebar 的 `sidebar` 注册 |
| 现役 occupants | **空**（无内置占用者，3380 行） | `client-ui-cordis CordisPanel id 'cordis-panel'`（3475 行） |

⚠️ 反面教材（同目录 3047 行）：**不要注册 `root`** —— single slot，动态注册会以更高优先级 shadow 掉整个 AppFrame，"页面只剩你的组件，frame 声明的所有 seat 全部消失"；要全局悬浮面就去 `shell.overlay`。

声明处原文佐证：`shell.overlay` 由 ui-layout 声明为 list 槽——【OFF】`dsh-client-ui-layout\lib\client.js` 405–430 行 `ctx.slots.register({name:"root", children:{..., "shell.overlay":{kind:"list", scope:"root"}}, ...}, AppFrame)`，AppFrame 在 237 行 `children: renderSlot("shell.overlay", {})` 渲染它。

### 1.2 实例 A（真实生产代码）：`sidebar.footer.action` —— CordisPanel

出处：【OFF】`dsh-client-ui-cordis\lib\client.js` 1337–1367 行（注册）+ 664–706 行（组件）：

```js
// 注册（1337–1367）：decl 带 id + locale + inject 面，React 组件作第二参
ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "cordis-panel",
    locale: NS,
    inject: () => ({                    // ← inject 面：把服务/hook/回调喂给组件当 props
        hooks: { inventory, activeRuns: runner.activeRuns, runErrors: runner.lastRunError, loaded, renderFailures: runner.renderFailures },
        onApprove: (requestId, ok) => runner.approve(requestId, ok),
        /* ... onStop/onRemove/onRefresh 同理 */
    })
}, CordisPanel));

// 组件签名（664 行）：收到 owner prop「wide」+ standard prop「useSessions」+ inject 面的全部键
function CordisPanel({ wide, useSessions, useInventory, ..., onRefresh, t }) {
    const current = useSessions((state) => state.current);   // 670 行：标准 hook 读当前会话
    const [open, setOpen] = react.useState(false);           // 671 行：本地开合状态
    // 678–692 行：打开时用 trigger 按钮 getBoundingClientRect 定位悬浮面板，resize 重算
    // 693 行：useDismissOnOutsidePointer(rootRef, open, setOpen) —— 来自 @deepseek-ai/dsh-client-ui-primitives
```

它的悬浮面板**不是**另注册一个 shell.overlay，而是组件内部自绘 fixed 定位层（572 行 CSS：`.Nqubda_panel{position:fixed; z-index:30; width:420px; max-width:calc(100vw - 24px); max-height:60vh; ...}`），从侧边栏按钮向上弹出。
**结论：一个 `sidebar.footer.action` 条目就能承载「图标按钮（窄栏自动变圆钮，见 572 行 `.Nqubda_rail` 规则）+ 点击弹出全局面板」全套交互**——这正是「会话总览」入口的最短已验证路径。

### 1.3 实例 B：`shell.overlay`

官方包内**没有现役占用者**（契约目录 occupants 为空，3380 行），唯一权威示例是 runner 文档自带（3382 行）：

```js
return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'my-entry', order: 100, label: 'My entry' },
      () => React.createElement('div', null, 'hello'),
    ))
  },
}
```

设计意图佐证：【OFF】`dsh-client-ui-cordis\README.zh.md` 7 行——ui-cordis 把这个"框架级悬浮席位"补进 ui-layout，用于"角标计数 + 点开列出全部定义及控件"的全局应答面。渲染位置在框架根（ui-layout client.js 237 行），因此**不受任何会话/空会话状态影响**，比 conversation.view 更适合总览常驻入口。
⚠️ 注意 click-through 语义：overlay 层本身不拦点击，我们的面板根元素要自己设 `pointer-events:auto` 并给背景遮罩，否则点击会穿到下层应用。

### 1.4 vanilla DOM 组件形态实证（免 React 也行）

【INJ-C】44–151 行：注入器自己的「设置→插件管理」页用 `settings.section` 槽 + **vanilla 组件**：

```js
ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "super-injector-plugins",
    order: 50,
    label: () => "插件",
    component: () => ({ render() {
        /* document.createElement 拼页面、addEventListener 绑事件 */
        refresh();                                   // 进场先拉一次数据
        const timer = window.setInterval(refresh, 6e4);  // 60s 轮询
        return { dispose: () => window.clearInterval(timer) };  // ← render 可返回 dispose 做清理
    } }),
})), "super-injector: settings page");
```

两种组件给法并存且都合法：decl 里放 `component: () => ({render, dispose?})`（vanilla），或把 React 函数组件作 `register(decl, Component)` 第二参（CordisPanel/visualize 式）。

---

## 2) client 侧 `__ModuleLoader__` 环境能力表

### 2.1 静态 require 表（platform seed）——只有这 7 个包

构建产物的装配函数（minified，位于【OFF】`dsh-web-frontend\dist\assets\index-CA9Bpko5.js` 约 char offset 395958 处的 `function Gd()`）：

```js
function Gd() { return {
    react: e6,
    "react/jsx-runtime": i6,
    "react-dom": a6,
    "react-dom/client": d6,
    "@deepseek-ai/cordis": H5,
    "@deepseek-ai/dsh-client-ui-slots": g6,
    "@deepseek-ai/dsh-client-ui-primitives": qd
} }
```

接线链路（均可溯源）：boot 时 `i.create({ boot: n.__DSH_BOOT__, staticModules: Gd(), ...seams })`（同文件 WebBoot 类 run()）→ 【OFF】`dsh-client-modules\lib\client.js` 166 行 `this.seed = new Map(Object.entries(options.staticModules))` → 工厂拿到的同步 `require(spec)` 解析顺序 = seed → 已物化模块 → graph row 工厂，全未命中即抛 `require("<spec>") missed the module table`（251–259 行）。

**明确回答：**
- ✅ `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client` 全部可直接 `require`（18.3 版系，全部官方 client bundle 同款用法）；
- ✅ `@deepseek-ai/cordis`（client 侧 Context/Service）、`@deepseek-ai/dsh-client-ui-slots`（类型层）、`@deepseek-ai/dsh-client-ui-primitives`（现成 UI 组件库，含 useDismissOnOutsidePointer 等 hook——ui-cordis 693 行正在用）；
- ❌ 其他一切 npm 包（zustand、lodash、图表库……）不在 seed 里，require 直接抛错；要依赖另一个插件的 client 包，须在自己 package.json 的 `dsh.client.inject` 里声明对方包名，由宿主按 module-graph 先到先行（client-modules index.js 162–194 行 orderByModuleGraph）。

### 2.2 同源 fetch 相对路由 —— ✅ 直接用

【INJ-C】9、37–42 行实证：

```js
const API = "/super-injector/api";
function fetchJson(path, init) {
    return fetch(API + path, { headers: { "content-type": "application/json" }, ...init })
        .then((r) => r.json());
}
// GET：fetchJson("/list")   POST：fetchJson("/uninstall", { method:"POST", body: JSON.stringify({...}) })
```

client bundle 跑在与 GUI 同源的页面里，`fetch("/dsh-session-overview/api/list")` 就是普通同源请求，无 CORS/鉴权问题；前提是对应前缀路由已在 host 侧 `webServer.register({kind:'prefix'})` 注册（NOTES-contract.md §2.3）。

### 2.3 localStorage —— ✅ 浏览器原生可用

client bundle 与 GUI 页面同一 JS 上下文，`localStorage` 直接读写。在装插件实证：
- 【OFF·linxin666】`dsh-client-ui-aionui-panel\lib\client.js`：`const raw = localStorage.getItem(key);`（面板宽度/折叠状态持久化）；
- `dsh-client-ui-task-board\lib\client.js`：注释明写 "Task persistence: a small storage seam with a localStorage backend"（任务数据存 `dsh.taskBoard.v1` 键）。
提醒：localStorage 是 **origin 级**共享存储，跨会话/跨工作区可见——存 UI 偏好合适，别当业务数据库。

### 2.4 给 engineer 的选型建议（结合 t1 契约）

- 最稳路线：完全照抄【INJ-C】外壳与风格——vanilla DOM 组件 + `component:()=>({render,dispose})` + fetchJson 轮询自家 `/api`；零 React 依赖，seed 表一个都不用 require，代码量最小。
- 要更精致的 UI/状态管理：`require("react")` + `require("react/jsx-runtime")` + `@deepseek-ai/dsh-client-ui-primitives` 组件库，按 CordisPanel 模式注册 `sidebar.footer.action`（id/order 必带，接收 `wide` 切换窄栏图标态）。
- 总览面板想做成全局悬浮大窗：优先 CordisPanel 式「footer.action 按钮 + 自绘 fixed 面板」（有完整生产先例）；直接占 `shell.overlay` 也可以（additive、无人竞争），但要自己处理 pointer-events 与遮罩。
- 数据面补充线索（与 scout-data t2 交叉）：slot 组件还能收到宿主喂的 `useSessions`/`useWorkspaces` 标准 hook（runner 目录 standardProps 字段；CordisPanel 670 行 `useSessions(s=>s.current)` 实例）——客户端本地的会话列表镜像可能不用过网络就有。

---

## erratum（v2 实证修正）

> **§1.4 与 §2.4 第一条的「vanilla DOM 组件」结论范围修正：不适用于 `sidebar.footer.action` / `shell.overlay` 槽。** 本节取代上述两处与之冲突的表述。

- **`sidebar.footer.action`（以及 `shell.overlay`）槽的组件必须作为 `ctx.slots.register(decl, Component)` 的第二参数传入**，且 Component 必须是 **React 函数组件或 render thunk（`() => React.createElement(...)`，返回 React 元素）**；decl 内嵌 `component: () => ({ render, dispose })` 的 vanilla 形态在该槽**不受支持——注入实测不渲染**（同槽对照：vanilla 版无 UI，React 第二参版正常）。
- §1.4 引用的注入器 vanilla 面板是 `settings.section` 槽的形态，属另一套渲染面，**不可外推**到 sidebar/shell 系槽位；t1 脚手架模板为 conversation.view 生成的同款 vanilla 写法同理未经本机实证，用前须逐槽验证。
- 证据链：runner 槽目录两处官方示例均为第二参 render thunk（【OFF·runner】lib/client.js 3477、3382 行）；真实占用者全部第二参 React 组件（CordisPanel ui-cordis 1337–1367 行、visualize 758–766 行）；叠加本次注入实测。
- 不受影响的部分：§1.1 契约表（id/order/label/ownerProps `wide`/standardProps useSessions）与 §2.1–2.3 能力表全部维持有效；CordisPanel 先例本来就是「第二参 React 组件」，仍是权威模板；§2.4 的「footer.action 按钮 + 自绘 fixed 面板」路线不变，只是按钮组件须写成 React 形态（Esc/遮罩关闭逻辑在组件内用 useEffect 实现；react/react-dom 均在 seed 表内，改造成本为零）。
