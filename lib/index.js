/**
 * dsh-edict-boot — Host 半侧
 * ----------------------------------------------------------------------------
 * 三件事，别的一概不做：
 *   1. 四个路由：/dsh-edict/css · /dsh-edict/scene.js · /dsh-edict/config · /dsh-edict/preview
 *   2. webServer.tapIndex：把首屏浮层塞进 index.html
 *   3. 配置落盘到 $DSH_HOME/edict-boot.json（设置面板经 /config 读写）
 *
 * 为什么用 tapIndex 而不是只挂 shell.overlay 槽位：
 *   shell.overlay 要等 React 起来才渲染，那时候 DSH 主界面已经画出来了，
 *   片头会「后盖」上去——看起来是弹窗，不像开机。注入 index.html 则是：
 *   页面还在白屏时浮层就已经在那儿了，随后 DSH 才在它底下长出来。
 *   这也是 dsh-startup-screen 的同一套做法（已在桌面端验证过）。
 *
 * 失败姿态：任何一个环节出问题都只让「动画不播」，绝不让 DSH 起不来。
 * 没有 webServer（Electron 走 file:// + IPC 的形态）时，插件照样 APPLIED，
 * 只是什么都不注入——装饰性插件没有资格拖垮宿主。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NS = 'dsh-edict-boot'
const ROUTE_BASE = '/dsh-edict'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'edict-boot.json')

const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const v = String(pkg.version || '').trim()
    return v || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

/** 与 lib/scene.js 的 DEFAULTS 一一对应。 */
const DEFAULTS = {
  enabled: true,
  /** 用实拍奏折视频（lib/media/memorial.mp4）。关掉则回落到纯 CSS 演绎。 */
  video: true,
  speed: 1,
  allowSkip: true,
  coverLabel: '奏　摺',
  edictText: '知道了',
  sealText: '御覽之寶'
}

const TEXT_KEYS = ['coverLabel', 'edictText', 'sealText']
const ENUMS = {}
const BOOL_KEYS = ['enabled', 'allowSkip', 'video']
const MAX_SEAL_CHARS = 4

function normalize (input) {
  const out = { ...DEFAULTS }
  const src = input && typeof input === 'object' ? input : {}
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in src) || src[key] === undefined || src[key] === null) continue
    const value = src[key]
    if (BOOL_KEYS.includes(key)) {
      out[key] = value === true || value === 'true' || value === 1 || value === '1'
    } else if (ENUMS[key]) {
      out[key] = ENUMS[key].includes(value) ? value : DEFAULTS[key]
    } else if (key === 'speed') {
      const n = Number(value)
      out[key] = Number.isFinite(n) ? Math.min(3, Math.max(0.25, n)) : DEFAULTS.speed
    } else if (key === 'sealText') {
      /* 印章是 2x2 的四格，多于四字没地方放 */
      out[key] = String(value).replace(/\s+/g, '').slice(0, MAX_SEAL_CHARS) || DEFAULTS[key]
    } else if (TEXT_KEYS.includes(key)) {
      out[key] = String(value).slice(0, 64)
    }
  }
  return out
}

function readConfig () {
  try {
    return normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch {
    /* 文件不存在 / 坏了 / 没权限：都用默认值，绝不让它变成启动失败 */
    return { ...DEFAULTS }
  }
}

function writeConfig (next) {
  const normalized = normalize(next)
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    /* 先写临时文件再 rename：写一半断电也不会留下半个 JSON */
    const tmp = CONFIG_FILE + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8')
    fs.renameSync(tmp, CONFIG_FILE)
  } catch (err) {
    throw new Error('无法写入 ' + CONFIG_FILE + '：' + ((err && err.message) || err))
  }
  return normalized
}true

/* ── 资源：读一次、缓在内存里；文件按 mtime 失效，改完不用重启 ────────── */

const cache = new Map()

function readAsset (name, mime) {
  /* name 可以带子目录（如 media/memorial.mp4），但绝不能逃出 lib/ */
  const safe = name.replace(/\\/g, '/')
  if (safe.includes('..') || safe.startsWith('/')) return null
  const file = path.join(PACKAGE_ROOT, 'lib', safe)
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  const hit = cache.get(name)
  if (hit && hit.mtime === stat.mtimeMs) return hit

  const body = fs.readFileSync(file)
  const entry = { body, mime, mtime: stat.mtimeMs }
  cache.set(name, entry)
  return entry
}

/* ── 首屏注入的载荷 ───────────────────────────────────────────────────── */

/** JSON 进 <script> 必须转义 `<`，否则文案里一个 </script> 就能截断文档。 */
function safeJson (value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * 首屏兜底：片头还没亮起的那几十毫秒里页面不该是白的。
 * 这段 CSS 只做一件事——把 html 背景压成御案的深棕。
 */
/**
 * 首屏兜底。
 *
 * 光把 html 背景压成深棕不够：DSH 的 React 一挂载就会把整个界面画出来，
 * 而我们的视频还在下载/解码，于是观感是「先闪一下主界面，再弹出动画」。
 *
 * 这段 CSS 直接给占位节点铺一层不透明底色、盖住视口，等场景真正出画面后
 * 由 scene.js 把 #dsh-edict-root 移除。用内联 + !important 是因为它要在
 * 任何外部样式表到达之前就生效。
 */
const CRITICAL_CSS = [
  'html{background:#120d08}',
  'html.dsh-edict-lock,html.dsh-edict-lock body{overflow:hidden!important}',
  /* 占位遮罩：HTML 里那个空 div 一落地就是满屏深棕 */
  '#dsh-edict-root{position:fixed!important;inset:0!important;z-index:2147483000!important;',
  'background:#120d08!important;margin:0!important;padding:0!important}'
].join('')

/** 极小的启动器：等 scene.js 到位就播；scene.js 挂了就什么都不发生。 */
const BOOTSTRAP_JS = [
  '(function(){',
  '  var t=0;',
  '  function go(){',
  '    if(window.DshEdictBoot){try{window.DshEdictBoot.play()}catch(e){}return}',
  '    if(t++<160)setTimeout(go,16)',
  '  }',
  '  function start(){go()}',
  '  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});',
  '  else start();',
  '})();'
].join('\n')

/**
 * 把载荷塞进 index.html。
 * 已经注入过就原样返回（tapIndex 可能被多次调用，重复注入会播两遍）。
 */
function injectIntoIndex (html, config) {
  if (!html || html.includes(ROUTE_BASE + '/scene.js')) return html

  const payload = { ...config, version: PLUGIN_VERSION }
  const head =
    '<link rel="stylesheet" href="' + ROUTE_BASE + '/css">' +
    '<style id="dsh-edict-critical">' + CRITICAL_CSS + '</style>'

  const body =
    '<div id="dsh-edict-root" data-dsh-edict="' + ROUTE_BASE + '"></div>' +
    /*
     * __DSH_EDICT_BOOT__ = 'index' 是"Host 已经注入过"的握手指记。
     * 桌面端 webview 走 dsh-app:// 协议、不经过 tapIndex，这个标记就不存在，
     * 于是 client.js 的 bootSelf() 会自己拉场景起来 —— 两条路互斥，绝不播两遍。
     */
    '<script>window.__DSH_EDICT_BOOT__="index";window.__DSH_EDICT__=' +
      safeJson(payload) + ';' + BOOTSTRAP_JS + '</script>' +
    '<script defer src="' + ROUTE_BASE + '/scene.js"></script>'

  let out = html
  if (out.includes('</head>')) out = out.replace('</head>', head + '</head>')
  else out = head + out

  if (out.includes('<body>')) out = out.replace('<body>', '<body>' + body)
  else if (out.includes('</body>')) out = out.replace('</body>', body + '</body>')
  else out = out + body

  return out
}

/* ── 接线 ─────────────────────────────────────────────────────────────── */

export const name = NS
/**
 * 只要 webServer。桌面端如果改用 file:// + IPC 下发前端，这里就什么都注册不了，
 * 插件仍然 APPLIED——这是刻意的，见文件头。
 */
export const inject = ['webServer']

function resolveWebServer (ctx) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (viaGet) return viaGet
  } catch { /* 取不到就当没有 */ }
  return ctx.webServer
}

function hasRoutes (server) {
  return !!server && typeof server.register === 'function'
}

export function apply (ctx) {
  const webServer = resolveWebServer(ctx)

  if (!hasRoutes(webServer)) {
    try {
      ctx.logger?.warn?.(
        '[' + NS + '] 当前 profile 没有可用的 webServer，Host 半侧跳过路由与首屏注入。'
      )
    } catch { /* 日志失败不影响加载 */ }
    return
  }

  const disposers = []

  function sendText (res, status, type, text) {
    const body = Buffer.from(text, 'utf8')
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    })
    res.end(body)
  }

  function sendJson (res, status, payload) {
    sendText(res, status, 'application/json; charset=utf-8', JSON.stringify(payload))
  }

  function readBody (req, limit = 64 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          req.destroy()
          resolve('')
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  /**
   * 视频：Range + ETag。
   *
   * 返回 206 时 Content-Range 必须准确，否则 Safari/部分 Chromium 会直接
   * 放弃这个源；返回 200 时也要带 Accept-Ranges，否则浏览器不会再来第二次。
   */
  function serveVideo (req, res, name, mime) {
    const type = mime || 'video/mp4'
    const asset = readAsset(name, type)
    if (asset === null) {
      sendText(res, 404, 'text/plain; charset=utf-8', NS + ': missing lib/media/' + name)
      return
    }
    const body = asset.body
    const total = body.length
    const etag = '"' + asset.mtime.toString(36) + '-' + total.toString(36) + '"'

    if (req.headers && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'no-cache' })
      res.end()
      return
    }

    const range = req.headers && req.headers.range
    const base = {
      'content-type': type,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
      etag
    }

    if (typeof range === 'string') {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (m) {
        let start = m[1] === '' ? null : Number(m[1])
        let end = m[2] === '' ? null : Number(m[2])
        if (start === null && end !== null) {
          /* bytes=-N：最后 N 个字节 */
          start = Math.max(0, total - end)
          end = total - 1
        } else {
          if (start === null) start = 0
          if (end === null || end >= total) end = total - 1
        }
        if (start > end || start >= total) {
          res.writeHead(416, { ...base, 'content-range': 'bytes */' + total })
          res.end()
          return
        }
        const chunk = body.subarray(start, end + 1)
        res.writeHead(206, {
          ...base,
          'content-range': 'bytes ' + start + '-' + end + '/' + total,
          'content-length': String(chunk.length)
        })
        res.end(chunk)
        return
      }
    }

    res.writeHead(200, { ...base, 'content-length': String(total) })
    res.end(body)
  }

  /** 静态资源：命中就发，读不到就 404（不是 500：文件缺失不是服务器故障）。 */
  function serveAsset (res, name, mime) {
    const asset = readAsset(name, mime)
    if (asset === null) {
      sendText(res, 404, 'text/plain; charset=utf-8', NS + ': missing lib/' + name)
      return
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      'Content-Length': String(asset.body.length)
    })
    res.end(asset.body)
  }

  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/css',
    handler: (req, res) => serveAsset(res, 'scene.css', 'text/css; charset=utf-8')
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/scene.js',
    handler: (req, res) => serveAsset(res, 'scene.js', 'application/javascript; charset=utf-8')
  }))

  /**
   * 片头视频。放在 lib/media/ 下，跟插件一起走。
   *
   * 必须支持 Range：浏览器对 <video> 一律先发 Range 请求，只回 200 全量
   * 会让部分播放器拒绝播放（表现为黑屏或"点了才有画面"）。
   * 也不能用 no-store：那样每次开片头都要重下 6.8MB，加载期就是黑的。
   * 这里用 no-cache + ETag —— 没换片就是 304，本地副本秒开。
   */
  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/memorial.mp4',
    handler: (req, res) => serveVideo(req, res, 'media/memorial.mp4')
  }))

  /*
   * 音频。两段都是随包分发的合成素材：
   *   edict-voice.wav  「上朝」人声（系统 TTS 合成 + 大殿混响）
   *   edict-bgm.wav    宫廷背景乐（五声音阶 + 编钟泛音，纯 numpy 合成）
   *
   * 同样走 serveVideo：音频也需要 Range（浏览器会发），
   * 复用同一套 206/ETag 逻辑，少一份实现就少一处能出错的地方。
   */
  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/voice.wav',
    handler: (req, res) => serveVideo(req, res, 'media/edict-voice.wav', 'audio/wav')
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/bgm.wav',
    handler: (req, res) => serveVideo(req, res, 'media/edict-bgm.wav', 'audio/wav')
  }))

  /**
   * 预览页。它同时要能在两种形态下工作：
   *   - file:// 直接打开（截图/逐帧核对靠这个）：页内相对路径 ./scene.*
   *   - 走本路由（/dsh-edict/preview）：相对路径会解析成 /dsh-edict/scene.*，
   *     而样式路由叫 /css 不叫 /scene.css —— 所以这里把两处引用改写成绝对路径。
   * 不改就等于「从设置页点预览是没样式的白板」，这坑我踩过。
   */
  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/preview',
    handler: (req, res) => {
      const asset = readAsset('preview.html', 'text/html; charset=utf-8')
      if (asset === null) {
        sendText(res, 404, 'text/plain; charset=utf-8', NS + ': missing lib/preview.html')
        return
      }
      const html = asset.body.toString('utf8')
        .replace(/\.\/scene\.css/g, ROUTE_BASE + '/css')
        .replace(/\.\/scene\.js/g, ROUTE_BASE + '/scene.js')
      sendText(res, 200, 'text/html; charset=utf-8', html)
    }
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/config',
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          version: PLUGIN_VERSION,
          config: readConfig(),
          defaults: DEFAULTS,
          file: CONFIG_FILE
        })
        return
      }
      if (method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const text = await readBody(req)
      let payload
      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      try {
        if (payload && payload.action === 'reset') {
          const now = writeConfig(DEFAULTS)
          sendJson(res, 200, { ok: true, version: PLUGIN_VERSION, config: now, defaults: DEFAULTS })
          return
        }
        const current = readConfig()
        const patch = payload && typeof payload.patch === 'object' && payload.patch ? payload.patch : payload
        const now = writeConfig({ ...current, ...patch })
        sendJson(res, 200, { ok: true, version: PLUGIN_VERSION, config: now, defaults: DEFAULTS })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    }
  }))

  /* 首屏注入：这是整个插件的关键一步 */
  if (typeof webServer.tapIndex === 'function') {
    disposers.push(webServer.tapIndex((html) => {
      try {
        const config = readConfig()
        /* 关掉时一行都不注入：连 CSS 和脚本都不该出现在文档里 */
        if (config.enabled === false) return html
        return injectIntoIndex(html, config)
      } catch {
        /* 注入失败就是没有动画，绝不把宿主带崩 */
        return html
      }
    }))
  }

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch { /* noop */ }
    }
  })
}