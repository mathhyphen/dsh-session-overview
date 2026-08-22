# 会话跳转通道侦察（t10）：面板点击会话 → 主界面切换

> 研究者：scout-ui · 任务 t10 · 只读研究。
> 结论先行：**方向一（URL 深链）不通；方向二（编程式 `ctx.sessions.open(id)`）是官方正道且有 5+ 个在装插件实证**。推荐「iframe `postMessage` 桥 + client.js 收消息调 `sessions.open`」组合，文末附完整可抄代码草稿。

---

## 0. 结论速览

| 方向 | 结论 | 关键依据 |
|---|---|---|
| ① URL 深链（hash/query/pushState） | ❌ 不支持 | SPA 产物中路由 API 出现次数全为 0 |
| ② 编程式切换 `ctx.sessions.open(id)` | ✅ 官方公开写入口 | 契约类型三处定义 + 5 个真实插件调用 |
| ②′ iframe→parent postMessage 桥 | ✅ 可行且必要 | 面板本体是独立页面（iframe/新标签），桥接后由 client.js 代为调用 |

---

## 1) 方向一：URL 深链 —— 不支持（负证据）

对 SPA 主产物逐关键词计数（`...\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-web-frontend\dist\assets\index-CA9Bpko5.js`，minified 单文件含全部视图）：

```
pushState       count=0
replaceState    count=0
location.hash   count=0
searchParams    count=0
'?session='     count=0
'#/'            count=0
```

SPA 的当前会话状态完全活在内存 store 里（`list.current`，见 §2），刷新后靠持久化选择单元格恢复（service.d.ts:169-175 "Persisted selection cell … selection survives transient list states"），从不进 URL。**深链路线不存在，别浪费时间找。**

## 2) 方向二：编程式切换 —— `ctx.sessions.open(id)` 就是官方写入口

### 2.1 类型契约（宿主自带）

- 【OFF】`dsh-client-runtime\lib\types\client\contract\sessions.d.ts:32-35`：
  ```
  /** Select a session as current. */
  open(id: SessionId): void;
  ```
- 【OFF】`...\sessions\service.d.ts:208-211`：SessionRuntime.open —— "**Select a listed or retained catalog-addressed session as current.**"；`:11` 与 `:356-360`："Staging IS the open signal —— the window opens ⟺ the session is on stage"，即 open 同时完成「选中 + 打开会话窗口」，无需第二步。
- 【OFF】`...\contract\sessions-port.d.ts:19-43`：兄弟域可读的 port 面同样暴露 `current` + `open(id)`。
- 【OFF】`...\workspaces\service.d.ts:60`：官方导航指引原文 —— "caller owns navigation: take the returned id to **`sessions.open`**"。
- ⚠️ 读侧明确不是写侧：【OFF】`...\contract\sessions.d.ts:21` —— useSessions 是 "**read face — writes stay inside the domain**"。所以 CordisPanel 只能读 `s.current`，而写必须走 `sessions.open`；我们**不要**去摸 zustand store 内部 setState（绕过 domain 会破坏 staging/provide 投影一致性，且无稳定公开面）。

### 2.2 插件怎么拿到它：client 侧服务注入名就叫 `sessions`

- 【OFF·runner】`dsh-cordis-client-runner\lib\client.js:1224-1225`：slot 目录原文 "The sessions-service face injected as **`ctx.sessions`**"。
- 真实插件的 inject 声明先例：【linxin666】`dsh-client-ui-task-board\lib\client.js:3477-3485` —— `const inject = ["slots", "sessions", "workspaces", "connection", "settingsScope", "locale", "remote"]`（我们只需加 `'sessions'`）。

### 2.3 在装插件实证（全部就是「列表点行 → 切换会话」）

| 插件 | 出处 | 用法 |
|---|---|---|
| task-board | `@linxin666\dsh-client-ui-task-board\lib\client.js:668-674` | `openSession(sessionId){ this.deps.sessions.open(sessionId); }`，注释原文："**Jump to an execution's session transcript. Selecting the session changes `current`, which closes the board (the conversation view takes over)**" —— 与我们要的行为一字不差 |
| task-board 接线 | 同文件 3575-3578 | `sessions: { list: sessions.list, open: (id) => sessions.open(id) }` |
| workspace 搜索 | 【OFF】`dsh-client-ui-workspace\lib\client.js:2365` | 搜索结果点击 `ctx.sessions.open(sessionId)` |
| workflow-run | 【OFF】`dsh-client-ui-workflow-run\lib\client.js:638` | `ctx.sessions.open(id);` |
| dsh-pet | `@linxin666\dsh-pet\lib\client.js:1579-1582` | `sessions.open(sessionId);` |
| remote-web-ui | `@linxin666\dsh-remote-web-ui\lib\client.js:3299` | `sessions.open(sessionId);` |

runtime 内部同样如此（【OFF】`dsh-client-runtime\lib\client.js:9900、9935`：初始选择恢复即 `this.sessions.open(sessionId)`）。

---

## 3) 推荐方案：iframe `postMessage` 桥 + client.js 代跳

我们的面板有两个运行位置：① GUI 内的悬浮 iframe（client.js 挂的 Overlay）；② 浏览器独立标签页直接开 `/dsh-session-overview`。位置②没有宿主 SPA，无法跳转（如实告知用户即可）；位置①走消息桥：

```
面板页(iframe) 行点击
  → window.parent.postMessage({type:'dsh-so:navigate', sessionId}, location.origin)
  → client.js Entry 组件监听 window message（校验 origin + type）
  → ctx.sessions.open(sessionId)
  → 成功后 setOpen(false) 收起悬浮面板（conversation 视图接管，task-board 同款语义）
```

### 3.1 改动一：`lib/client.js`（inject 加 `'sessions'` + Entry 增消息监听）

```js
// ── 头部：inject 数组增加 'sessions'（服务缺失会导致装载失败，但它是 web 运行时核心服务，
//    所有 UI 包都依赖它，安全）──
const name = 'dsh-session-overview';
const inject = ['slots', 'sessions'];

function apply(ctx) {
  ensureStyle();

  // 跳转代答：面板 iframe 发来的消息在这里落地
  const navigateTo = function (sessionId) {
    try {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
      ctx.sessions.open(sessionId);   // 契约出处见 NOTES-nav.md §2.1；选中即打开窗口
      return true;
    } catch (error) {
      // 目标会话不在客户端镜像（listed/retained 之外）时会抛/无效 → 让面板保持原状
      console.warn('[session-overview] open failed:', error);
      return false;
    }
  };

  ctx.effect(function () {
    return ctx.slots.inject('sidebar.footer.action', function () {
      return ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-session-overview',
        order: 80,
        label: function () { return '会话总览'; }
      }, function Entry() {
        const [open, setOpen] = react.useState(false);
        react.useEffect(function () {
          if (!open) return;
          const onKey = function (event) {
            if (event.key === 'Escape') setOpen(false);
          };
          const onMessage = function (event) {
            if (event.origin !== location.origin) return;        // 同源校验
            const data = event.data;
            if (!data || data.type !== 'dsh-so:navigate') return; // 消息类型白名单
            if (navigateTo(data.sessionId)) setOpen(false);       // 成功即收起，会话视图接管
          };
          document.addEventListener('keydown', onKey, true);
          window.addEventListener('message', onMessage);
          return function () {
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('message', onMessage);
          };
        }, [open]);
        return react.createElement(
          react.Fragment,
          null,
          react.createElement('button', { /* …原样… */ }, '🗂'),
          open ? reactDom.createPortal(
            react.createElement(Overlay, { onClose: function () { setOpen(false); } }),
            document.body
          ) : null
        );
      });
    });
  }, 'dsh-session-overview: sidebar entry');
}
```

### 3.2 改动二：`lib/index.js` PAGE_HTML（行点击 → postMessage）

```js
// ① rowHtml 的 <tr> 带 data-session（id 已有 esc 转义惯例）：
return '<tr data-session="' + esc(r.id) + '">' + /* …原五个 td 不变… */ '</tr>';

// ② 底部脚本追加一个委托监听（与既有 button.mark 监听并列，互不干扰）：
$('tblbox').addEventListener('click', function (ev) {
  if (ev.target && ev.target.closest && ev.target.closest('button.mark')) return; // 已读按钮优先
  var tr = ev.target && ev.target.closest ? ev.target.closest('tr[data-session]') : null;
  if (!tr) return;
  var id = tr.getAttribute('data-session');
  if (!id) return;
  // 只有嵌在 GUI 里的 iframe 才有可跳转的父界面；独立标签页静默忽略
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'dsh-so:navigate', sessionId: id }, location.origin);
  }
});
```

要点：`targetOrigin` 用 `location.origin`（精确同源，不用 '*'）；消息处理端再校验 `event.origin`，双端闭环。iframe 同源，本可直接摸 parent 变量，但 postMessage 是标准面、对将来拆分更稳。

---

## 4) 备选与边界

- **备选 A（否决）**：直改 zustand store 的 `current` —— useSessions 明示 "read face — writes stay inside the domain"（contract/sessions.d.ts:21），绕过 domain 的写入不经 staging（service.d.ts:11、356-360），会话窗口不会打开，还会污染 provide 投影。
- **备选 B（不采）**：ui-layout 的 layout actions —— 未在 slot 契约目录中对外承诺，非稳定面。
- **兜底 C**：目标会话不在客户端镜像时 `open()` 可能无效（契约措辞 "listed **or retained**"，service.d.ts:208）——代码里已 try-catch + 返回 false，面板保持不动；此时用户仍可用现有「新标签页打开」看总览。若日后要支持「从归档冷会话直达」，host 侧 `/api/state` 已带 cwd，可退一步提供「在工作区中定位」类替代（本期不做）。
- **子代理会话**：如需精确落到某子代理对话，契约另有 `openSubagent(address: SubagentAddress)`（service.d.ts:216；port 面 sessions-port.d.ts:40-42）——需要 catalog 地址而非纯 sessionId，本期总览行只有 sessionId，先用 `open(parentId)` 语义即可。
- **独立标签页模式**：无父界面可收消息，行点击静默无动作（可在 UI 上后续加 title 提示「在侧边栏面板内点击可跳转」，非必须）。

## 5) 给 engineer 的一句话

改两处共约 30 行：client.js `inject` 加 `'sessions'` + Entry 里加 message 监听调 `ctx.sessions.open(id)`（成功即 `setOpen(false)`）；PAGE_HTML 行加 `data-session` + tblbox 委托监听 `postMessage({type:'dsh-so:navigate'}, location.origin)`。安全双校验（origin+type）、失败静默回退，均有现成行为语义可依（task-board 668-674 注释原文）。
