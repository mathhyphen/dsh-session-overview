// ============================================================================
// dsh-session-overview — client 侧（浏览器 bundle）
//
// 契约依据（v4，t22 行内 portal 化）：
//   runner 槽目录（dsh-cordis-client-runner/lib/client.js 3330-3504）与官方示例：
//     ctx.slots.register({ ...options }, <React 组件>) 两参形态（mem_8b042e81）。
//   t15：入口按钮经 shell.overlay 槽承载（additive list/root，id 加在已有条目旁，
//   不替换任何东西；sidebar.workspaces 是 single/replace 槽禁用）。
//   t22：按钮改为「行内原生 portal 子元素」——createPortal(buttonEl, hostEl)，
//   hostEl = 工作区头部行容器（锚点关键词命中控件 parentElement 链上、包含全部
//   同行命中控件的最贴身容器）。对齐交给那一行自己的 flex 布局，坐标计算全下线
//   （calcAnchoredPos/computePos/fixed 定位删除）。React 持续管状态：点击
//   setOpen(true)、跳转桥/Esc/Overlay 全保留。
//
// 自愈（t22）：宿主行由其他 React root 管理，portal 节点可能被重渲染移除——
// document.body MutationObserver(childList+subtree) + ~120ms 防抖 +
// needsReinsert(hostEl.isConnected/contains) 失联即重新 portal（portal key 递增
// 强制新节点）；卸载清理 observer 与残留节点。降级链保留：无陆标静默不渲染，
// 面板仍可经 /dsh-session-overview 直达。localStorage 'dsh-so-debug'=1 时每次
// 探测 console.debug 输出 {landmark, rowTag, rowCls, heal}。任何异常 try-catch
// 静默降级，绝不阻塞宿主 UI；严格单实例避免双按钮。
//   t26 行探测重写：关键词法命中的「添加工作区」实为下拉菜单项（menu.addWorkspace）
//   而非头部行控件（真实结构 = CSS Modules 哈希类 + i18n aria）→ 改用「搜索输入框
//   陆标」：placeholder 前缀匹配「搜索会话/Search」（i18n 双语）的文本输入框为主
//   陆标，退回首个可见文本输入框；行容器 = 陆标向上 ≤4 层首个含 ≥2 个 button 子
//   元素的祖先（图标按钮排），仍无则用陆标 parentElement；关键词 findAnchor 删除。
//
// 跳转桥：面板行点击 → iframe postMessage('dsh-so:navigate') → 本文件监听
// （origin+type 双校验）→ ctx.sessions.open(id)（inject 含 'sessions'）→ 成功
// 收起面板并回执 'dsh-so:navigated'，面板页凭回执记已读；监听随卸载清理。
// 依赖：react / react-dom（均在 client 静态 require 表 7 包白名单内）。
// ============================================================================

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-session-overview',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const reactDom = require('react-dom');

    const PANEL_URL = '/dsh-session-overview';
    const DEBUG_KEY = 'dsh-so-debug';

    // t28：调试通道统一出口——'dsh-so-debug'=1 时输出桥事件全链路等诊断信息
    function dbgLog(payload) {
      try {
        if (localStorage.getItem(DEBUG_KEY) === '1') {
          (console.debug || console.log).call(console, '[session-overview][bridge]', JSON.stringify(payload));
        }
      } catch (e) {}
    }

    const STYLE_TEXT = [
      // 行内 flex 子元素：继承行的 gap/对齐，仅保留尺寸/hover/active（t22）
      '.dsh-so-btn{background:none;border:none;cursor:pointer;display:inline-flex;',
      'align-items:center;justify-content:center;width:28px;height:28px;flex:none;',
      'border-radius:8px;opacity:.72;color:inherit;}',
      '.dsh-so-btn:hover{opacity:1;background:rgba(128,128,128,.15);}',
      '.dsh-so-btn.active{opacity:1;background:rgba(75,130,240,.18);}',
      '.dsh-so-btn svg{display:block;}',
      '.dsh-so-root{position:fixed;inset:0;z-index:10000;}',
      '.dsh-so-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45);}',
      '.dsh-so-card{position:absolute;left:50%;top:5%;transform:translateX(-50%);',
      'width:min(960px,calc(100vw - 48px));height:min(86vh,860px);display:flex;',
      'flex-direction:column;background:#12151d;border:1px solid #2a3040;border-radius:12px;',
      'overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.5);}',
      '.dsh-so-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;',
      'border-bottom:1px solid #232936;color:#e5e7eb;font-size:14px;font-weight:600;}',
      '.dsh-so-spacer{flex:1;}',
      '.dsh-so-link{color:#7aa2f7;font-size:12.5px;font-weight:400;text-decoration:none;}',
      '.dsh-so-link:hover{text-decoration:underline;}',
      '.dsh-so-close{background:none;border:none;color:#9ca3af;font-size:16px;',
      'cursor:pointer;padding:2px 8px;border-radius:6px;}',
      '.dsh-so-close:hover{background:rgba(128,128,128,.2);color:#e5e7eb;}',
      '.dsh-so-frame{flex:1;width:100%;border:none;background:#0f1117;}',
      '@media (prefers-color-scheme: light){',
      '.dsh-so-card{background:#fff;border-color:#dde1e7;}',
      '.dsh-so-bar{color:#24292f;border-color:#e3e6ec;}',
      '.dsh-so-close{color:#656d76;}',
      '.dsh-so-frame{background:#f5f6f8;}}',
    ].join('');

    let styleReady = false;
    function ensureStyle() {
      if (styleReady) return;
      if (!document.getElementById('dsh-so-style')) {
        const style = document.createElement('style');
        style.id = 'dsh-so-style';
        style.textContent = STYLE_TEXT;
        document.head.appendChild(style);
      }
      styleReady = true;
    }

    // 「会话列表 + 状态圆点」线性图标：与宿主 outline 图标同风格
    const ICON_SVG = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<circle cx="2.9" cy="3.4" r="1.45" fill="currentColor"/>'
      + '<circle cx="2.9" cy="8" r="1.45" fill="currentColor"/>'
      + '<circle cx="2.9" cy="12.6" r="1.45" fill="currentColor"/>'
      + '<line x1="6.4" y1="3.4" x2="13.6" y2="3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
      + '<line x1="6.4" y1="8" x2="11.6" y2="8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
      + '<line x1="6.4" y1="12.6" x2="12.6" y2="12.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
      + '</svg>';

    // 悬浮面板：遮罩 + 卡片（标题栏 / 新标签页兜底 / 关闭 / iframe）
    function Overlay(props) {
      return react.createElement(
        'div',
        { className: 'dsh-so-root' },
        react.createElement('div', { className: 'dsh-so-backdrop', onClick: props.onClose }),
        react.createElement(
          'div',
          { className: 'dsh-so-card' },
          react.createElement(
            'div',
            { className: 'dsh-so-bar' },
            react.createElement(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: '7px' } },
              react.createElement('span', { dangerouslySetInnerHTML: { __html: ICON_SVG } }),
              react.createElement('span', null, '会话总览')
            ),
            react.createElement('span', { className: 'dsh-so-spacer' }),
            react.createElement(
              'a',
              { className: 'dsh-so-link', href: PANEL_URL, target: '_blank', rel: 'noopener' },
              '新标签页打开'
            ),
            react.createElement(
              'button',
              { type: 'button', className: 'dsh-so-close', title: '关闭', onClick: props.onClose },
              '✕'
            )
          ),
          react.createElement('iframe', { className: 'dsh-so-frame', src: PANEL_URL, title: '会话总览' })
        )
      );
    }

    // ── 行探测（t26：搜索输入框陆标，标签无关；任何异常返回 null → 静默隐藏）──
    // 根因：v3 关键词法命中的「添加工作区」实为下拉菜单项（menu.addWorkspace）而
    // 非头部行控件（真实结构 = CSS Modules 哈希类 + i18n aria）。新法以侧边栏搜索
    // 输入框为陆标：placeholder 前缀「搜索会话/Search」（i18n 双语）；找不到退回
    // 首个可见文本输入框（DOM 序靠前的大概率是侧边栏搜索框）。
    const LANDMARK_PLACEHOLDER_RE = /^(?:搜索会话|search)/i;

    function findSearchLandmark() {
      try {
        var inputs = document.querySelectorAll('input');
        var fallback = null;
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var type = String(el.getAttribute('type') || 'text').toLowerCase();
          if (type !== 'text' && type !== 'search') continue;
          var ph = String(el.getAttribute('placeholder') || '');
          if (LANDMARK_PLACEHOLDER_RE.test(ph)) return el;        // 主陆标：双语前缀
          if (!fallback) {
            var r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) fallback = el;       // 降级候选：首个可见文本输入框
          }
        }
        return fallback;
      } catch (e) { return null; }
    }

    // 行容器 = 陆标向上 ≤4 层、首个「同时包含 ≥2 个 button 子元素」的祖先（即图标
    // 按钮排）；仍找不到则用陆标的 parentElement。
    function findRowHostEl(landmarkEl) {
      try {
        var node = landmarkEl;
        for (var up = 0; node && up < 4; up++) {
          node = node.parentElement;
          if (!node) break;
          var btns = node.querySelectorAll ? node.querySelectorAll('button') : [];
          if (btns.length >= 2) return node;
        }
        return landmarkEl.parentElement || null;
      } catch (e) { return null; }
    }

    function findRowHost() {
      try {
        var landmark = findSearchLandmark();
        if (!landmark) return null;                                // 无陆标 → 静默
        return { host: findRowHostEl(landmark), landmark: landmark };
      } catch (e) { return null; }
    }

    // ── 失联判定（t22 自愈）：host 或按钮任一断链（isConnected=false / 不含）→ 重插
    function needsReinsert(hostEl, btnEl) {
      try {
        if (!hostEl || !hostEl.isConnected) return true;
        if (!btnEl || !btnEl.isConnected) return true;
        return hostEl.contains ? !hostEl.contains(btnEl) : true;
      } catch (e) { return true; }
    }

    const name = 'dsh-session-overview';
    const inject = ['slots', 'sessions'];

    function apply(ctx) {
      ensureStyle();

      // 跳转代答（NOTES-nav §3；契约 sessions.d.ts:32-35 —— open 即「选中+打开窗口」，
      // task-board 668-674 同款语义）：面板 iframe 发来的 dsh-so:navigate 在这里落地
      const navigateTo = function (sessionId) {
        try {
          if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
          ctx.sessions.open(sessionId);
          return true;
        } catch (error) {
          console.warn('[session-overview] open failed:', error);
          return false;
        }
      };

      // 入口按钮（t22）：shell.overlay 槽仅承载生命周期（Entry 本体返回 null），
      // 按钮经 createPortal 注入工作区头部行容器，成为真实 flex 子元素；
      // 找不到行容器 → 静默不渲染（面板仍可经 /dsh-session-overview 直达）。
      function Entry() {
        const [open, setOpen] = react.useState(false);
        const [hostEl, setHostEl] = react.useState(null);   // 行容器 | null=未找到
        const [heal, setHeal] = react.useState(0);          // portal key：失联自愈计数
        const btnRef = react.useRef(null);
        const healRef = react.useRef(0);

        // 探测一次（t26 陆标法）：更新行容器；按钮失联则递增 portal key 强制重挂载
        const probe = function () {
          try {
            var found = findRowHost();
            var next = found ? found.host : null;
            setHostEl(function (prev) { return prev === next ? prev : next; });
            if (next && needsReinsert(next, btnRef.current)) {
              healRef.current += 1;
              setHeal(healRef.current);
            }
            try {
              if (localStorage.getItem(DEBUG_KEY) === '1') {
                (console.debug || console.log).call(console, '[session-overview] inline', JSON.stringify({
                  landmark: !!(found && found.landmark),
                  rowTag: next ? String(next.tagName || '').toLowerCase() : null,
                  rowCls: next ? String(next.className || '').slice(0, 48) : null,
                  heal: healRef.current,
                }));
              }
            } catch (e) {}
          } catch (e) {}
        };

        // 自愈监听：document.body MutationObserver(childList+subtree) + ~120ms 防抖
        // + 800ms 兜底轮询；全部随卸载清理（observer disconnect / timer clear）
        react.useEffect(function () {
          var timer = null;
          var moTimer = null;
          var obs = null;
          var debounced = function () {
            if (moTimer) window.clearTimeout(moTimer);
            moTimer = window.setTimeout(function () { moTimer = null; probe(); }, 120);
          };
          try {
            probe();
            obs = new MutationObserver(debounced);
            obs.observe(document.body, { childList: true, subtree: true });
            timer = window.setInterval(probe, 800);
          } catch (e) {}
          return function () {
            try {
              if (timer) window.clearInterval(timer);
              if (moTimer) window.clearTimeout(moTimer);
              if (obs) obs.disconnect();
            } catch (e) {}
          };
        }, []);

        // Esc 关闭（仅面板开着时有意义），随面板关闭清理
        react.useEffect(function () {
          if (!open) return;
          const onKey = function (event) {
            if (event.key === 'Escape') setOpen(false);
          };
          document.addEventListener('keydown', onKey, true);
          return function () { document.removeEventListener('keydown', onKey, true); };
        }, [open]);

        // 跳转桥（t28 修复）：Entry 挂载即注册、**不依赖面板开合**——v4 曾把本监听
        // 挂在 [open] effect 上（if(!open) return），存在无人应答的窗口期，行点击
        // 不跳转且无回执 → 蓝点永不清（双回归同一根因）。origin+type 双校验；
        // 回执先于收起面板发送；'dsh-so-debug'=1 时输出全链路事件。
        react.useEffect(function () {
          const onMessage = function (event) {
            try {
              if (event.origin !== location.origin) return;         // 同源校验
              const data = event.data;
              if (!data || data.type !== 'dsh-so:navigate') return; // 消息类型白名单
              dbgLog({ evt: 'navigate-received', sessionId: data.sessionId });
              const ok = navigateTo(data.sessionId);
              dbgLog({ evt: 'open-result', sessionId: data.sessionId, ok: ok });
              try {
                if (event.source) {
                  event.source.postMessage(
                    { type: 'dsh-so:navigated', sessionId: data.sessionId, ok: ok },
                    location.origin
                  );                                                // 回执先发，再收起面板
                  dbgLog({ evt: 'reply-sent', sessionId: data.sessionId, ok: ok });
                }
              } catch (e) {}
              if (ok) setOpen(false);                               // 成功才收起，会话视图接管
            } catch (e) {}
          };
          window.addEventListener('message', onMessage);
          return function () { window.removeEventListener('message', onMessage); };
        }, []);

        // 行内按钮 portal：portal key 随 heal 递增 → 失联自愈时强制新节点重插
        const inlineBtn = hostEl
          ? reactDom.createPortal(
              react.createElement('button', {
                key: 'dsh-so-btn-' + heal,
                ref: function (node) { btnRef.current = node; },
                type: 'button',
                className: 'dsh-so-btn' + (open ? ' active' : ''),
                title: '会话总览',
                'aria-label': '会话总览',
                onClick: function () { setOpen(true); },
                dangerouslySetInnerHTML: { __html: ICON_SVG }
              }),
              hostEl,
              'dsh-so-inline-' + heal
            )
          : null;

        // Entry 本体返回 null（槽位处无可见内容）：按钮在行容器内、面板在 body
        return react.createElement(
          react.Fragment,
          null,
          inlineBtn,
          open
            ? reactDom.createPortal(
                react.createElement(Overlay, { onClose: function () { setOpen(false); } }),
                document.body
              )
            : null
        );
      }

      ctx.effect(function () {
        return ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-session-overview',
            order: 80,
            label: function () { return '会话总览'; }
          }, Entry);
        });
      }, 'dsh-session-overview: overlay entry');
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
