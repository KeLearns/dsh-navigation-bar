// cdp-audit.mjs - open a REAL session with user messages and audit the piano bar.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
const PORT = 9231
const URL_APP = "http://127.0.0.1:3080/"
const TMP_PROFILE = join(process.env.TEMP || ".", "dspn-cdp-audit")
const TASKKILL = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe")

if (existsSync(TMP_PROFILE)) { try { rmSync(TMP_PROFILE, { recursive: true, force: true }) } catch (e) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function httpJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error("HTTP " + res.status)
  return res.json()
}

let child
try {
  child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--window-size=1600,1000",
    "--user-data-dir=" + TMP_PROFILE,
    "--remote-debugging-port=" + PORT,
    "--remote-allow-origins=*",
    "about:blank",
  ], { stdio: "ignore" })
} catch (e) { console.log("SPAWN_EDGE_FAIL " + e.message); process.exit(2) }

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
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (r && r.exceptionDetails) return "EVAL_THROW: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300)
  if (r && r.result && r.result.type === "string") return r.result.value
  if (r && r.result && r.result.value !== undefined) return JSON.stringify(r.result.value)
  return null
}
function killTree(pid) {
  try { execFileSync(TASKKILL, ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }) } catch (e) {}
}

try {
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500)
    try {
      const list = await httpJson("http://127.0.0.1:" + PORT + "/json/list")
      target = list.find((t) => t.type === "page")
    } catch (e) { }
  }
  if (!target) { console.log("NO_CDP_TARGET"); process.exit(3) }

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("ws error")) })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    } else if (msg.method) events.push(msg)
  }

  await send("Runtime.enable", {})
  await send("Page.enable", {})
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.requestAnimationFrame = function(cb){ return setTimeout(function(){ cb(performance.now()) }, 16) }; window.cancelAnimationFrame = function(id){ clearTimeout(id) };" })
  await send("Page.navigate", { url: URL_APP })

  let booted = false
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const v = await evalJs("window.__DSH_BOOT__ ? 'yes' : 'no'")
    if (v === "yes") { booted = true; break }
  }
  await sleep(8000)
  console.log("BOOTED=" + booted)

  const rowsExpr = [
    "(function(){ try {",
    " var col = document.querySelector('[class*=sidebarCol]') || document.querySelector('aside');",
    " if (!col) return 'NO_SIDEBAR';",
    " var out = [];",
    " var all = col.querySelectorAll('*');",
    " for (var i = 0; i < all.length; i++) {",
    "   var e = all[i];",
    "   if (e.children.length !== 0) continue;",
    "   var t = (e.textContent || '').trim();",
    "   var c = String(e.className || '');",
    "   if (t.length < 3 || t.length > 70) continue;",
    "   if (c.indexOf('YDXeBa_title') === -1) continue;",
    "   out.push({ text: t, cls: c.slice(0,60), tag: e.tagName });",
    " }",
    " return JSON.stringify(out.slice(0, 30));",
    " } catch (e) { return 'ERR:' + String(e && e.message || e); } })()",
  ].join('')
  const rowsInfo = await evalJs(rowsExpr)
  console.log('ROWS=' + rowsInfo)

  let cand = []
  try { cand = JSON.parse(rowsInfo || '[]') } catch (e) {}

  let opened = false
  const PREFERRED = ['新会话', 'pong回显测试', '审计导航栏插件失效原因', 'pong']
  for (const pref of PREFERRED) {
    if (opened) break
    const res = await evalJs([
      "(function(){ try {",
      " var col = document.querySelector('[class*=sidebarCol]') || document.querySelector('aside');",
      " if (!col) return 'NO_COL';",
      " var spans = col.querySelectorAll('span[class*=YDXeBa_title]');",
      " for (var i = 0; i < spans.length; i++) {",
      "   var t = (spans[i].textContent || '').trim();",
      "   if (t === " + JSON.stringify(pref) + ") {",
      "     var hit = spans[i].closest('button,[role=button],a') || spans[i].parentElement || spans[i];",
      "     hit.click();",
      "     return 'CLICKED:' + t;",
      "   }",
      " }",
      " return 'NOT_FOUND:' + " + JSON.stringify(pref) + ";",
      " } catch (e) { return 'ERR:' + String(e && e.message || e); } })()",
    ].join(''))
    console.log('TRY[' + pref + ']=' + res)
    for (let i = 0; i < 15; i++) {
      await sleep(1000)
      const rows = await evalJs("document.querySelectorAll('[data-chat-anchor-key]').length")
      const n = Number(rows || 0)
      if (n > 0) { opened = true; console.log('OPENED rows=' + n); break }
    }
  }
  if (!opened) {
    const ns = await evalJs([
      "(function(){ try {",
      " var col = document.querySelector('[class*=sidebarCol]') || document.querySelector('aside');",
      " var b = col && col.querySelector('button[class*=newSession]');",
      " if (!b) return 'NO_NEW';",
      " b.click(); return 'NEW_CLICKED';",
      " } catch (e) { return 'ERR:' + String(e && e.message || e); } })()",
    ].join(''))
    console.log('NEW=' + ns)
    await sleep(4000)
    const sendRes = await evalJs([
      "(function(){ try {",
      " var ta = document.querySelector('textarea[data-phase]');",
      " if (!ta) return 'NO_TEXTAREA';",
      " var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;",
      " setter.call(ta, 'reply with exactly: pong');",
      " ta.dispatchEvent(new Event('input', { bubbles: true }));",
      " ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));",
      " return 'SENT';",
      " } catch (e) { return 'SEND_ERR:' + String(e && e.message || e); } })()",
    ].join(''))
    console.log('SEND=' + sendRes)
    for (let i = 0; i < 40; i++) {
      await sleep(2000)
      const rows = await evalJs("document.querySelectorAll('[data-chat-anchor-key]').length")
      if (rows && Number(rows) > 0) { opened = true; console.log('MESSAGE_ROWS rows=' + rows); break }
    }
  }

  await sleep(6000)

  const audit = await evalJs([
    "JSON.stringify({",
    " current: (function(){ try { return (JSON.parse(localStorage.getItem('dsh.sessions.current')||'{}')).sessionId || null } catch(e){ return 'ERR' } })(),",
    " roots: document.querySelectorAll('.dspn-root').length,",
    " rootState: (function(){ var r=document.querySelector('.dspn-root'); return r ? r.getAttribute('data-state') : null })(),",
    " rootDisplay: (function(){ var r=document.querySelector('.dspn-root'); return r ? getComputedStyle(r).display : null })(),",
    " keys: document.querySelectorAll('.dspn-key').length,",
    " tips: document.querySelectorAll('.dspn-tip').length,",
    " rows: document.querySelectorAll('[data-chat-anchor-key]').length,",
    " rowKinds: (function(){ var a=[]; document.querySelectorAll('[data-chat-anchor-key]').forEach(function(r){ a.push({k:r.dataset.chatAnchorKey, t:(r.textContent||'').trim().slice(0,24)}) }); return a.slice(0,14) })(),",
    " domInputMsg: (function(){ var a=[]; document.querySelectorAll('[data-chat-anchor-key]').forEach(function(r){ var k=r.dataset.chatAnchorKey||''; if(k.indexOf('input-message')!==-1) a.push({k:k, fk:r.getAttribute('data-chat-flow-kind'), t:(r.textContent||'').trim().slice(0,20)}) }); return a.slice(0,10) })(),",
    " domInputMsgCount: (function(){ var n=0; document.querySelectorAll('[data-chat-anchor-key]').forEach(function(r){ var k=r.dataset.chatAnchorKey||''; if(k.indexOf('input-message')!==-1) n++ }); return n })(),",
    " scrollports: document.querySelectorAll('[data-conversation-scroll]').length,",
    " scrollPortVisible: (function(){ var s=document.querySelector('[data-conversation-scroll]'); if(!s) return null; var r=s.getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height)} })(),",
    " debug: (function(){ var d=window.__dspnNavDebug__; return d ? { version:d.version, registered:!!d.registered, applied:!!d.applied, applyError:d.applyError||null } : null })(),",
    " live: (function(){ var d=window.__dspnNavDebug__; try { return d && d.live ? d.live : null } catch(e){ return null } })(),",
    " probe: (function(){ var d=window.__dspnNavDebug__; try { return d && typeof d.probe === 'function' ? d.probe() : null } catch(e){ return String(e) } })(),",
    " cssInjected: (function(){ var n=0; var ss=document.querySelectorAll('style'); for(var i=0;i<ss.length;i++){ if(ss[i].dataset && ss[i].dataset.pluginCss==='dsh-navigation-bar/styles') n++ } return n })(),",
    " bodyText: (document.body ? document.body.innerText.slice(0,160).replace(/\\n/g,' | ') : '')",
    "})",
  ].join(''))
  console.log('AUDIT=' + audit)

  // ---- deterministic re-check: switch to the session with a plain user message ----
  const switchRes = await evalJs([
    "(function(){ try {",
    " localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-31e13318-a084-404e-a04a-322cc8d2ece8' }));",
    " return 'SWITCHED';",
    " } catch (e) { return 'ERR:' + String(e && e.message || e); } })()",
  ].join(''))
  console.log('SWITCH=' + switchRes)
  await send('Page.reload', {})
  await sleep(12000)

  async function dumpKeys(label) {
    const d = await evalJs([
      "JSON.stringify({",
      " current: (function(){ try { return (JSON.parse(localStorage.getItem('dsh.sessions.current')||'{}')).sessionId || null } catch(e){ return 'ERR' } })(),",
      " rootState: (function(){ var r=document.querySelector('.dspn-root'); return r ? r.getAttribute('data-state') : null })(),",
      " keys: document.querySelectorAll('.dspn-key').length,",
      " bars: (function(){ var a=[]; document.querySelectorAll('.dspn-key').forEach(function(k,i){",
      "   var b=k.querySelector('.dspn-key-bar'); var r=k.getBoundingClientRect(); var br=b.getBoundingClientRect();",
      "   var cs=getComputedStyle(b);",
      "   a.push({ i:i, top:Math.round(r.top*2)/2, barW:Math.round(br.width*2)/2, bg:cs.backgroundColor, cls:k.className, off:k.getAttribute('data-offset') });",
      " }); return a })(),",
      " strip: (function(){ var s=document.querySelector('[data-conversation-scroll]'); if(!s) return null; var r=s.getBoundingClientRect(); return {top:Math.round(r.top), h:Math.round(r.height)} })(),",
      " theme: (function(){ var r=document.querySelector('.dspn-root'); return r ? r.getAttribute('data-theme') : null })(),",
      "})",
    ].join(''))
    console.log(label + '=' + d)
  }

  const poke = await evalJs([
    "(function(){",
    " var out = { raf: typeof requestAnimationFrame, rafSrc: String(requestAnimationFrame).slice(0,60), vis: document.visibilityState };",
    " var sp = document.querySelector('[data-conversation-scroll]');",
    " if (sp) sp.dispatchEvent(new Event('scroll'));",
    " window.dispatchEvent(new Event('resize'));",
    " return JSON.stringify(out);",
    "})()",
  ].join(''))
  console.log('POKE=' + poke)
  await sleep(2500)
  await dumpKeys('VIS1_pong')

  // simulate hover on the first key (if any)
  const hv = await evalJs([
    "(function(){",
    " var k=document.querySelector('.dspn-key');",
    " if (!k) return 'NO_KEY';",
    " k.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));",
    " k.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));",
    " return 'HOVERED';",
    "})()",
  ].join(''))
  console.log('HOVER=' + hv)
  await sleep(800)
  const hv2 = await evalJs([
    "JSON.stringify({",
    " cssHasOffset: (function(){ var t=document.querySelector('style[data-plugin-css]'); return t ? t.textContent.indexOf('data-offset') : -1 })(),",
    " pluginCss: (function(){ var t=null; var ss=document.querySelectorAll('style'); for(var i=0;i<ss.length;i++){ if(ss[i].dataset && ss[i].dataset.pluginCss==='dsh-navigation-bar/styles'){ t=ss[i]; break } } return t ? { all: t.textContent, offIdx: t.textContent.indexOf('data-offset'), mid: t.textContent.slice(1150, 1600) } : 'NO_PLUGIN_TAG' })(),",
    " styleTags: document.querySelectorAll('style[data-plugin-css]').length,",
    " key: (function(){ var k=document.querySelector('.dspn-key'); if(!k) return null; var b=k.querySelector('.dspn-key-bar'); var cs=getComputedStyle(b); return { cls:k.className, off:k.getAttribute('data-offset'), w:cs.width, bg:cs.backgroundColor, rectW:b.getBoundingClientRect().width } })(),",
    "})",
  ].join(''))
  console.log('VIS2_hover=' + hv2)

  // switch to the audit session (steering messages) — expect 2 keys now
  const sw2 = await evalJs([
    "(function(){ try {",
    " localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-42350aec-9138-468f-b588-38926b40f22a' }));",
    " return 'SWITCHED2';",
    " } catch (e) { return 'ERR:' + String(e && e.message || e); } })()",
  ].join(''))
  console.log('SWITCH2=' + sw2)
  await send('Page.reload', {})
  await sleep(12000)
  await dumpKeys('VIS3_steering')
  const consoleMsgs = events
    .filter((e) => e.method === "Runtime.consoleAPICalled")
    .map((e) => ({ type: e.params.type, text: (e.params.args || []).map((a) => (a.value !== undefined ? a.value : (a.description || ''))).join(' ').slice(0, 300) }))
    .filter((m) => m.text.includes("dsh-navigation") || m.type === "error")
  console.log('CONSOLE=' + JSON.stringify(consoleMsgs))
  const exceptions = events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => String((e.params && e.params.exceptionDetails && e.params.exceptionDetails.text) || 'exception').slice(0, 300))
  console.log('EXCEPTIONS=' + JSON.stringify(exceptions))
} catch (e) {
  console.log('CDP_ERROR ' + (e && e.message ? e.message : String(e)))
} finally {
  try { ws && ws.close() } catch (e) {}
  if (child && child.pid) killTree(child.pid)
  process.exit(0)
}
