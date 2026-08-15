// cdp-open-session.mjs — open a real conversation in the live GUI and verify the bar.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9227
const URL_APP = 'http://127.0.0.1:3080/'
const TMP_PROFILE = join(process.env.TEMP || '.', 'dspn-cdp-profile5')
const TASKKILL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')

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
function killTree(pid) {
  try { execFileSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch (e) {}
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
  await sleep(8000)
  console.log('BOOTED=' + booted)

  const lsKeys = await evalJs("JSON.stringify(Object.keys(localStorage || {}))")
  console.log('LS_KEYS=' + lsKeys)

  // sidebar clickable inventory
  const sidebarInfo = await evalJs([
    "(function(){ try {",
    " var col = document.querySelector('[class*=\"sidebarCol\"]');",
    " if (!col) return 'NO_SIDEBAR_COL';",
    " var els = col.querySelectorAll('button, [role=\"button\"], a');",
    " var out = [];",
    " for (var i = 0; i < Math.min(els.length, 40); i++) {",
    "   var e = els[i];",
    "   out.push({ t: (e.textContent || '').trim().slice(0, 40), c: String(e.className).slice(0, 60), tag: e.tagName });",
    " }",
    " return JSON.stringify(out);",
    "} catch (e) { return 'ERR:' + String(e && e.message || e); } })()",
  ].join(''))
  console.log('SIDEBAR=' + sidebarInfo)

  // try clicking candidates until message rows appear
  let opened = false
  const clickAttempts = await evalJs([
    "(function(){",
    " var col = document.querySelector('[class*=\"sidebarCol\"]');",
    " if (!col) return 'NO_COL';",
    " var els = col.querySelectorAll('button, [role=\"button\"]');",
    " var picked = [];",
    " for (var i = 0; i < els.length && picked.length < 6; i++) {",
    "   var t = (els[i].textContent || '').trim();",
    "   if (t && t.length > 1) picked.push(i);",
    " }",
    " window.__PICKED__ = picked;",
    " return JSON.stringify(picked);",
    "})()",
  ].join(''))
  console.log('PICKED_IDX=' + clickAttempts)

  let pickedIdx = []
  try { pickedIdx = JSON.parse(clickAttempts || '[]') } catch (e) {}
  for (const idx of pickedIdx) {
    const r = await evalJs([
      "(function(){ try {",
      " var col = document.querySelector('[class*=\"sidebarCol\"]');",
      " var els = col.querySelectorAll('button, [role=\"button\"]');",
      " var el = els[" + idx + "];",
      " if (!el) return 'GONE';",
      " el.click();",
      " return 'CLICKED ' + (el.textContent || '').trim().slice(0, 40);",
      "} catch (e) { return 'ERR:' + String(e && e.message || e); } })()",
    ].join(''))
    console.log('CLICK[' + idx + ']=' + r)
    await sleep(5000)
    const rows = await evalJs("document.querySelectorAll('[data-chat-anchor-key]').length")
    if (rows && Number(rows) > 0) { opened = true; console.log('SESSION_OPENED rows=' + rows); break }
  }

  // if still no rows, try sending a message in the current view
  if (!opened) {
    const sendRes = await evalJs([
      "(function(){ try {",
      " var ta = document.querySelector('textarea[data-phase]');",
      " if (!ta) return 'NO_TEXTAREA';",
      " var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;",
      " setter.call(ta, 'pong，不要调用任何工具，只回复pong');",
      " ta.dispatchEvent(new Event('input', { bubbles: true }));",
      " ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));",
      " return 'SENT';",
      "} catch (e) { return 'SEND_ERR:' + String(e && e.message || e); } })()",
    ].join(''))
    console.log('SEND=' + sendRes)
    for (let i = 0; i < 30; i++) {
      await sleep(2000)
      const rows = await evalJs("document.querySelectorAll('[data-chat-anchor-key]').length")
      if (rows && Number(rows) > 0) { opened = true; console.log('MESSAGE_ROWS rows=' + rows); break }
    }
  }

  await sleep(3000)
  const finalState = await evalJs([
    "JSON.stringify({",
    " rows: document.querySelectorAll('[data-chat-anchor-key]').length,",
    " scrollports: document.querySelectorAll('[data-conversation-scroll]').length,",
    " roots: document.querySelectorAll('.dspn-root').length,",
    " keys: document.querySelectorAll('.dspn-key').length,",
    " tips: document.querySelectorAll('.dspn-tip').length,",
    " offsets: (function(){ var a=[]; var ks=document.querySelectorAll('.dspn-key'); for(var i=0;i<Math.min(ks.length,10);i++) a.push(ks[i].getAttribute('data-offset')); return a })(),",
    " debugHook: typeof window.__dspnNavDebug__,",
    " bodyText: (document.body ? document.body.innerText.slice(0, 200).replace(/\\n/g, ' | ') : '')",
    "})",
  ].join(''))
  console.log('FINAL=' + finalState)

  const consoleMsgs = events
    .filter((e) => e.method === 'Runtime.consoleAPICalled')
    .map((e) => ({ type: e.params.type, text: (e.params.args || []).map((a) => (a.value !== undefined ? a.value : (a.description || ''))).join(' ').slice(0, 300) }))
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
  if (child && child.pid) killTree(child.pid)
  process.exit(0)
}
