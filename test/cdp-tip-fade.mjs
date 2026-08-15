// cdp-tip-fade.mjs — verify soft tooltip border + fade-out in the browser
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
const PORT = 9246
const URL_APP = "http://127.0.0.1:3080/"
const TMP_PROFILE = join(process.env.TEMP || ".", "dspn-tip-fade")
const TASKKILL = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe")
if (existsSync(TMP_PROFILE)) { try { rmSync(TMP_PROFILE, { recursive: true, force: true }) } catch (e) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function httpJson(url) { const res = await fetch(url); if (!res.ok) throw new Error("HTTP " + res.status); return res.json() }
let child
try {
  child = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--window-size=1600,1000","--user-data-dir=" + TMP_PROFILE,"--remote-debugging-port=" + PORT,"--remote-allow-origins=*","about:blank"], { stdio: "ignore" })
} catch (e) { console.log("SPAWN_FAIL " + e.message); process.exit(2) }
let ws = null, msgId = 0
const pending = new Map()
function send(method, params) { return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) }) }
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (r && r.exceptionDetails) return "THROW: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400)
  if (r && r.result && r.result.type === "string") return r.result.value
  if (r && r.result && r.result.value !== undefined) return JSON.stringify(r.result.value)
  return null
}
function killTree(pid) { try { execFileSync(TASKKILL, ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }) } catch (e) {} }
try {
  let target = null
  for (let i = 0; i < 40 && !target; i++) { await sleep(500); try { const list = await httpJson("http://127.0.0.1:" + PORT + "/json/list"); target = list.find((t) => t.type === "page") } catch (e) {} }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("ws error")) })
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id !== undefined && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result) } }
  await send("Runtime.enable", {})
  await send("Page.enable", {})
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.requestAnimationFrame = function(cb){ return setTimeout(function(){ cb(performance.now()) }, 16) }; window.cancelAnimationFrame = function(id){ clearTimeout(id) };" })
  await send("Page.navigate", { url: URL_APP })
  let booted = false
  for (let i = 0; i < 60; i++) { await sleep(1000); const v = await evalJs("window.__DSH_BOOT__ ? 'yes' : 'no'"); if (v === "yes") { booted = true; break } }
  await sleep(8000)
  await evalJs("localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-42350aec-9138-468f-b588-38926b40f22a' })); 'ok'")
  await send("Page.reload", {})
  await sleep(12000)
  await evalJs([
    "(function(){",
    " var k = document.querySelector('.dspn-key');",
    " if (!k) return 'NO_KEY';",
    " k.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));",
    " k.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));",
    " return 'HOVERED';",
    "})()",
  ].join(''))
  await sleep(600)
  const on = await evalJs([
    "JSON.stringify({",
    " border: getComputedStyle(document.querySelector('.dspn-tip')).borderColor,",
    " anim: getComputedStyle(document.querySelector('.dspn-tip')).animationName,",
    " cls: document.querySelector('.dspn-tip').className,",
    "})",
  ].join(''))
  console.log("ON=" + on)
  // leave: dispatch mouseout on the key (container leave)
  await evalJs([
    "(function(){",
    " var k = document.querySelector('.dspn-key');",
    " var keys = document.querySelector('.dspn-keys');",
    " if (keys) keys.dispatchEvent(new MouseEvent('mouseleave',{bubbles:false}));",
    " k.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));",
    " return 'LEFT';",
    "})()",
  ].join(''))
  await sleep(80)
  const mid = await evalJs([
    "JSON.stringify({",
    " tipCount: document.querySelectorAll('.dspn-tip').length,",
    " cls: (function(){ var t=document.querySelector('.dspn-tip'); return t ? t.className : null })(),",
    " anim: (function(){ var t=document.querySelector('.dspn-tip'); return t ? getComputedStyle(t).animationName : null })(),",
    "})",
  ].join(''))
  console.log("MID=" + mid)
  await sleep(400)
  const after = await evalJs("JSON.stringify({ tipCount: document.querySelectorAll('.dspn-tip').length })")
  console.log("AFTER=" + after)
} catch (e) {
  console.log("CDP_ERROR " + (e && e.message ? e.message : String(e)))
} finally {
  try { ws && ws.close() } catch (e) {}
  if (child && child.pid) killTree(child.pid)
  process.exit(0)
}
