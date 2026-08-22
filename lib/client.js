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
// 强制新节点）；卸载清理 observer 与残留节点。降级链保留：无锚点静默不渲染，
// 面板仍可经 /dsh-session-overview 直达。localStorage 'dsh-so-debug'=1 时每次
// 探测 console.debug 输出 {found, tag, heal}。任何异常 try-catch 静默降级，
// 绝不阻塞宿主 UI；严格单实例避免双按钮。
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

    // ── 锚点探测（t15，纯读 DOM，任何异常返回 null → 按钮静默隐藏）──
    // 找工作区头部行的小尺寸可点击控件（button/[role=button]），按 aria-label/
    // title/文本匹配「添加工作区」等关键词；多命中取该行最右侧。
    const ANCHOR_KEYS = [
      '添加工作区', '新建工作区', '新增工作区', '创建工作区',
      '添加项目', '新建项目', '创建项目', '新建空间',
      'add workspace', 'new workspace', 'create workspace', 'add project', 'new project',
    ];

    function findAnchor() {
      try {
        var scopes = [];
        var aside = document.querySelector('aside,nav');
        if (aside) scopes.push(aside);
        scopes.push(document);
        var hits = [];
        for (var si = 0; si < scopes.length && hits.length === 0; si++) {
          var scope = scopes[si];
          if (hits.__scoped && hits.__scoped.indexOf(scope) !== -1) continue;
          (hits.__scoped = hits.__scoped || []).push(scope);
          var els = scope.querySelectorAll('button, [role="button"]');
          for (var i = 0; i < els.length; i++) {
            try {
              var el = els[i];
              var hay = [
                el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent || '',
              ].join(' ').toLowerCase();
              var matched = false;
              for (var k = 0; k < ANCHOR_KEYS.length; k++) {
                if (hay.indexOf(ANCHOR_KEYS[k]) !== -1) { matched = true; break; }
              }
              if (!matched) continue;
              var rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue;      // 不可见
              if (rect.height > 48 || rect.width > 160) continue;     // 只认小尺寸控件
              hits.push({ el: el, rect: rect });
            } catch (e) {}
          }
        }
        if (!hits.length) return null;
        hits.sort(function (a, b) { return a.rect.top - b.rect.top || a.rect.left - b.rect.left; });
        var rowTop = hits[0].rect.top;
        var row = hits.filter(function (h) {
          return Math.abs(h.rect.top - rowTop) <= Math.max(8, h.rect.height / 2);
        });
        row.sort(function (a, b) { return b.rect.right - a.rect.right; });   // 该行最右
        var rowEls = [];
        for (var w = 0; w < row.length; w++) rowEls.push(row[w].el);
        return { el: row[0].el, rect: row[0].rect, rowEls: rowEls };
      } catch (e) { return null; }
    }

    // ── 行容器探测（t22，标签无关）：从锚点 parentElement 链向上，首个矩形包含
    // 全部同行命中控件（含 2px 容差）的祖先即该行的 flex 容器。纯元素级结果，
    // 不做任何坐标计算——对齐交给行自身布局。
    function findRowHostEl(anchorEl, rowEls) {
      try {
        var TOL = 2;
        var node = anchorEl;
        for (var depth = 0; node && depth < 24; depth++) {
          node = node.parentElement;
          if (!node) break;
          var br = null;
          try { br = node.getBoundingClientRect(); } catch (e) { br = null; }
          if (!br || !(br.width > 0 && br.height > 0)) continue;
          var ok = true;
          for (var i = 0; i < rowEls.length; i++) {
            try {
              var er = rowEls[i].getBoundingClientRect();
              if (!er || !(er.width > 0 && er.height > 0)) continue;
              if (er.left < br.left - TOL || er.right > br.right + TOL ||
                  er.top < br.top - TOL || er.bottom > br.bottom + TOL) { ok = false; break; }
            } catch (e) {}
          }
          if (ok) return node;
        }
      } catch (e) {}
      return null;
    }

    function findRowHost() {
      try {
        var hit = findAnchor();
        if (!hit || !hit.rowEls || !hit.rowEls.length) return null;
        return findRowHostEl(hit.el, hit.rowEls);
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

        // 探测一次：更新行容器；按钮失联则递增 portal key 强制重挂载新节点
        const probe = function () {
          try {
            var next = findRowHost();
            setHostEl(function (prev) { return prev === next ? prev : next; });
            if (next && needsReinsert(next, btnRef.current)) {
              healRef.current += 1;
              setHeal(healRef.current);
            }
            try {
              if (localStorage.getItem(DEBUG_KEY) === '1') {
                (console.debug || console.log).call(console, '[session-overview] inline', JSON.stringify({
                  found: !!next,
                  tag: next ? String(next.tagName || '').toLowerCase() : null,
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

        // 面板开着时的 Esc 关闭 + 跳转桥（origin+type 双校验），随面板关闭清理
        react.useEffect(function () {
          if (!open) return;
          const onKey = function (event) {
            if (event.key === 'Escape') setOpen(false);
          };
          const onMessage = function (event) {
            if (event.origin !== location.origin) return;           // 同源校验
            const data = event.data;
            if (!data || data.type !== 'dsh-so:navigate') return;   // 消息类型白名单
            const ok = navigateTo(data.sessionId);
            if (ok) setOpen(false);                                 // 成功即收起，会话视图接管
            try {
              if (event.source) {
                event.source.postMessage(
                  { type: 'dsh-so:navigated', sessionId: data.sessionId, ok: ok },
                  location.origin
                );                                                  // 回执给面板页：open 成功才记已读
              }
            } catch (e) {}
          };
          document.addEventListener('keydown', onKey, true);
          window.addEventListener('message', onMessage);
          return function () {
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('message', onMessage);       // 随面板关闭/卸载清理
          };
        }, [open]);

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
