// cdp-send-test.mjs — in the real GUI, send one message and verify the bar mounts.
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9225
const URL_APP = 'http://127.0.0.1:3080/'
const TMP_PROFILE = join(process.env.TEMP || '.', 'dspn-cdp-profile3')

if (existsSync(TMP_PROFILE)) { try { rmSync(TMP_PROFILE, { recursive: true, force: true }) } catch (e) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function httpJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

let child
try {
  child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + TMP_PROFILE,
    '--remote-debugging-port=' + PORT,
    '--remote-allow-origins=*',
    'about:blank',
  ], { stdio: 'ignore' })
} catch (e) { console.log('SPAWN_EDGE_FAIL ' + e.message); process.exit(2) }

let ws = null
let msgId = 0
const pending = new Map()
const events = []
function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r && r.result && r.result.type === 'string') return r.result.value
  if (r && r.result && r.result.value !== undefined) return JSON.stringify(r.result.value)
  return null
}

try {
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500)
    try {
      const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list')
      target = list.find((t) => t.type === 'page')
    } catch (e) { /* retry */ }
  }
  if (!target) { console.log('NO_CDP_TARGET'); process.exit(3) }
  if (typeof WebSocket !== 'function') { console.log('NO_NATIVE_WEBSOCKET'); process.exit(4) }

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    } else if (msg.method) events.push(msg)
  }

  await send('Runtime.enable', {})
  await send('Page.enable', {})
  await send('Page.navigate', { url: URL_APP })

  let booted = false
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const v = await evalJs("window.__DSH_BOOT__ ? 'yes' : 'no'")
    if (v === 'yes') { booted = true; break }
  }
  await sleep(6000)
  console.log('BOOTED=' + booted)

  // 1) find the composer textarea and send a short message via native setter + Enter
  const sendResult = await evalJs([
    "(function(){ try {",
    "  var ta = document.querySelector('textarea[data-phase]');",
    "  if (!ta) return 'NO_TEXTAREA';",
    "  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;",
    "  setter.call(ta, 'pong');",
    "  ta.dispatchEvent(new Event('input', { bubbles: true }));",
    "  var ok = ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));",
    "  return 'SENT defaultPrevented=' + !ok;",
    "} catch (e) { return 'SEND_ERR:' + String(e && e.message || e); } })()",
  ].join(''))
  console.log('SEND=' + sendResult)

  // 2) poll for message rows + piano bar
  const timeline = []
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const v = await evalJs([
      "JSON.stringify({",
      " rows: document.querySelectorAll('[data-chat-anchor-key]').length,",
      " roots: document.querySelectorAll('.dspn-root').length,",
      " keys: document.querySelectorAll('.dspn-key').length,",
      " tips: document.querySelectorAll('.dspn-tip').length,",
      " phase: (document.querySelector('textarea[data-phase]')||{}).getAttribute ? document.querySelector('textarea[data-phase]').getAttribute('data-phase') : null",
      "})",
    ].join(''))
    if (v) {
      const parsed = JSON.parse(v)
      timeline.push(parsed)
      if (parsed.keys > 0) break
    }
  }
  console.log('TIMELINE=' + JSON.stringify(timeline))

  const consoleMsgs = events
    .filter((e) => e.method === 'Runtime.consoleAPICalled')
    .map((e) => ({ type: e.params.type, text: (e.params.args || []).map((a) => (a.value !== undefined ? a.value : (a.description || ''))).join(' ').slice(0, 240) }))
    .filter((m) => m.text.includes('dsh-navigation') || m.type === 'error')
  console.log('CONSOLE=' + JSON.stringify(consoleMsgs))
  const exceptions = events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => String((e.params && e.params.exceptionDetails && e.params.exceptionDetails.text) || 'exception').slice(0, 200))
  console.log('EXCEPTIONS=' + JSON.stringify(exceptions))
} catch (e) {
  console.log('CDP_ERROR ' + (e && e.message ? e.message : String(e)))
} finally {
  try { ws && ws.close() } catch (e) {}
  try { child.kill() } catch (e) {}
  process.exit(0)
}
