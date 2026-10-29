/**
 * Host 半侧自测：用假的 webServer 驱动真实的 lib/index.js。
 * 断言路由、Range/ETag、配置读写、首屏注入。
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const PKG = path.resolve(HERE, '..')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'edict-home-'))
process.env.DSH_HOME = path.join(sandbox, '.dsh')

const mod = await import(pathToFileURL(path.join(PKG, 'lib', 'index.js')).href)
const routes = []; const taps = []
const fake = { register: (r) => { routes.push(r); return () => {} }, tapIndex: (f) => { taps.push(f); return () => {} } }

let fail = 0
const check = (n, ok, ex) => { if (ok) console.log('  ok   ' + n); else { fail++; console.log('  FAIL ' + n + (ex ? ' :: ' + ex : '')) } }

console.log('name=' + mod.name + '  inject=' + JSON.stringify(mod.inject))
check('导出 apply', typeof mod.apply === 'function')
check('inject 只有 webServer', JSON.stringify(mod.inject) === '["webServer"]')

mod.apply({ webServer: fake, get: () => fake, effect: (fn) => fn(), logger: { warn() {} } })

check('注册 7 条路由', routes.length === 7, 'got ' + routes.length)
const byPath = Object.fromEntries(routes.map((r) => [r.path, r]))
for (const p of [
  '/dsh-edict/css', '/dsh-edict/scene.js', '/dsh-edict/preview', '/dsh-edict/config',
  '/dsh-edict/memorial.mp4', '/dsh-edict/voice.wav', '/dsh-edict/bgm.wav',
]) {
  check(p, !!byPath[p])
}
check('tapIndex 已挂', taps.length === 1)

function res() {
  return { status: 0, headers: {}, body: null,
    writeHead(s, h) { this.status = s; this.headers = h || {} },
    end(b) { this.body = b || Buffer.alloc(0) } }
}

const r1 = res()
await byPath['/dsh-edict/memorial.mp4'].handler({ method: 'GET', headers: {} }, r1)
check('视频 200', r1.status === 200, String(r1.status))
check('accept-ranges', r1.headers['accept-ranges'] === 'bytes')
check('带 etag', typeof r1.headers['etag'] === 'string')
const total = r1.body.length
check('体积 > 6MB', total > 6000000, String(total))

const r2 = res()
await byPath['/dsh-edict/memorial.mp4'].handler({ method: 'GET', headers: { range: 'bytes=0-1023' } }, r2)
check('Range 206', r2.status === 206, String(r2.status))
check('Range 长度 1024', r2.body.length === 1024, String(r2.body.length))
check('Content-Range 正确', r2.headers['content-range'] === 'bytes 0-1023/' + total, r2.headers['content-range'])

const r3 = res()
await byPath['/dsh-edict/memorial.mp4'].handler({ method: 'GET', headers: { range: 'bytes=-500' } }, r3)
check('尾部 Range 206', r3.status === 206)
check('尾部 500 字节', r3.body.length === 500, String(r3.body.length))

const r4 = res()
await byPath['/dsh-edict/memorial.mp4'].handler({ method: 'GET', headers: { 'if-none-match': r1.headers['etag'] } }, r4)
check('ETag 命中 304', r4.status === 304, String(r4.status))

const r5 = res()
await byPath['/dsh-edict/memorial.mp4'].handler({ method: 'GET', headers: { range: 'bytes=99999999-' } }, r5)
check('越界 416', r5.status === 416, String(r5.status))

const r6 = res()
await byPath['/dsh-edict/css'].handler({ method: 'GET', headers: {} }, r6)
check('css 可读', r6.status === 200)

const r7 = res()
await byPath['/dsh-edict/config'].handler({ method: 'GET', headers: {} }, r7)
const payload = JSON.parse(r7.body.toString('utf8'))
check('config enabled 默认开', payload.config.enabled === true)
check('config video 默认开', payload.config.video === true)
check('config 无 columns', payload.config.columns === undefined)
check('config 有朱批/印文', typeof payload.config.edictText === 'string' && typeof payload.config.sealText === 'string')

/* 音频路由：确认随包分发的 wav 能正常出流 */
for (const [p, mime] of [['/dsh-edict/voice.wav', 'audio/'], ['/dsh-edict/bgm.wav', 'audio/']]) {
  const ra = res()
  await byPath[p].handler({ method: 'GET', headers: {} }, ra)
  check(p + ' 200', ra.status === 200, String(ra.status))
  check(p + ' 音频类型', (ra.headers['content-type'] || '').startsWith(mime), ra.headers['content-type'])
  const b = ra.body
  check(p + ' 是 RIFF/WAVE', b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WAVE')
}

const base = '<!doctype html><html><head><title>x</title></head><body><div id="app"></div></body></html>'
const out = taps[0](base)
check('注入 scene.js', out.includes('/dsh-edict/scene.js'))
check('注入 css', out.includes('/dsh-edict/css'))
check('注入载荷', out.includes('window.__DSH_EDICT__='))
check('载荷含 video=true', out.includes('"video":true'))
check('只注入一次', taps[0](out) === out)
check('保留原文档', out.includes('<div id="app"></div>'))

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILURES'))
fs.rmSync(sandbox, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)