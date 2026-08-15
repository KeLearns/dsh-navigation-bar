// cdp-check.mjs v2 — robust real-GUI probe with network resource evidence.
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9224
const URL_APP = 'http://127.0.0.1:3080/'
const TMP_PROFILE = join(process.env.TEMP || '.', 'dspn-cdp-profile2')

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
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
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
  await send('Network.enable', {})
  await send('Page.navigate', { url: URL_APP })

  let booted = false
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const v = await evalJs("window.__DSH_BOOT__ ? 'yes' : 'no'")
    if (v === 'yes') { booted = true; break }
  }
  await sleep(8000)

  const stateExpr = [
    "(function(){ try {",
    "var nav = ((window.__DSH_BOOT__||{}).entries||[]).find(function(e){return e.id.indexOf('navigation-bar')!==-1});",
    "var res = performance.getEntriesByType('resource').map(function(e){return e.name}).filter(function(n){return n.indexOf('dsh-navigation-bar')!==-1});",
    "return JSON.stringify({",
    " href: location.href,",
    " title: document.title.slice(0,80),",
    " boot: !!window.__DSH_BOOT__,",
    " entries: (window.__DSH_BOOT__&&window.__DSH_BOOT__.entries) ? window.__DSH_BOOT__.entries.length : -1,",
    " navRev: nav ? nav.rev : null,",
    " debugHook: typeof window.__dspnNavDebug__,",
    " rootCount: document.querySelectorAll('.dspn-root').length,",
    " keyCount: document.querySelectorAll('.dspn-key').length,",
    " scrollports: document.querySelectorAll('[data-conversation-scroll]').length,",
    " anchorRows: document.querySelectorAll('[data-chat-anchor-key]').length,",
    " bundleFetched: res.length > 0 ? res[0] : null,",
    " bodyText: (document.body ? document.body.innerText.slice(0,120).replace(/\\n/g,' | ') : 'nobody')",
    "});",
    "} catch (e) { return 'EVAL_ERR:' + String(e && e.message || e); } })()",
  ].join('')
  const state = await evalJs(stateExpr)

  const consoleMsgs = events
    .filter((e) => e.method === 'Runtime.consoleAPICalled')
    .map((e) => ({ type: e.params.type, text: (e.params.args || []).map((a) => (a.value !== undefined ? a.value : (a.description || ''))).join(' ').slice(0, 240) }))
    .filter((m) => m.text.includes('dsh-navigation') || m.type === 'error')
  const exceptions = events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => String((e.params && e.params.exceptionDetails && e.params.exceptionDetails.text) || 'exception').slice(0, 200))
  const navReq = events
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => e.params.request.url)
    .filter((u) => u.includes('dsh-navigation-bar'))
  const navResp = events
    .filter((e) => e.method === 'Network.responseReceived')
    .map((e) => ({ url: e.params.response.url, status: e.params.response.status }))
    .filter((x) => x.url.includes('dsh-navigation-bar'))

  console.log('BOOTED=' + booted)
  console.log('STATE=' + state)
  console.log('CONSOLE=' + JSON.stringify(consoleMsgs))
  console.log('EXCEPTIONS=' + JSON.stringify(exceptions))
  console.log('NETWORK_REQ=' + JSON.stringify(navReq))
  console.log('NETWORK_RESP=' + JSON.stringify(navResp))
} catch (e) {
  console.log('CDP_ERROR ' + (e && e.message ? e.message : String(e)))
} finally {
  try { ws && ws.close() } catch (e) {}
  try { child.kill() } catch (e) {}
  process.exit(0)
}
