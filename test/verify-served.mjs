// verify-tip.mjs — tooltip dark border + fade-out behavior
const res = await fetch('http://127.0.0.1:3080/plugins/@kelearns/dsh-navigation-bar/client.js')
const t = await res.text()
console.log(JSON.stringify({
  borderSoft: t.includes('--dspn-tip-border:rgba(255,255,255,.10)'),
  inAnim: t.includes('dspn-tip-in .2s cubic-bezier'),
  outKeyframes: t.includes('dspn-tip-out'),
  leaveClass: t.includes('dspn-tip-leave'),
  version: t.includes("CSS_VERSION = '0.3.1'"),
}))
