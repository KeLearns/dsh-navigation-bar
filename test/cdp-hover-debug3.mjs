
// cdp-hover-debug3.mjs — transition-freeze theory check
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9238
const URL_APP = 'http://127.0.0.1:3080/'
const TMP_PROFILE = join(process.env.TEMP || '.', 'dspn-hover-debug3')
const TASKKILL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
if (existsSync(TMP_PROFILE)) { try { rmSync(TMP_PROFILE, { recursive: true, force: true }) } catch (e) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function httpJson(url) { const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status); return res.json() }
let child
try {
  child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--window-size=1600,1000','--user-data-dir=' + TMP_PROFILE,'--remote-debugging-port=' + PORT,'--remote-allow-origins=*','about:blank'], { stdio: 'ignore' })
} catch (e) { console.log('SPAWN_FAIL ' + e.message); process.exit(2) }
let ws = null, msgId = 0
const pending = new Map()
function send(method, params) { return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) }) }
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r && r.exceptionDetails) return 'THROW: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400)
  if (r && r.result && r.result.type === 'string') return r.result.value
  if (r && r.result && r.result.value !== undefined) return JSON.stringify(r.result.value)
  return null
}
function killTree(pid) { try { execFileSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch (e) {} }
try {
  let target = null
  for (let i = 0; i < 40 && !target; i++) { await sleep(500); try { const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list'); target = list.find((t) => t.type === 'page') } catch (e) {} }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id !== undefined && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result) } }
  await send('Runtime.enable', {})
  await send('Page.enable', {})
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.requestAnimationFrame = function(cb){ return setTimeout(function(){ cb(performance.now()) }, 16) }; window.cancelAnimationFrame = function(id){ clearTimeout(id) };" })
  await send('Page.navigate', { url: URL_APP })
  let booted = false
  for (let i = 0; i < 60; i++) { await sleep(1000); const v = await evalJs("window.__DSH_BOOT__ ? 'yes' : 'no'"); if (v === 'yes') { booted = true; break } }
  await sleep(8000)
  await evalJs("localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-31e13318-a084-404e-a04a-322cc8d2ece8' })); 'ok'")
  await send('Page.reload', {})
  await sleep(10000)
  const poke = await evalJs([
    "(function(){",
    " var out = { raf: typeof requestAnimationFrame, vis: document.visibilityState };",
    " var sp = document.querySelector('[data-conversation-scroll]');",
    " if (sp) sp.dispatchEvent(new Event('scroll'));",
    " window.dispatchEvent(new Event('resize'));",
    " return JSON.stringify(out);",
    "})()",
  ].join(''))
  console.log('POKE=' + poke)
  await sleep(2500)
  const pre = await evalJs("JSON.stringify({ rootState: (function(){ var r=document.querySelector('.dspn-root'); return r ? r.getAttribute('data-state') : null })(), keys: document.querySelectorAll('.dspn-key').length })")
  console.log('PRE=' + pre)
  await evalJs("(function(){ var k=document.querySelector('.dspn-key'); if(!k) return 'NO_KEY'; k.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); k.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false})); return 'OK' })()")
  await sleep(600)
  const before = await evalJs("(function(){ var b=document.querySelector('.dspn-key-bar'); var cs=getComputedStyle(b); return JSON.stringify({ w: cs.width, bg: cs.backgroundColor, trans: cs.transitionDuration }) })()")
  console.log('BEFORE=' + before)
  // kill transitions on the bar, force reflow, re-measure
  const after = await evalJs("(function(){ var b=document.querySelector('.dspn-key-bar'); b.style.transition='none'; void b.offsetWidth; return JSON.stringify({ w: getComputedStyle(b).width, bg: getComputedStyle(b).backgroundColor }) })()")
  console.log('AFTER=' + after)
  // force light theme and re-check resting colors
  const light = await evalJs([
    "(function(){",
    " document.body.removeAttribute('data-ds-dark-theme');",
    " var mo = new MutationObserver(function(){});",
    " var k = document.querySelector('.dspn-key');",
    " if (k) { k.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); }",
    " window.dispatchEvent(new Event('resize'));",
    " return 'ok';",
    "})()",
  ].join(''))
  await sleep(1500)
  const l2 = await evalJs([
    "JSON.stringify({",
    " theme: (function(){ var r=document.querySelector('.dspn-root'); return r ? r.getAttribute('data-theme') : null })(),",
    " bars: (function(){ var a=[]; document.querySelectorAll('.dspn-key').forEach(function(k){ var b=k.querySelector('.dspn-key-bar'); a.push({ cls:k.className, w:getComputedStyle(b).width, bg:getComputedStyle(b).backgroundColor }) }); return a })(),",
    "})",
  ].join(''))
  console.log('LIGHT=' + l2)
} catch (e) {
  console.log('CDP_ERROR ' + (e && e.message ? e.message : String(e)))
} finally {
  try { ws && ws.close() } catch (e) {}
  if (child && child.pid) killTree(child.pid)
  process.exit(0)
}
