# dsh-session-overview

[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](./LICENSE)

DSH（DeepSeek Harness）**会话总览面板插件** —— 纯 JavaScript 免构建，运行时注入即生效。

侧边栏底部多一颗「会话总览」图标按钮（内联 SVG 线性图标，随主题变色），点开悬浮面板即可总览**全部会话**：

- **四态徽章**：🟢 运行中（脉动） / 🔵 新完结·未读 / ⚪ 空闲 / 📦 已归档
- **工作区分组**：按 workspace 分节展示（可切平铺），「未分组」固定末位
- **状态筛选**：「全部」+ 四个带色点状态 chip，单选互斥，再点恢复全量
- **点击行直接跳转**：主界面自动切换到该会话（成功后自动标为已读）
- **未读记账**：本地 localStorage 账本，行级「标为已读」+ 一键「全部标为已读」，刷新不丢
- 标题搜索、自动刷新开关（默认关，偏好记忆）、手动刷新、中文界面、深浅色主题适配

## 安装

### 方式一：GitHub（推荐）

```bash
dshpm install github:<your-name>/dsh-session-overview
# 或
dsh plugin add github:<your-name>/dsh-session-overview
```

安装后重启 dsh web 由 bundles 列表装配。

### 方式二：本地源码 + super-injector 运行时注入

```bash
git clone https://github.com/<your-name>/dsh-session-overview.git
```

然后在 DSH 会话里调用注入器工具：

```text
dev_inject_plugin <插件目录>        # 注入即生效（host + UI 双通道）
dev_reload_package dsh-session-overview   # 改代码后热重载
dev_uninject_plugin dsh-session-overview  # 卸载即净
```

注入成功判据：输出含 `host ✓` 与 `client ✓ (lib/client.js)` 两行；浏览器访问
`http://127.0.0.1:3080/dsh-session-overview` 应返回面板页。

## 接口

| 路由 | 说明 |
|---|---|
| `GET /dsh-session-overview` | 面板页（完整 HTML，中文界面） |
| `GET /dsh-session-overview/api/state` | 全部会话 JSON：`{ ok, ts, count, rows:[{ id, title, workspace, running, archived, lastActivity, attached, cwd }] }`，按最近活动新→旧排序 |

## 列表语义

- 归档会话**保留展示**（打 `archived=true` 标、琥珀徽章），不再隐藏
- blank 且非运行中的空会话过滤
- attached（`ctx.sessions.list()`）∪ cold（`ctx.get('sessionPersistence').list()`）按 id 去重
- 可选服务（sessionProjections / sessionPersistence / sessionProjectionCache / workspaceRegistry）缺失时自动判空降级，不炸面板
- 未读判定在浏览器本地：`unread = !running && !archived && lastActivity > seen[id]`；四态优先级 `running > archived > unread > idle`
- 统计行跟随当前筛选口径，总数以「显示 x / 共 N」注明

## 本地存储键

| 键 | 内容 |
|---|---|
| `dsh-so-seen` | 未读账本 `{ sessionId: lastAckTs }` |
| `dsh-so-grouped` | 分组/平铺偏好 |
| `dsh-so-autorefresh` | 自动刷新偏好（默认关） |
| `dsh-so-filters` | 状态筛选（`'all' \| 'running' \| 'unread' \| 'idle' \| 'archived'`） |

## 结构

- `lib/index.js` — host 侧 cordis 插件（`name` / `inject:['webServer']` / `apply`）：前缀路由（面板页 + 数据 API），数据聚合与排序见 `NOTES-data.md`
- `lib/client.js` — 浏览器模块（手写 `__ModuleLoader__` CJS 外壳）：注册 `sidebar.footer.action` 槽位（两参契约 `ctx.slots.register(options, Component)`，React Entry + `createPortal` 悬浮层）；承载跳转桥——监听面板 iframe 的 `dsh-so:navigate` 消息（origin + type 双校验）→ `ctx.sessions.open(id)` → 成功收起面板并回执 `dsh-so:navigated`
- `NOTES-*.md` — 开发期研究档案：插件契约 / 会话数据面 / slots 实证 / 跳转通道 / 注入验收清单，全部附宿主源码出处
- 无 src/scripts/tsconfig —— 兼容 npm 安装版 DSH（无 TS 构建管线），全部手写纯 JS

## 隐私

- 所有数据来自本机 DSH 宿主进程，仅本地展示，**无任何外部网络调用**
- 未读账本与偏好存于浏览器 localStorage，不上传

## License

BSD-3-Clause，详见 [LICENSE](./LICENSE)。
