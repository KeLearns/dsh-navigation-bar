// verify-served.mjs — final bundle verification
const res = await fetch('http://127.0.0.1:3080/plugins/@kelearns/dsh-navigation-bar/client.js')
const t = await res.text()
const checks = {
  status: res.status,
  probeRemoved: !t.includes('__dspnNavDebug__.probe'),
  liveRemoved: !t.includes('__dspnNavDebug__.live'),
  injectSessions: t.includes("['slots', 'sessions']"),
  keyBase6: t.includes('KEY_BASE = 6'),
  pitch10: t.includes('const PITCH = 10'),
  centered: t.includes('(height - clusterH) / 2'),
  darkHoverWhite: t.includes('--dspn-key-hover:#FFFFFF'),
  lightHover: t.includes('--dspn-key-hover:#1A1C1F'),
  version030: t.includes("CSS_VERSION = '0.3.0'"),
}
console.log(JSON.stringify(checks, null, 2))
