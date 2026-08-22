// ============================================================================
// dsh-session-overview — client 侧（浏览器 bundle）
//
// 契约依据（v2，注入前评审后按宿主实证修正）：
//   runner 槽目录（dsh-cordis-client-runner/lib/client.js 3330-3504）与官方示例：
//     ctx.slots.register({ ...options }, <React 组件或 render thunk>)
//   —— 组件是 register 的第二个参数、返回 React 元素；sidebar.footer.action
//   的占位组件由宿主以 React 渲染（CordisPanel 先例：dsh-client-ui-cordis
//   lib/client.js 1337-1367）。vanilla {render,dispose} 形态在该槽不受支持。
//
// 行为：侧边栏底部「会话总览」线性图标按钮（内联 SVG，currentColor 随主题），
// 点击经 createPortal 在 body 挂悬浮面板
// （iframe 加载 host 侧面板页 /dsh-session-overview）；Esc / 点遮罩 / ✕ 关闭。
// 跳转桥（t11）：面板行点击 → iframe postMessage('dsh-so:navigate') → 本文件监听
// （origin+type 双校验）→ ctx.sessions.open(id)（inject 增加 'sessions'）→ 成功
// 收起面板并回执 'dsh-so:navigated'，面板页凭回执记已读；监听随 useEffect 卸载清理。
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

    const STYLE_TEXT = [
      '.dsh-so-btn{background:none;border:none;cursor:pointer;display:inline-flex;',
      'align-items:center;justify-content:center;width:28px;height:28px;',
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
    // （16 视窗、currentColor 随主题、圆点=状态语义、横线=会话条目）
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
          // 目标会话不在客户端镜像（listed/retained 之外）时会抛/无效 → 面板保持原状
          console.warn('[session-overview] open failed:', error);
          return false;
        }
      };

      // 侧边栏 footer 条目（两参契约 mem_8b042e81）：线性图标按钮 + portal 悬浮面板
      function Entry() {
        const [open, setOpen] = react.useState(false);
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
        return react.createElement(
          react.Fragment,
          null,
          react.createElement('button', {
            type: 'button',
            className: 'dsh-so-btn' + (open ? ' active' : ''),
            title: '会话总览',
            'aria-label': '会话总览',
            onClick: function () { setOpen(function (v) { return !v; }); },
            dangerouslySetInnerHTML: { __html: ICON_SVG }
          }),
          open
            ? reactDom.createPortal(
                react.createElement(Overlay, { onClose: function () { setOpen(false); } }),
                document.body
              )
            : null
        );
      }

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.footer.action', function () {
          return ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'dsh-session-overview',
            order: 80,
            label: function () { return '会话总览'; }
          }, Entry);
        });
      }, 'dsh-session-overview: sidebar entry');
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
