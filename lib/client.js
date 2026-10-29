/**
 * dsh-edict-boot — 浏览器半侧（设置页「奏折开机动画」）
 * ----------------------------------------------------------------------------
 * 以 dsh.client bundle 格式加载（手写 ModuleLoader bundle，无需构建）。
 * 只注册一个 settings.section：改开关、节奏、奏文、朱批、印文，并能就地预览。
 *
 * 数据不走 settings 命名空间，而是走 Host 半侧自带的 /dsh-edict/config
 * （与 dsh-startup-screen 同款做法）——少受 dsh-settings 版本变更影响。
 *
 * 注册 id 必须等于 loader entry 名（dsh-edict-boot），
 * 否则 ModuleLoader 会报 "loaded without registering dsh-edict-boot"。
 */
window.__ModuleLoader__.load({
  id: 'dsh-edict-boot',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    var API = '/dsh-edict/config'
    var PREVIEW = '/dsh-edict/preview'
    var CSS_ID = '__edict_panel_css'

    /* ── 样式：一次性注入，前缀统一，不碰宿主全局 ─────────────────────── */
    var CSS = [
      '.__ed_root{max-width:660px;display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.__ed_head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
      '.__ed_ver{font-family:ui-monospace,Consolas,monospace;font-size:11px;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary)}',
      '.__ed_group{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
      '.__ed_gt{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.__ed_field{display:flex;flex-direction:column;gap:5px}',
      '.__ed_label{font-size:12px;font-weight:600}',
      '.__ed_hint{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}',
      '.__ed_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.__ed_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;width:100%;outline:none}',
      '.__ed_input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.__ed_area{min-height:86px;resize:vertical;font-family:inherit;line-height:1.65}',
      '.__ed_check{display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px}',
      '.__ed_check input{margin:2px 0 0}',
      '.__ed_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:12px;cursor:pointer}',
      '.__ed_btn:hover{border-color:var(--dsw-alias-state-business-primary)}',
      '.__ed_btn[disabled]{opacity:.5;cursor:default}',
      '.__ed_primary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
      '.__ed_msg{font-size:11px;min-height:1em}',
      '.__ed_range{display:flex;align-items:center;gap:10px}',
      '.__ed_range input[type=range]{flex:1;min-width:120px}',
      '.__ed_val{font-family:ui-monospace,Consolas,monospace;font-size:11px;min-width:38px;text-align:right;opacity:.75}'
    ].join('\n')

    function ensureCss () {
      if (document.getElementById(CSS_ID)) return
      var style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /* ── 小工具 ───────────────────────────────────────────────────────── */
    function Field (props) {
      return h('div', { className: '__ed_field' },
        h('label', { className: '__ed_label' }, props.label),
        props.children,
        props.hint ? h('div', { className: '__ed_hint' }, props.hint) : null
      )
    }

    function Group (props) {
      return h('div', { className: '__ed_group' },
        props.title ? h('div', { className: '__ed_gt' }, props.title) : null,
        props.children
      )
    }

    function Check (props) {
      return h('label', { className: '__ed_check' },
        h('input', { type: 'checkbox', checked: !!props.checked, onChange: function (e) { props.onChange(e.target.checked) } }),
        h('span', null, props.label)
      )
    }

    /* ── 面板 ─────────────────────────────────────────────────────────── */
    function Panel () {
      ensureCss()
      var s = react.useState(null)
      var cfg = s[0]
      var setCfg = s[1]
      var d = react.useState('')
      var msg = d[0]
      var setMsg = d[1]
      var b = react.useState(false)
      var busy = b[0]
      var setBusy = b[1]
      var v = react.useState('')
      var version = v[0]
      var setVersion = v[1]
      var f = react.useState('')
      var filePath = f[0]
      var setFilePath = f[1]

      react.useEffect(function () {
        fetch(API, { credentials: 'same-origin' })
          .then(function (r) { return r.json() })
          .then(function (p) {
            if (p && p.config) setCfg(p.config)
            if (p && p.version) setVersion(p.version)
            if (p && p.file) setFilePath(p.file)
          })
          .catch(function () { setMsg('读不到配置：Host 半侧可能没加载') })
      }, [])

      function patch (next) {
        setCfg(function (prev) { return Object.assign({}, prev || {}, next) })
      }

      function save () {
        setBusy(true)
        setMsg('')
        fetch(API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch: cfg })
        })
          .then(function (r) { return r.json() })
          .then(function (p) {
            if (p && p.config) setCfg(p.config)
            setMsg(p && p.ok ? '已保存。下次打开 DSH 生效。' : ('保存失败：' + ((p && p.error) || '未知错误')))
          })
          .catch(function (e) { setMsg('保存失败：' + String(e && e.message || e)) })
          .then(function () { setBusy(false) })
      }

      function reset () {
        setBusy(true)
        fetch(API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
        })
          .then(function (r) { return r.json() })
          .then(function (p) {
            if (p && p.config) setCfg(p.config)
            setMsg('已恢复默认。')
          })
          .catch(function () { setMsg('恢复默认失败') })
          .then(function () { setBusy(false) })
      }

      function preview () {
        window.open(PREVIEW + '?play=1', '_blank', 'noopener')
      }

      if (!cfg) {
        return h('div', { className: '__ed_root' },
          h('div', { className: '__ed_hint' }, msg || '正在读取配置…')
        )
      }

      var columnsText = (cfg.columns || []).join('\n')

      return h('div', { className: '__ed_root' },

        h('div', { className: '__ed_head' },
          h('div', { className: '__ed_label', style: { fontSize: '13px' } }, '奏折开机动画'),
          h('div', { className: '__ed_ver' }, version ? 'v' + version : '')
        ),
        h('div', { className: '__ed_hint' },
          '打开 DSH 时，御案上展开一卷奏折，奏文自右向左誊写，落朱批「知道了」并盖下御览之宝，随后整幕虚化，露出主界面。'),

        h(Group, { title: '播放' },
          h(Check, {
            label: '启用（关掉后连脚本都不会注入页面）',
            checked: cfg.enabled !== false,
            onChange: function (on) { patch({ enabled: on }) }
          }),
          h(Check, {
            label: '使用实拍奏折视频（关闭则用纯 CSS 演绎）',
            checked: cfg.video !== false,
            onChange: function (on) { patch({ video: on }) }
          }),
          h(Check, {
            label: '允许跳过（Esc 或右下角按钮）',
            checked: cfg.allowSkip !== false,
            onChange: function (on) { patch({ allowSkip: on }) }
          }),
          h(Field, { label: '节奏', hint: '1 = 约 5.5 秒放完；调大更快。' },
            h('div', { className: '__ed_range' },
              h('input', {
                type: 'range', min: '0.5', max: '2.5', step: '0.05',
                value: String(cfg.speed || 1),
                onChange: function (e) { patch({ speed: Number(e.target.value) }) }
              }),
              h('span', { className: '__ed_val' }, (cfg.speed || 1).toFixed(2) + '×')
            )
          )
        ),

        /* 只有 CSS 版才用得上这些；视频版是纯素材，不该给无关选项 */
        cfg.video === true ? null : h(Group, { title: '朱批与宝玺' },
          h(Field, { label: '朱批文字', hint: '竖排写在正文左侧，自右向左扫出。' },
            h('input', {
              className: '__ed_input', value: cfg.edictText || '',
              onChange: function (e) { patch({ edictText: e.target.value }) }
            })
          ),
          h(Field, { label: '印文（四字，2×2 排列）' },
            h('input', {
              className: '__ed_input', value: cfg.sealText || '',
              maxLength: 4,
              onChange: function (e) { patch({ sealText: e.target.value }) }
            })
          ),
          h(Field, { label: '封皮题签' },
            h('input', {
              className: '__ed_input', value: cfg.coverLabel || '',
              onChange: function (e) { patch({ coverLabel: e.target.value }) }
            })
          )
        ),

        h('div', { className: '__ed_row' },
          h('button', { className: '__ed_btn __ed_primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
          h('button', { className: '__ed_btn', onClick: preview }, '▶ 预览'),
          h('button', { className: '__ed_btn', onClick: reset, disabled: busy }, '恢复默认')
        ),
        h('div', { className: '__ed_msg', style: { color: 'var(--dsw-alias-label-tertiary)' } }, msg),
        filePath ? h('div', { className: '__ed_hint' }, '配置文件：' + filePath) : null
      )
    }

    /* ── 浏览器半侧自举 ───────────────────────────────────────────────────
     *
     * 桌面端（DeepSeek Harness Desktop）的 webview 走自定义协议 dsh-app://，
     * **不经过 webServer.tapIndex 改写 index.html**。只靠 Host 注入的片头
     * 在桌面端永远不出现——这正是"代码没错、克隆实例里也正常、用户却看不到"
     * 的原因。
     *
     * 所以这里补一条兜底：自己建浮层、自己拉 scene.js、自己播。
     * 判定依据只看 window 上的标记，不猜宿主类型：
     *   __DSH_EDICT_BOOT__ === 'index'  → Host 已注入，这里什么都不做
     *   没有这个标记                     → 由浏览器半侧自举
     *
     * 与 Host 侧互斥，绝不会播两遍。 */

    var STYLE_ID = '__edict_boot_css'
    var SCENE_ID = '__edict_boot_scene'
    var VEIL_ID = '__edict_boot_veil'
    var bootAttempted = false

    /**
     * 首帧遮罩。
     *
     * 自举要依次完成「取配置 → 拉 scene.js → 建浮层 → 视频出首帧」，
     * 这几步之间页面是可见的，于是观感是「先闪一下 DSH，再弹出动画」。
     *
     * 对策是在**最早的一刻**先糊一层不透明的底色盖住整个视口，
     * 等视频真的能出画面了再把它撤掉。颜色取御案的深棕 #120d08 ——
     * 和片头第一帧的桌面同色，所以从"遮罩"过渡到"视频"是无缝的。
     *
     * 全程只加一段内联样式，不依赖外部 CSS，因此立刻生效。
     */
    function raiseVeil () {
      if (document.getElementById(VEIL_ID)) return null
      var veil = document.createElement('div')
      veil.id = VEIL_ID
      veil.setAttribute('data-dsh-edict-veil', '')
      /* 内联样式：不等任何资源，插入即生效 */
      veil.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483000',
        'background:#120d08', 'margin:0', 'padding:0',
        'transition:opacity 260ms ease-out', 'opacity:1'
      ].join(';')
      var root = document.body || document.documentElement
      if (root) root.appendChild(veil)
      return veil
    }

    function dropVeil (veil) {
      if (!veil) return
      veil.style.opacity = '0'
      window.setTimeout(function () {
        if (veil.parentNode) veil.parentNode.removeChild(veil)
      }, 300)
    }

    function bootSelf () {
      if (bootAttempted) return
      if (window.__DSH_EDICT_BOOT__ === 'index') return   /* Host 已注入 */
      bootAttempted = true

      /* 立刻盖上，别让 DSH 界面先露出来 */
      var veil = raiseVeil()

      /* 配置：Host 注入过就直接用；否则自己向 /dsh-edict/config 要 */
      var start = function (cfg) {
        try {
          if (cfg && cfg.enabled === false) { dropVeil(veil); return }
          loadScene(function () {
            try {
              if (window.DshEdictBoot) {
                /*
                 * onReady：视频真正能出画面的那一刻由 scene.js 回调。
                 * 渲染一帧之后再撤遮罩，避免"遮罩没了但首帧还没到"的空窗。
                 */
                window.DshEdictBoot.play({
                  config: cfg || {},
                  onReady: function () {
                    window.requestAnimationFrame(function () {
                      window.requestAnimationFrame(function () { dropVeil(veil) })
                    })
                  }
                })
                /* 兜底：万一 onReady 因为任何原因没来，1.5 秒后无条件撤掉 */
                window.setTimeout(function () { dropVeil(veil) }, 1500)
                return
              }
            } catch (e) { /* 装饰性插件，失败就安静 */ }
            dropVeil(veil)
          })
        } catch (e) { dropVeil(veil) }
      }

      if (window.__DSH_EDICT__) { start(window.__DSH_EDICT__); return }

      /* 没有注入的配置：自己取一份。取不到就用默认值照常播。 */
      try {
        fetch('/dsh-edict/config', { credentials: 'same-origin' })
          .then(function (r) { return r.json() })
          .then(function (p) { start(p && p.config ? p.config : {}) })
          .catch(function () { start({}) })
      } catch (e) { start({}) }
    }

    function loadScene (done) {
      /* 样式 */
      if (!document.getElementById(STYLE_ID)) {
        var link = document.createElement('link')
        link.id = STYLE_ID
        link.rel = 'stylesheet'
        link.href = '/dsh-edict/css'
        link.onerror = function () { /* 没样式也比不播好 */ }
        document.head.appendChild(link)
      }
      /* 脚本 */
      if (window.DshEdictBoot) { done(); return }
      if (document.getElementById(SCENE_ID)) {
        /* 已在加载中：轮询等它到位 */
        var tries = 0
        var timer = setInterval(function () {
          if (window.DshEdictBoot) { clearInterval(timer); done() }
          else if (++tries > 200) { clearInterval(timer) }
        }, 16)
        return
      }
      var s = document.createElement('script')
      s.id = SCENE_ID
      s.src = '/dsh-edict/scene.js'
      s.async = true
      s.onload = function () { done() }
      s.onerror = function () { /* 拉不到就不播 */ }
      document.head.appendChild(s)
    }

    /* ── 插件 ─────────────────────────────────────────────────────────── */
    var inject = ['slots']

    function apply (ctx) {
      /* 桌面端兜底：Host 的 index 注入不生效时，由这里自举。
         正常 web 流程下 __DSH_EDICT_BOOT__ 已就位，本调用直接返回。 */
      try { bootSelf() } catch (e) { /* 自举失败绝不许把宿主带崩 */ }

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'edict-boot', order: 27, label: '奏折开机动画' },
          function () { return h(Panel, {}) }
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})