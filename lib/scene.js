/**
 * dsh-edict-boot — 场景运行时（浏览器）
 * ----------------------------------------------------------------------------
 * 职责窄到只有三件事：
 *   1. 把 DOM 搭出来（御案 → 奏折 → 奏文 → 朱批 → 印章）
 *   2. 用一条时间线往根节点上加 ed-open / ed-unrolled / ed-written /
 *      ed-brushed / ed-sealed / ed-reveal 这些类，推进五个阶段
 *   3. 跳过（按钮 / Esc / 点击）、到达终点后卸载自己
 *
 * 为什么不是一条长 keyframes：每个阶段都可以单独定格（?phase=N&static=1），
 * 这样画面能截图核对，跳过也不会有"动画演到一半被切断"的尴尬。
 *
 * 这个文件同时被两处使用：
 *   - host 半侧把它原样当静态资源发给 index.html（首屏就成立，不等 React）
 *   - preview/index.html 直接引用，用来做逐帧截图
 * 所以它必须是一个自包含的 IIFE，不 import 任何东西。
 */
;(function () {
  'use strict'

  var STYLE_ID = 'dsh-edict-boot-style'
  var CSS_URL = '/dsh-edict/css'

  /* ── 文案与节奏：host 注入 window.__DSH_EDICT__，没有就用这份默认 ─────── */
  var DEFAULTS = {
    enabled: true,
    video: true,
    speed: 1,
    allowSkip: true,
    sealText: '御覽之寶',
    edictText: '知道了',
    columns: [
      '臣等謹奏',
      '伏惟陛下',
      '睿鑒臣等所請',
      '准開機視事',
      '以慰臣民之望',
      '臣等不勝惶恐',
      '待命之至'
    ],
    signature: '臣等頓首謹奏',
    coverLabel: '奏　摺',
    brand: 'DEEPSEEK HARNESS'
  }

  /**
   * 视觉阶段：只有"画面往前推"的这几步。揭幕**不在**这个数组里——
   * 它是"整幕消失"，一旦被定格模式当成阶段加进去，画面就整个空白了。
   */
  /**
   * 时间线（1× 速度）
   * -------------------------------------------------------------------------
   * 只有三拍，和"翻开奏折，看到的就是办公的地方"这件事直接对应：
   *
   *   0 合着的奏折 → 1 解封皮 → 2 奏折缓缓张开（张开途中虚化、桌面渐入）
   *
   * 奏文、朱批、宝玺**不再是独立步骤**——它们随"张开"一起显形，
   * 于是纸面铺开的时候上面已经是写好的奏折，而不是一张白纸。
   *
   * 虚化压在第二拍的中段：张开 1350ms 起、2950ms 才张满，虚化 2000ms 就起。
   * 剩下近一秒里，奏折一边继续向外撑开、一边化进雾里，DSH 从雾里浮出来。
   */
  var PHASES = [
    { at: 0,    cls: 'ed-closed' },     /* 0 合着的奏折，静止一拍（等你看清） */
    { at: 700,  cls: 'ed-open' },       /* 1 解封皮：两片封面绕书脊翻开 */
    { at: 1350, cls: 'ed-unrolled' }    /* 2 缓缓张开：整卷推向全宽（1600ms） */
  ]
  /**
   * 虚化起点。
   *
   * 要等**宝玺落定**（1350 + 1500 = 2850）之后才起，否则观众还没看清批语，
   * 纸就已经糊了——这是第一版的实测问题。
   * 而张开到 2950 才满，所以 2900 起虚化仍然叠在"还在张开"的尾巴上。
   */
  var REVEAL_AT = 2900
  /**
   * 交叉虚化的总时长，必须 >= scene.css 里最长的那条过渡。
   * 提前卸载 = 把动画从中间切断，比没有动画更难看。
   */
  var REVEAL_MS = 1300
  var REVEAL_HOLD = 120   /* 化完再留一口气，然后才卸载 */
  /** 视频版：提前多久开始收尾（毫秒）。要 >= 渐出的总时长，否则片子还没化完就断了。 */
  var REVEAL_LEAD = 1500
  /** 乌丝栏的格数。没有文字，这就是一张干净待批的纸。 */
  var RULE_COUNT = 9

  function readConfig() {
    var raw = (typeof window !== 'undefined' && window.__DSH_EDICT__) || null
    var cfg = {}
    var key
    for (key in DEFAULTS) cfg[key] = DEFAULTS[key]
    if (raw && typeof raw === 'object') {
      if (typeof raw.speed === 'number' && isFinite(raw.speed)) {
        cfg.speed = Math.min(3, Math.max(0.25, raw.speed))
      }
      if (typeof raw.allowSkip === 'boolean') cfg.allowSkip = raw.allowSkip
      if (typeof raw.video === 'boolean') cfg.video = raw.video
      ;['sealText', 'edictText', 'coverLabel', 'brand'].forEach(function (k) {
        if (typeof raw[k] === 'string' && raw[k].trim() !== '') cfg[k] = raw[k].slice(0, 64)
      })
    }
    return cfg
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  }

  /**
   * 纸面上的内容：乌丝栏 + 朱批 + 宝玺。
   *
   * 刻意**不写奏文**。奏折展开的过程中，纸面本身保持干净的留白——观众的
   * 注意力在"张开"这个动作和最后落下的朱批上；密密麻麻的竖排小字在
   * 1600ms 里既看不清，又会让画面显得吵。
   *
   * 朱批与宝玺的位置按真奏折来：右侧是留白的正文区，左侧用来落批语和印。
   */
  function buildSheet(cfg) {
    var paper = el('div', 'ed-paper')

    /* 乌丝栏：正文区的竖线。没有字，但栏线还在——一张待批的空白奏折。 */
    var rules = el('div', 'ed-rules')
    for (var n = 0; n <= RULE_COUNT; n++) {
      var line = el('div', 'ed-rule-line')
      line.style.left = (n / RULE_COUNT) * 100 + '%'
      rules.appendChild(line)
    }
    paper.appendChild(rules)

    paper.appendChild(el('div', 'ed-edict', cfg.edictText))

    var seal = el('div', 'ed-seal')
    var chars = String(cfg.sealText)
    for (var idx = 0; idx < 4; idx++) seal.appendChild(el('span', null, chars.charAt(idx) || ''))
    paper.appendChild(seal)

    return paper
  }

  function build(cfg) {
    var root = el('div', 'ed-root')
    root.style.setProperty('--ed-speed', String(cfg.speed))

    root.appendChild(el('div', 'ed-desk'))

    var stage = el('div', 'ed-stage')
    var layer = el('div', 'ed-fold-layer')

    var left = el('div', 'ed-cover ed-cover--left')
    left.setAttribute('data-label', cfg.coverLabel)
    var right = el('div', 'ed-cover ed-cover--right')
    right.setAttribute('data-label', cfg.coverLabel)

    layer.appendChild(left)
    layer.appendChild(right)
    layer.appendChild(buildSheet(cfg))
    stage.appendChild(layer)
    root.appendChild(stage)

    root.appendChild(el('div', 'ed-vignette'))

    if (cfg.allowSkip) {
      var skip = el('button', 'ed-skip', '跳过 ⏎')
      skip.type = 'button'
      skip.addEventListener('click', function (ev) {
        ev.stopPropagation()
        finish()
      })
      root.appendChild(skip)
    }

    return root
  }

  /* ── 视频版：实拍奏折摊开 ─────────────────────────────────────────────── */

  /**
   * 视频地址。
   *
   * 绝对不能写死成 '/dsh-edict/memorial.mp4'：那是 DSH 服务器下的绝对路径，
   * 用 file:// 直接打开预览页时会解析成磁盘根目录（file:///D:/dsh-edict/...），
   * 结果就是"点了重播没反应"——视频 readyState 一直是 0。
   *
   * 所以按环境取：
   *   1. cfg.videoSrc —— 预览页/宿主显式给的最优先
   *   2. 页面里已有 <link href=".../scene.css"> —— 说明是同目录，走相对路径
   *   3. 兜底才用 DSH 的绝对路由
   */
  function resolveVideoSrc (cfg) {
    if (cfg && typeof cfg.videoSrc === 'string' && cfg.videoSrc) return cfg.videoSrc
    try {
      var links = document.querySelectorAll('link[rel="stylesheet"]')
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || ''
        if (href.indexOf('scene.css') !== -1) {
          /* 同目录：./scene.css -> ./media/memorial.mp4 */
          return href.replace(/scene\.css(\?.*)?$/, 'media/memorial.mp4')
        }
      }
    } catch (e) { /* noop */ }
    return '/dsh-edict/memorial.mp4'
  }

  /**
   * 水印遮挡。
   *
   * 实测（用 numpy 扫过全片 145 帧）：水印恒定在 x 1010..1204 / y 620..669，
   * 而奏折主体最低点只到 y=528——也就是说那块区域**从头到尾只有背景**，
   * 不含任何画面内容。所以不需要 ffmpeg 重编码、不需要裁切构图，
   * 盖一块与背景同色的矩形就等于"去除"，零画质损失。
   *
   * 数字是按 1248×704 的源画面量的，换算成百分比后与窗口尺寸无关。
   */
  var WM = {
    left: 1010 / 1248,
    top: 620 / 704,
    /* 多给一点余量，避免抗锯齿边缘漏出一圈浅色 */
    right: 1,
    bottom: 1
  }

  /**
   * 视频模式。
   *
   * 刻意**不叠任何文字与印章**。实拍素材里奏折摊开后是一张干净的白纸，
   * 那段留白本身就是画面的一部分；往上压"知道了"和御览之宝会立刻露馅——
   * CSS 画的朱红再准，也压不出实拍纸面上的墨色与纤维。
   * 视频版就是纯视频，到点交叉虚化，露出 DSH。
   */
  function buildVideoStage(cfg) {
    var root = el('div', 'ed-root ed-video-mode')
    root.style.setProperty('--ed-speed', String(cfg.speed))

    root.appendChild(el('div', 'ed-desk'))

    var stage = el('div', 'ed-stage ed-vstage')

    var wrap = el('div', 'ed-vwrap')
    var video = document.createElement('video')
    video.className = 'ed-video'
    video.src = resolveVideoSrc(cfg)
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.setAttribute('muted', '')
    video.preload = 'auto'
    wrap.appendChild(video)

    /**
     * 水印遮罩。
     *
     * 关键：视频上有 transform: scale(1.16)，遮罩如果按"原始百分比"放在
     * wrap 上，缩放后就会错位、露出水印。所以遮罩必须放进**同一个被缩放的
     * 坐标系**里——这里把它塞进一个与视频完全同尺寸、同变换的容器，
     * 百分比就仍然按源画面算，缩放自动跟着走。
     */
    var maskLayer = el('div', 'ed-vmask-layer')
    var mask = el('div', 'ed-wm-mask')
    mask.style.left = (WM.left * 100) + '%'
    mask.style.top = (WM.top * 100) + '%'
    mask.style.right = '0'
    mask.style.bottom = '0'
    maskLayer.appendChild(mask)
    wrap.appendChild(maskLayer)

    stage.appendChild(wrap)
    root.appendChild(stage)

    root.appendChild(el('div', 'ed-vignette'))

    if (cfg.allowSkip) {
      var skip = el('button', 'ed-skip', '跳过 ⏎')
      skip.type = 'button'
      skip.addEventListener('click', function (ev) {
        ev.stopPropagation()
        finish()
      })
      root.appendChild(skip)
    }

    root.__edVideo = video
    return root
  }

  /* ── 声音 ───────────────────────────────────────────────────────────────
   *
   * 浏览器有一条硬规则：**没有用户手势，不许出声**（我实测过，报
   * NotAllowedError: play() failed because the user didn't interact...）。
   * 任何网站都绕不过，这不是我们能改的。
   *
   * 所以策略是：
   *   1. 先尝试自动播放（静音失败不算错）——某些环境允许
   *   2. 被拒就挂一个"点击开启声音"的提示，用户一点就补上
   *   3. 用户一旦点过，记在 sessionStorage，本次会话不再提示
   *
   * 音轨有两层：
   *   BGM   —— 宫廷背景乐，随动画开始，循环到片头结束
   *   VOICE —— "上朝"人声，在片头开始 0.6s 处落（钟声之后、奏折摊开之前）
   */
  /**
   * 音轨参数。
   *
   * 人声 = 原始录音原样使用（1.93s，32kHz，未做任何处理）。
   * 前面的版本做了降调、拉伸、混响、低频衬底，结果全是问题——
   * 素材本身就是干净的，最好的处理是不处理。
   *
   * 由于原始电平较低（峰值 0.50，即 -5.9 dBFS），在播放时用 volume=1.0
   * 拉满，而不是靠后期压缩；background 相应压到 0.22。
   *
   * voiceAt = 550ms：素材开头自带 0.3s 静默，所以实际出声在 0.85s 左右，
   * 正好是奏折刚开始摊开的时刻。
   */
  var AUDIO = {
    bgm: '/dsh-edict/bgm.wav',
    voice: '/dsh-edict/voice.wav',
    voiceAt: 550,
    bgmVolume: 0.22,
    voiceVolume: 1.0
  }

  var audioState = { bgm: null, voice: null, unlocked: false, muted: false }
  /* 挂到 window 上，方便自测脚本读取（new Audio() 不进 DOM，否则无从观测） */
  try { window.__edictAudioState = audioState } catch (e) { /* noop */ }

  /** 之前解锁过就不再提示（sessionStorage 跨刷新，但只在本次会话内）。 */
  function audioUnlocked () {
    try { return window.sessionStorage.getItem('dsh-edict-audio') === '1' } catch (e) { return false }
  }
  function markUnlocked () {
    try { window.sessionStorage.setItem('dsh-edict-audio', '1') } catch (e) { /* noop */ }
  }

  function makeAudio (src, volume, loop) {
    var a = document.createElement('audio')
    a.src = src
    a.preload = 'auto'
    a.volume = Math.max(0, Math.min(1, volume))
    a.loop = !!loop
    return a
  }

  /**
   * 起两层音轨。返回一个对象，调用方可据此补播（用户手势后）。
   */
  function startAudio (cfg) {
    if (cfg && cfg.sound === false) return null
    try {
      audioState.bgm = makeAudio(AUDIO.bgm, AUDIO.bgmVolume, true)
      audioState.voice = makeAudio(AUDIO.voice, AUDIO.voiceVolume, false)
    } catch (e) { return null }

    var started = false
    function tryPlay () {
      if (started) return Promise.resolve(true)
      started = true
      var ps = []
      try { ps.push(audioState.bgm.play()) } catch (e) { pscatch(e) }
      /* 人声延后一点落，和钟声错开 */
      window.setTimeout(function () {
        try { audioState.voice.play().catch(function () {}) } catch (e) {}
      }, AUDIO.voiceAt)
      return Promise.all(ps.map(function (p) {
        return p && p.then ? p.then(function () { return true }).catch(function () { return false }) : Promise.resolve(true)
      })).then(function (rs) {
        return !!(rs && rs[0])
      })
    }
    function pscatch (e) { /* noop */ }

    return {
      tryPlay: tryPlay,
      /* 用户手势后补播（此时浏览器会放行） */
      forcePlay: function () {
        try {
          if (audioState.bgm) { audioState.bgm.currentTime = 0; audioState.bgm.play().catch(function () {}) }
          window.setTimeout(function () {
            try { if (audioState.voice) { audioState.voice.currentTime = 0; audioState.voice.play().catch(function () {}) } } catch (e) {}
          }, AUDIO.voiceAt)
        } catch (e) {}
      },
      stop: stopAudio
    }
  }

  function stopAudio () {
    try { if (audioState.bgm) { audioState.bgm.pause(); audioState.bgm = null } } catch (e) {}
    try { if (audioState.voice) { audioState.voice.pause(); audioState.voice = null } } catch (e) {}
  }

  /**
   * "点击开启声音"提示。
   * 只在自动播放被拒且本会话未解锁时出现；点一下画面即可，不影响动画。
   */
  function showAudioHint (onUnlock) {
    if (audioUnlocked()) return null
    var hint = el('button', 'ed-sound-hint', '🔈 点击开启声音')
    hint.type = 'button'
    hint.addEventListener('click', function (ev) {
      ev.stopPropagation()
      ev.preventDefault()
      markUnlocked()
      audioState.unlocked = true
      try { onUnlock() } catch (e) {}
      if (hint.parentNode) hint.parentNode.removeChild(hint)
    })
    return hint
  }

  /* ── 单例：同一时刻只有一个场景 ───────────────────────────────────────── */
  var current = null
  /**
   * 代数令牌。
   *
   * 重播时如果只清掉 current，上一轮的 setTimeout 仍在队列里：它们要么往已经
   * 摘掉的节点上加类（无害），要么在 REVEAL_AT 那一刻调用 teardown() —— 而
   * teardown 摘的是**当时**的 current，也就是刚起来的新一轮。表现出来就是
   * 「重播后动画放一半自己没了」。用令牌让旧定时器发现"我不再是当前这一轮"
   * 就闭嘴。
   */
  var generation = 0

  /** 摘掉某一轮的节点。只认自己那一轮，避免误伤新一轮。 */
  function teardown(node) {
    if (current === null) return
    if (node !== undefined && node !== current) return
    var victim = current
    current = null
    if (victim && victim.parentNode) victim.parentNode.removeChild(victim)
    document.removeEventListener('keydown', onKey, true)
  }

  function onKey(ev) {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      ev.preventDefault()
      finish()
    }
  }

  /** 立刻结束：走完交叉虚化，然后卸载。重复调用无害。 */
  function finish() {
    if (current === null) return
    var node = current
    var gen = generation
    var speed = parseFloat(node.style.getPropertyValue('--ed-speed')) || 1
    /* 跳过 = 作废本轮后续阶段，否则它们会在虚化之后又把类加回去 */
    generation++
    node.classList.add('ed-reveal')
    window.setTimeout(function () {
      if (generation !== gen + 1 && generation !== gen) return
      teardown(node)
    }, (REVEAL_MS + REVEAL_HOLD) / speed)
  }

  /**
   * 播放。
   * @param {object} [options]
   * @param {object} [options.config]  覆盖配置（预览页与自测用）
   * @param {number} [options.phase]   只定格到第 N 个阶段（0 起），不再推进
   * @param {boolean} [options.static] 定格模式：不播放，直接呈现该阶段终态
   * @param {function} [options.onDone] 卸载后回调
   */
  function play(options) {
    var opts = options || {}
    var cfg = readConfig()
    if (opts.config) {
      var k
      for (k in opts.config) cfg[k] = opts.config[k]
    }
    if (cfg.enabled === false && !opts.config) return null

    /* 新一轮：先作废旧定时器（它们会在原 timing 点醒来并检查代数），再摘节点 */
    var gen = ++generation
    if (current !== null) teardown()

    ensureStyle()

    /**
     * 两种片头：
     *   cfg.video === true  → 实拍奏折视频（推荐，质感最好）
     *   否则                 → 纯 CSS 演绎（无素材也能用，是兜底）
     * 视频加载失败时自动落回 CSS，绝不留一片黑屏。
     */
    var useVideo = cfg.video === true

    if (useVideo) {
      var vroot = buildVideoStage(cfg)
      document.body.appendChild(vroot)
      current = vroot

      if (cfg.allowSkip) document.addEventListener('keydown', onKey, true)

      var video = vroot.__edVideo
      var fallenBack = false

      function fallbackToCss () {
        if (fallenBack || generation !== gen) return
        fallenBack = true
        /* 视频这条线彻底失败：换成 CSS 版，从第一拍开始 */
        if (vroot.parentNode) vroot.parentNode.removeChild(vroot)
        current = null
        generation++
        play({ config: opts.config, static: opts.static, phase: opts.phase, onDone: opts.onDone })
      }

      /* 视频本身出错 / 迟迟不出画面 → 落回 CSS */
      video.addEventListener('error', fallbackToCss)
      var watchdog = window.setTimeout(function () {
        if (generation === gen && video.readyState < 2) fallbackToCss()
      }, 8000)

      var readyFired = false
      function fireReady () {
        if (readyFired) return
        readyFired = true
        if (typeof opts.onReady === 'function') {
          try { opts.onReady() } catch (e) { /* noop */ }
        }
      }

      var audio = startAudio(cfg)
      var audioHintShown = false

      video.addEventListener('playing', function () {
        window.clearTimeout(watchdog)
        vroot.classList.add('ed-ready')
        fireReady()

        /* 视频（静音）一定播得起来；声音要单独试。
           试失败就挂提示，等用户点一下。 */
        if (audio && !audioHintShown) {
          audioHintShown = true
          audio.tryPlay().then(function (ok) {
            if (ok) { markUnlocked(); return }
            if (audioUnlocked()) { audio.forcePlay(); return }
            var hint = showAudioHint(function () { audio.forcePlay() })
            if (hint && current === vroot) vroot.appendChild(hint)
          })
        }
      })

      /* 已经缓冲到可以出画面（首帧已解码）时也提前放行 */
      video.addEventListener('loadeddata', function () {
        if (video.readyState >= 2) fireReady()
      })

      /**
       * 收尾：不等视频播完，在**最后一段**里就开始交叉虚化。
       *
       * 等到 'ended' 才动，观感是"片子放完了、然后切场景"——中间有一拍静止，
       * 节奏断掉。提前 REVEAL_LEAD 起手，视频还在摊开的尾声里就已经在化开，
       * 化开的地方露出来的直接是 DSH 主界面：顺序就变成"打开奏折 → 里面就是办公的地方"。
       *
       * 'ended' 仍然留着兜底：某些情况下 timeupdate 不触发（例如后台标签页
       * 被节流），到点还是要收尾，不能卡在最后一帧不动。
       */
      var revealStarted = false
      function startReveal () {
        if (revealStarted || generation !== gen) return
        revealStarted = true
        window.clearTimeout(watchdog)
        /* 渐出的同时把声音一起收掉，避免画面没了还在响 */
        stopAudio()
        vroot.classList.add('ed-reveal')
        window.setTimeout(function () {
          if (generation !== gen) return
          teardown(vroot)
          if (typeof opts.onDone === 'function') opts.onDone(vroot)
        }, (REVEAL_MS + REVEAL_HOLD) / cfg.speed)
      }

      /* 用 timeupdate 判断"进入尾声"，比 setInterval 更贴合真实播放进度
         （卡顿、掉帧时不会提前走完）。 */
      video.addEventListener('timeupdate', function () {
        if (revealStarted) return
        var d = video.duration
        if (!d || !isFinite(d)) return
        /* video.duration / currentTime 的单位是**秒**，REVEAL_LEAD 是毫秒——
           这里必须先除 1000，否则 "5.77 <= 1500" 恒成立，视频刚开始就收尾了。
           这个单位混用我踩过一次，表现是"片子刚起就化没了"。 */
        var left = d - video.currentTime
        var lead = REVEAL_LEAD / 1000 / cfg.speed
        if (left <= lead) startReveal()
      })

      video.addEventListener('ended', startReveal)

      /* 自动播放被拒（浏览器策略）：静音通常能过，万一不行就落回 CSS */
      var p2 = video.play()
      if (p2 && typeof p2.catch === 'function') {
        p2.catch(function () { fallbackToCss() })
      }
      return vroot
    }

    var root = build(cfg)
    document.body.appendChild(root)
    current = root

    if (cfg.allowSkip) document.addEventListener('keydown', onKey, true)

    /* 定格模式：把该阶段及之前的类一次性加满，不做过渡 */
    if (opts.static === true) {
      root.classList.add('ed-static')
      var upto = typeof opts.phase === 'number' ? opts.phase : PHASES.length - 1
      if (upto > PHASES.length - 1) upto = PHASES.length - 1
      for (var i = 0; i <= upto && i < PHASES.length; i++) root.classList.add(PHASES[i].cls)
      root.classList.add('ed-ready')
      if (typeof opts.onReady === 'function') {
        try { opts.onReady() } catch (e) { /* noop */ }
      }
      if (typeof opts.onDone === 'function') opts.onDone(root)
      return root
    }

    /* 正常播放：等一帧再亮起，避免和 index.html 首屏绘制抢同一帧 */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.add('ed-ready')
        if (typeof opts.onReady === 'function') {
          try { opts.onReady() } catch (e) { /* noop */ }
        }
      })
    })

    /* CSS 版同样带声音 */
    var cssAudio = startAudio(cfg)
    if (cssAudio) {
      cssAudio.tryPlay().then(function (ok) {
        if (ok) { markUnlocked(); return }
        if (audioUnlocked()) { cssAudio.forcePlay(); return }
        var hint = showAudioHint(function () { cssAudio.forcePlay() })
        if (hint && current === root) root.appendChild(hint)
      })
    }

    var speed = cfg.speed
    var timers = []
    /** 只有本轮仍是最新的一轮、且节点还在，才允许动 DOM。 */
    function live() { return generation === gen && current === root }

    PHASES.forEach(function (phase) {
      timers.push(window.setTimeout(function () {
        if (!live()) return
        root.classList.add(phase.cls)
      }, phase.at / speed))
    })

    /* 揭幕是单独一步：先整幕淡出、虚化，等它走完再卸载 */
    timers.push(window.setTimeout(function () {
      if (!live()) return
      stopAudio()
      root.classList.add('ed-reveal')
      timers.push(window.setTimeout(function () {
        if (!live()) return
        teardown(root)
        if (typeof opts.onDone === 'function') opts.onDone(root)
      }, (REVEAL_MS + REVEAL_HOLD) / speed))
    }, REVEAL_AT / speed))

    root.__edTimers = timers
    return root
  }

  /** 保证 <style> 在：宿主注入的 index.html 已经带了一份，预览页要自己拉。 */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID) !== null) return
    var link = document.createElement('link')
    link.id = STYLE_ID
    link.rel = 'stylesheet'
    link.href = CSS_URL
    /* 拿不到就静默失败：一个装饰性插件不该在控制台里吵 */
    link.onerror = function () { link.parentNode && link.parentNode.removeChild(link) }
    document.head.appendChild(link)
  }

  window.DshEdictBoot = {
    play: play,
    finish: finish,
    isPlaying: function () { return current !== null },
    defaults: DEFAULTS,
    phases: PHASES,
    revealAt: REVEAL_AT
  }
})()