# 实现契约研究笔记 — DSH UI 面板插件（会话总览）

> 研究者：scout-ui · 任务 t1 · 只读解剖两处源码：
> ① 注入器 `C:\Users\<user>\.dsh\profiles\web\node_modules\@dsh-external\dsh-super-injector\lib\index.js`（下称【INJ】）
> ② 参考插件 `C:\Users\<user>\.dsh\profiles\web\node_modules\@dsh-external\dsh-visualize\`（下称【VIZ】）
> ③ 宿主 client-modules 服务 `...\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-modules\lib\index.js`（下称【CM】）
> 所有结论附 文件+行号。本机为 npm 安装版 DSH：**TS 构建管线不可用，必须手写纯 JS 的 lib/**，本文每条契约都标注了"手写等价物怎么写"。

---

## 1) 最小可注入插件的 package.json 必需字段

### 1.1 四种形态共有的必需字段（生成器统一模板）

出处：【INJ】`scaffoldPackageJson()` 7119–7168 行；生成入口 `dev_scaffold_plugin.execute` 9195–9204 行。

| 字段 | 值 | 说明 |
|---|---|---|
| `name` | `@dsh-external/<短名>` | 不带 scope 时生成器自动补 `@dsh-external/` 前缀（9195 行） |
| `version` | `"0.0.1"` | |
| `private` | `true` | |
| `type` | **`"module"`** | lib/index.js 按 ESM 加载 |
| `main` | **`"./lib/index.js"`** | loader.create 的入口 |
| `types` | `"./lib/types/index.d.ts"` | 可选（手写 JS 可省） |
| `files` | `["lib"]` | |
| `peerDependencies` | 范围声明不硬编码版本 | 见 7121–7127 行 |
| `scripts.build` | `"bash scripts/build.sh"` | 仅 dev_build_plugin 用；手写 JS 可省 |

toolkit 形态的 peerDeps（7121–7126）：`@deepseek-ai/dsh-llm >=0.0.1-rc <2`、`@deepseek-ai/dsh-tools`、`cordis >=4.0.0-rc <5`、`schemastery ^3.18.0`。

### 1.2 ui-panel 形态的差异（与 toolkit 相比）

出处：【INJ】7120 行 `withClient = form === "ui-panel" || form === "hybrid"`；7148–7166 行追加：

```jsonc
// ① 多一个 client 构建脚本与依赖
"devDependencies": { "tsdown": "^0.22.14", ... },
"scripts": { ..., "build:client": "tsdown" },

// ② 多 exports 映射 —— "./client" 是硬性要求（见 §3 宿主解析）
"exports": {
  ".":            { "default": "./lib/index.js" },
  "./client":     { "default": "./lib/client.js" },
  "./package.json": "./package.json"
},

// ③ 多 dsh.client 声明 —— 没有它宿主根本不加载你的 UI
"dsh": {
  "client": {
    "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"],
    "platform": "web"
  }
}
```

差异总结：**ui-panel = toolkit 的全部 + `exports["./client"]` + `dsh.client{platform:"web"}` + `lib/client.js` 产物**；toolkit 只有 host 侧，无任何 client 内容。

### 1.3 实测参考：dsh-visualize 的清单（真实在跑的 UI 插件）

出处：【VIZ】package.json 全文。
- 同样有 `type/module/main/exports(含 ./client)/dsh.client{inject,platform:"web"}`（2–17、30–40 行）；它的 `build` 直接是 `"tsdown"`（25 行，官方 checkout 有构建链；我们环境没有，改手写）。
- 它额外有 `dsh.bundle.patch: "./cordis.patch.yml"` 与 `"./cordis.patch.yml"` 导出（15、30–33 行）——这是 **bundle 安装路径**才需要的，见 §4。

### 1.4 手写纯 JS 版最小 package.json（工程结论）

注入器实际消费的字段只有：`name`（junction+loader.create，【INJ】8363–8409）、`exports["./client"]`+`dsh.client`（client-modules 解析，【CM】367–393）。所以最小集为：

```jsonc
{
  "name": "@dsh-external/dsh-session-overview",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"],
      "platform": "web"
    }
  }
}
```

⚠️ 注入预检红线（【INJ】`buildFreshnessProblems` 8535–8606）：
- package.json **不能带 UTF-8 BOM**（8555 行，PowerShell Set-Content 会写入——用 node/write 工具写）；
- 声明了 `dsh.client` 就必须存在 `lib/client.js` 且内容包含字符串 `__ModuleLoader__`，否则**阻断注入**（8590–8593 行）；
- src 比 lib 新 8s+ 只是 warn 不阻断（8587、8598 行）→ 手写 JS 直接写 lib/ 无 src，完全绕过新鲜度检查。

---

## 2) lib/index.js 插件入口：签名与路由注册

### 2.1 模块形状（cordis 插件四件套）

host 入口是标准 cordis 插件：`name` / `inject`(所需服务) / `Config`(可选 schemastery schema) / `apply(ctx, config)`。
- 脚手架 toolkit：【INJ】6845–6887 行 —— `export const name`、`export const inject = ['tools']`、`export const Config = z.object({greeting: z.string().default('你好')})`、`export function apply(ctx, config)`。
- 真实参考 dsh-visualize：【VIZ】lib/index.js 373–391 行 —— `const name="dsh-visualize"`、`const inject=["tools","skills","fs"]`、`function apply(ctx, config){ ctx.tools.register(...); ctx.skills.registerProvider(...) }`，末尾 `export {...}`（393 行，ESM）。
- 注入器自身也是同形状：【INJ】7169–7177 行 `name/inject=["loader","timer","tools","systemPrompt","webServer"]/Config`。

### 2.2 铁律：一切资源注册必须挂 `ctx.effect`

出处：【INJ】模板注释 6831 行："资源注册必须挂 ctx.effect（热重载/卸载自动清理——注入器踩坑记录）"；client 同理 7061、7076 行。不挂 effect 的注册在热重载/卸载时不会注销，产生幽灵双实例。

### 2.3 注册 HTTP 路由（ui-panel host 侧的真实代码）

脚手架 ui-panel host 源码【INJ】7007–7042 行（原样引用）：

```ts
export const name = "<pkg>"
export const inject = ['tools', 'webServer']        // ← 要 webServer 服务必须声明

export function apply(ctx, config) {
  // host API（前缀路由，client 面板消费）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/<pkg>/api',
    handler: async (req, res) => {
      const text = JSON.stringify({ title: config.title, ts: Date.now() })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(text)
    },
  }), '<pkg>: api')
  // ... 还注册了一个 defineTool 状态工具（7030–7041）
}
```

多端点前缀路由的真实范例（注入器自己的管理 API），【INJ】9629–9695 行：
`kind:"prefix"` + `path:"/super-injector/api"`，handler 内用
`new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/super-injector\/api/, "")`
解析子路径，按 `req.method === "GET"/"POST"` 分发 `/list`、`/inject`、`/uninstall` 等，统一 `send(code,obj)` 写 JSON。**我们的面板后端照这个模式写即可。**

### 2.4 工具注册（如果面板还要给模型配工具）

【INJ】6858–6871 行：`ctx.effect(() => ctx.tools.register(defineTool({ name, description, parameters, output:{schema,render}, async execute(args){...} })), '<label>')`。工具 schema 要精简（6833–6839 行高性能铁律：description 进首轮 prefill 按字符计费）。

---

## 3) 面板如何到达浏览器：client.js 才是 UI 本体，index.js 只管数据

### 3.1 结论先行

面板 **不是** 由 index.js 返回 HTML 页面，而是由 **client 包**（`lib/client.js`）向 GUI 内部注册组件槽位（slot）。链路：

```
package.json(dsh.client+exports["./client"])
  → 宿主 clientModules 解析出 clientPath【CM 367–393】
  → 插件激活时入表 processOne【CM 410–427】
  → GET /plugins/<包名>/client.js 动态服务【CM 449–474, 287–291】
  → 启动清单 window.__DSH_BOOT__ 注入 index.html（带 ?rev= 缓存穿透）【CM 152–160, 215–238, 292】
  → 浏览器端 ModuleLoader 执行 bundle：window.__ModuleLoader__.load({id,factory})
  → apply(clientCtx) → ctx.slots.register(...) → 组件出现在 GUI 对应插槽
```

### 3.2 lib/client.js 必须长什么样（tsdown 产物的精确形状）

tsdown 配置【INJ】7108–7113 行给出包装约定：banner=`window.__ModuleLoader__.load({id:"<pkg>",factory:(require)=>{`，intro=`var module={exports:{}};var exports=module.exports;`，footer=`return module.exports;} });`，format=cjs、platform=browser、codeSplitting=false、产物名固定 `client.js`。
真实产物【VIZ】lib/client.js 1–8 行：

```js
window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-visualize",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");                  // ← 外部依赖走 require，静态表提供
    let react_jsx_runtime = require("react/jsx-runtime");
    ...
```

末尾导出三件套并返回（【VIZ】769–773 行）：`exports.apply=apply; exports.inject=inject; exports.name=name; return module.exports;`
**手写等价物**：直接照抄这个外壳，中间放纯 JS 代码即可——无需 tsdown（预检只查 `__ModuleLoader__` 特征串，8593 行）。官方全家桶 client bundle 全都用 `require("react")/require("react/jsx-runtime")`（grep 证实 30+ 个 @deepseek-ai/dsh-client-* 包同构），react 由模块系统静态表供给。

### 3.3 client 侧 apply 的两个必坑（模板注释原文）

【INJ】7048–7051 行 + 校验器 8523–8530、9224–9226 行：
1. **必须 `export const inject = ['slots']`** —— 否则报 `cannot get property 'slots' without inject`（cordis 服务注入契约）；
2. **register 必须带 `name` 字段且 ∈ 已知 slot 白名单** —— 否则报 `slot undefined is not declared`。白名单【INJ】8502–8514 行：

```
conversation.view                        ← 会话视图标签页（ui-conversation viewTabs() 渲染）
settings.plugin.item / settings.plugins.tab / settings.section / settings.general.item
conversation.session.header.actions / conversation.session.header.utilities
conversation.input.dock / conversation.composer.dock
sidebar.footer.action                    ← 侧边栏底部动作
shell.overlay                            ← 全局覆盖层
```

注意：白名单校验是正则扫描整个 client 文件，只要**有一个** register 命中白名单即过（8515–8516 行 `REGISTER_NAME`）；像 dsh-visualize 注册的 `tool.call.toolview` 不在白名单里也没事，因为它同时注册了 `conversation.input.dock`（【VIZ】758–766 行）。

### 3.4 slot 注册的正确姿势

模式：`ctx.slots.inject(<slot名>, () => ctx.slots.register({ name:<slot名>, id?, key?, order? }, <组件>))` —— 外层 `slots.inject(hole, factory)` 等待宿主声明该洞后再应用（"entry application order is loader-driven, and a direct register racing the declaration fails boot"，【VIZ】751–756 行注释；scaffold 同款 7061–7076 行）。

组件两种形态都合法：
- **vanilla DOM**（scaffold 默认，【INJ】7066–7074 行）：`component: () => ({ render() { const el=document.createElement('div'); ...; return el } })`；
- **React 函数组件**（真实插件做法，【VIZ】757–767 行）：`ctx.slots.register({name, id, order}, StreamingPreview)`，组件第二参直接传 React 组件，内部可用 hooks（该文件大量 useState/useEffect）。

### 3.5 面板在 GUI 哪里出现？

由你注册哪个 slot 决定，没有"独立路由页面"这回事（`/plugins/<pkg>/client.js` 只是 JS bundle 下载地址，不是页面）。「会话总览」候选落点：
- `conversation.view`：出现在**会话头部视图切换标签**（记忆佐证：viewTabs() 枚举所有带 id 的注册项；但 blank 空会话隐藏整个 header → 空会话里看不到标签）；
- `sidebar.footer.action`：侧边栏底部按钮，点了可开覆盖层/弹层 → 适合"全局总览"入口；
- `shell.overlay`：全局覆盖层容器 → 总览主界面候选。
推荐组合：**sidebar.footer.action（入口按钮）+ shell.overlay 或弹层（总览界面）**，避免受单会话 header 显隐影响；具体以 engineer 验证 slots 服务 API 为准。

---

## 4) cordis.patch.yml 的作用；ui-panel 需要它吗

patch 文件有两种，别混淆：

**① 插件自带的 bundle patch**（【VIZ】cordis.patch.yml 全文，仅 4 行）：
```yaml
# dsh bundle patch: inserts this plugin into a profile's layer stack.
- insert:
    - id: dsh-visualize
      name: '@dsh-external/dsh-visualize'
```
经 package.json `dsh.bundle.patch` 声明（【VIZ】package.json 30–33 行），在**以 bundle 方式安装**（`dsh plugin add` / plugin_install）时把插件插入 profile 层栈，重启后由 bundles 列表正常装配。profile 侧实证：`~/.dsh/profiles/web/package.json` 6–31 行 bundles 数组含 `@dsh-external/dsh-visualize`，34–57 行 dependencies 用 `link:<plugins-root>/dsh-visualize` junction 供包。

**② profile 用户补丁层**（`~/.dsh/profiles/web/cordis.patch.yml`）：应用在每个 bundle 层之后，支持 id 定向 config 覆盖 / `disabled: true` / insert 列表 / `!!js` 表达式（该文件 1–89 行多处实例：18–24 modlens 覆盖、56–79 mcp-ouroboros 覆盖+RUST_LOG、7–8/26–47/83–89 disabled 条目）。注入器卸载时会往这里写 disabled 防止 bundle 自装配加回（【INJ】uninject 8442–8453 行）。

**ui-panel 需要吗？——注入路径不需要。**
- super-injector 的运行时注入明确"不碰 patch/package.json、不重启"（【INJ】工具描述 8756 行）；`inject()` 全流程 = 建 junction → `loader.create({name,config:{}})` → 刷新 client 行 → 记 registry（8363–8422 行），全程不读写 cordis.patch.yml。
- 只有两条路需要它：(a) 想转正为重启常驻的 bundle（plugin_install / dsh bundle 装配）；(b) 卸载后防自愈加回（注入器自动写，不用我们管）。
- ⚠️ 同一 id 既被注入又被 patch insert 会撞 "duplicate loader entry id" 启动崩溃（profile patch 52–55 行注释教训）——我们走注入路径就**不要**往 patch 里插自己。

---

## 5) 给 engineer 的一页纸清单（手写纯 JS 落地）

1. 目录 `<plugin-dir>\`：`package.json`（§1.4 最小集，无 BOM）+ `lib/index.js` + `lib/client.js`，不需要 src/scripts/tsconfig。
2. `lib/index.js`：ESM，`export const name/inject=['webServer'(,'tools')]/Config?` + `export function apply(ctx,config)`；API 用 `ctx.effect(() => ctx.webServer.register({kind:'prefix',path:'/dsh-session-overview/api',handler}), '…: api')`（§2.3 范式）。
3. `lib/client.js`：手抄 `__ModuleLoader__` CJS 外壳（§3.2），`export(s) inject=['slots']`，`ctx.slots.inject('<slot>',()=>ctx.slots.register({name:'<slot>',id:'dsh-session-overview-panel'},comp))`（§3.4）；slot 选型见 §3.5。
4. 注入验证：`dev_inject_plugin <dir>` 输出须含 `host ✓` 与 `client ✓ (lib/client.js)` 两行（缺 client 行=走了捷径路径没挂上，需 uninject+重注，见记忆 mem_78d02）；浏览器 `curl http://127.0.0.1:3080/plugins/@dsh-external/dsh-session-overview/client.js` 应 200 且含 `__ModuleLoader__`。
5. 数据源：总览需要的"全部会话状态"从 host 侧拿（session 存储服务/API），经自家 `/api/*` 前缀路由喂给面板；面板轮询或手动刷新均可，**不得**自动外连服务器（用户红线 mem_b6bd）。

---

## erratum（v2 实证修正）

> **§3.4 与 §5-3 中「vanilla DOM 组件形态」的适用范围修正：不可用于 `sidebar.footer.action` 与 `shell.overlay` 槽。** 本节取代前文与之冲突的表述。

修正后的规则：
- 这两个槽（ui-sidebar / ui-layout 拥有的 list 槽）的组件**必须作为 `ctx.slots.register(decl, Component)` 的第二参数**传入，且 Component 必须是 **React 函数组件或 render thunk（`() => React.createElement(...)`，返回 React 元素）**；
- 声明对象内嵌的 `component: () => ({ render() {...}, dispose() {...} })` vanilla 形态在该槽**不受支持——注入实测不渲染**（同一槽位：vanilla 版无任何 UI 出现，改为第二参 React 组件后立即正常）。

依据（三层证据一致）：
1. 宿主槽目录官方示例：【OFF·runner】`dsh-cordis-client-runner\lib\client.js` 3477 行（sidebar.footer.action）与 3382 行（shell.overlay），均为第二参 render thunk —— `ctx.slots.register({ name, id, order, label }, () => React.createElement('div', null, 'hello'))`；
2. 全部真实生产占用者无一例外走第二参 React 组件：CordisPanel（【OFF】`dsh-client-ui-cordis\lib\client.js` 1337–1367 行）、visualize 双槽（【VIZ】`lib\client.js` 758–766 行）；
3. 本次注入实测（t3/t4 链路）：vanilla 不渲染、React 正常。

「`component: () => ({render})`」说法的真实出处是 **settings.section 类插槽**——注入器自己的设置页面板（【INJ-C】44–151 行）与脚手架模板为 conversation.view 生成的骨架（【INJ】7061–7076 行）。那属于另一套渲染面，**不可外推**到 sidebar/shell 系槽位；conversation.view 的 vanilla 写法同样未经本机实证，用前须逐槽验证。
影响范围：落点推荐不变（sidebar.footer.action 仍是正确入口），仅组件形态必须按 React 第二参给出；react / react/jsx-runtime 均在静态 seed 表内（见 NOTES-slots.md §2.1），改造成本为零。
