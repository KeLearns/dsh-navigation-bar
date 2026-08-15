/* @kelearns/dsh-navigation-bar — browser half (hand-written bundle, no build step).
 *
 * Contract (client-modules): window.__ModuleLoader__.load({ id, factory }).
 * Mount: additive 'shell.overlay' slot (frame-wide floating layer, list slot,
 *        click-through layer — only the key strip opts back into pointer events).
 * Data:  ctx.sessions.binding(currentId).session → ConversationSnapshot
 *        (getSnapshot/subscribe — React useSyncExternalStore compatible).
 * Anchors: one key per user message (chat node kind 'user'); message rows in
 *        the [data-conversation-scroll] scrollport carry [data-chat-anchor-key].
 *
 * Visual spec (MiMo V2.5 reference-image analysis, docs/ref-picture-analysis.md):
 *   - vertical piano-key strip at the right side of the sidebar/main divider
 *   - hover: hovered key lengthens (~4x) and changes color; the adjacent keys
 *     above/below form a 3-step ladder (≈65% / ≈47% / ≈30%), the 4th neighbor
 *     and beyond return to the base length; edge keys clip naturally
 *   - non-hover: every key at its shortest length; the key of the user message
 *     currently in view is highlighted (active)
 *   - tooltip: user message on one line (ellipsis), model message max 3 lines
 *     (-webkit-line-clamp) on hover
 */
;(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return
  window.__ModuleLoader__.load({
    id: '@kelearns/dsh-navigation-bar',
    factory: (require) => {
      const React = require('react')
      const { useState, useEffect, useMemo, useRef, useSyncExternalStore } = React

      const PLUGIN_ID = '@kelearns/dsh-navigation-bar'
      const CSS_VERSION = '0.3.1'

      // Geometry — exact pixel measurements from the reference images
      // (test/img-analysis*.cjs): 2px bars, 6px base, 26px hovered, fixed 10px
      // pitch, top-anchored cluster. Hover ladder 26/20/14/10 (77%/54%/38%).
      const KEY_MAX = 26   // hovered key length
      const KEY_BASE = 6   // shortest key length
      const KEY_HIT = 10   // slot pitch = hit area height (visual bar is 2px)
      const BAR_LEFT_OFFSET = 6
      const PAD = 10
      const PITCH = 10     // fixed center-to-center spacing between keys
      const MIN_PITCH = 6  // densest pitch when the cluster overflows the strip
      const TIP_GAP = 10
      const TIP_WIDTH = 280
      const LADDER = [KEY_MAX, 20, 14, 10] // offsets 0..3; >=4 uses base

      let ctxRef = null

      // ── self-injected styles (versioned, self-healing) ──
      const CSS_LINES = [
        '.dspn-root{position:absolute;inset:0;pointer-events:none;z-index:30;',
        '--dspn-key-base:#D2D3D3;--dspn-key-active:#767779;--dspn-key-hover:#1A1C1F;',
        '--dspn-key-n1:#D2D3D3;--dspn-key-n2:#D2D3D3;--dspn-key-n3:#D2D3D3;',
        '--dspn-glow:0 0 0 rgba(0,0,0,0);',
        '--dspn-tip-bg:#FFFFFF;--dspn-tip-border:#E5E7EB;--dspn-tip-shadow:0 2px 10px rgba(0,0,0,.12);',
        '--dspn-tip-user:#111827;--dspn-tip-model:#6B7280}',
        '.dspn-root[data-theme="dark"]{',
        '--dspn-key-base:#454545;--dspn-key-active:#A3A3A3;--dspn-key-hover:#FFFFFF;',
        '--dspn-key-n1:#454545;--dspn-key-n2:#454545;--dspn-key-n3:#454545;',
        '--dspn-glow:0 0 0 rgba(0,0,0,0);',
        '--dspn-tip-bg:#2C2C2C;--dspn-tip-border:rgba(255,255,255,.10);--dspn-tip-shadow:0 4px 16px rgba(0,0,0,.35);',
        '--dspn-tip-user:#D8D8E8;--dspn-tip-model:#9898A8}',
        '.dspn-keys{position:absolute;pointer-events:auto;width:' + (KEY_MAX + 8) + 'px;overflow:visible}',
        '.dspn-key{position:absolute;left:0;width:' + (KEY_MAX + 8) + 'px;height:' + KEY_HIT + 'px;padding:0;margin:0;border:0;background:transparent;cursor:pointer;display:block;transform:translateY(-' + (KEY_HIT / 2) + 'px);outline:none}',
        '.dspn-key-bar{position:absolute;left:0;top:50%;margin-top:-1px;height:2px;border-radius:2px;background:var(--dspn-key-base);width:' + KEY_BASE + 'px;transition:width .25s ease-out,background-color .2s ease-out,box-shadow .2s ease-out}',
        '.dspn-key[data-offset="0"] .dspn-key-bar{width:' + LADDER[0] + 'px;background:var(--dspn-key-hover);box-shadow:var(--dspn-glow)}',
        '.dspn-key[data-offset="1"] .dspn-key-bar{width:' + LADDER[1] + 'px}',
        '.dspn-key[data-offset="2"] .dspn-key-bar{width:' + LADDER[2] + 'px}',
        '.dspn-key[data-offset="3"] .dspn-key-bar{width:' + LADDER[3] + 'px}',
        '.dspn-key-active .dspn-key-bar{background:var(--dspn-key-active)}',
        '.dspn-tip{position:absolute;transform:translateY(-50%);width:' + TIP_WIDTH + 'px;max-width:' + TIP_WIDTH + 'px;box-sizing:border-box;background:var(--dspn-tip-bg);border:1px solid var(--dspn-tip-border);border-radius:10px;box-shadow:var(--dspn-tip-shadow);padding:10px 12px;pointer-events:none;font-family:var(--dsw-font-family,inherit);animation:dspn-tip-in .2s cubic-bezier(.22,1,.36,1)}',
        '.dspn-tip-user{font-size:13px;line-height:18px;font-weight:600;color:var(--dspn-tip-user);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dspn-tip-model{margin-top:4px;font-size:12px;line-height:18px;font-weight:400;color:var(--dspn-tip-model);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden;overflow-wrap:anywhere}',
        '@keyframes dspn-tip-in{from{opacity:0;transform:translateY(-50%) translateX(-6px) scale(.98)}to{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}}',
        '@keyframes dspn-tip-out{from{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}to{opacity:0;transform:translateY(-50%) translateX(-6px) scale(.98)}}',
        '.dspn-tip-leave{animation:dspn-tip-out .18s ease-in forwards}',,
        '@media (prefers-reduced-motion:reduce){.dspn-key-bar{transition:none}.dspn-tip{animation:none}.dspn-tip-leave{animation:none}}',
      ]
      const PLUGIN_CSS = CSS_LINES.join('\n')

      const ensureCss = () => {
        if (typeof document === 'undefined') return
        let tag = document.querySelector('style[data-plugin-css="dsh-navigation-bar/styles"]')
        if (!tag) {
          tag = document.createElement('style')
          tag.dataset.pluginCss = 'dsh-navigation-bar/styles'
          document.head.appendChild(tag)
        }
        if (tag.dataset.pluginVersion !== CSS_VERSION) {
          tag.textContent = PLUGIN_CSS
          tag.dataset.pluginVersion = CSS_VERSION
        }
      }

      // ── theme ──
      const readDark = () => {
        if (typeof document === 'undefined') return false
        if (document.body && document.body.hasAttribute('data-ds-dark-theme')) return true
        if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches) return true
        return false
      }

      // ── helpers ──
      const findScrollport = () => {
        if (typeof document === 'undefined') return null
        const list = document.querySelectorAll('[data-conversation-scroll]')
        for (const el of list) {
          if (typeof el.getClientRects === 'function' && el.getClientRects().length > 0) return el
        }
        return null
      }

      const textOfBlocks = (blocks) => {
        if (!Array.isArray(blocks)) return ''
        const parts = []
        for (const b of blocks) {
          if (!b || typeof b !== 'object') continue
          if (b.kind === 'text' || b.type === 'text') {
            const t = b.text !== undefined ? b.text : b.content
            if (typeof t === 'string' && t.trim()) parts.push(t)
          } else if (b.type === 'image' || b.kind === 'image') {
            parts.push('[图片]')
          } else if (typeof b.text === 'string' && b.text.trim()) {
            parts.push(b.text)
          }
        }
        return parts.join(' ').replace(/\s+/g, ' ').trim()
      }

      /** Model-preview budget: ~3 lines of 12px/18px text in the 280px tooltip.
       *  Width-model truncation (CJK = 1 unit, Latin/digits = 0.5) guarantees the
       *  preview never exceeds 3 lines even where -webkit-line-clamp is inert;
       *  the CSS clamp adds the line-level ellipsis where supported. */
      const MODEL_TEXT_BUDGET = 55
      const clampModelText = (text) => {
        if (!text) return ''
        let units = 0
        let idx = 0
        for (; idx < text.length; idx++) {
          const code = text.charCodeAt(idx)
          const w = code > 0x2E7F ? 1 : 0.5
          if (units + w > MODEL_TEXT_BUDGET) break
          units += w
        }
        if (idx >= text.length) return text
        return text.slice(0, Math.max(0, idx - 1)) + '…'
      }

      /** One piano entry per user message; the tooltip shows that user message
       *  (1 line) plus the model reply of the same turn (max 3 lines). */
      const buildEntries = (snapshot) => {
        if (!snapshot || typeof snapshot !== 'object') return []
        const entries = []
        const nodes = []
        const chat = snapshot.chat
        if (chat && Array.isArray(chat.order) && chat.nodes && typeof chat.nodes.get === 'function') {
          for (const key of chat.order) {
            const node = chat.nodes.get(key)
            if (node) nodes.push(node)
          }
        }
        const source = nodes.length > 0 ? nodes : (Array.isArray(snapshot.nodes) ? snapshot.nodes : [])
        let cur = null
        const byTurn = new Map()
        const appendModelText = (entry, blocks) => {
          if (!entry || !Array.isArray(blocks)) return
          for (const b of blocks) {
            if (b && b.kind === 'text' && typeof b.text === 'string' && b.text.trim()) {
              entry.modelText = (entry.modelText ? entry.modelText + ' ' : '') + b.text.replace(/\s+/g, ' ').trim()
            }
          }
        }
        for (const node of source) {
          if (!node || typeof node !== 'object') continue
          const kind = node.kind
          if (kind === 'user' || kind === 'steering') {
            const data = node.data && typeof node.data === 'object' && (node.data.kind === 'user' || node.data.kind === 'steering') ? node.data : node
            const userText = textOfBlocks(data.content)
            cur = {
              key: typeof node.key === 'string' ? node.key : ('u' + (data.seq !== undefined ? data.seq : entries.length)),
              userText: userText || (data.content && data.content.length ? '[附件消息]' : '…'),
              modelText: '',
            }
            entries.push(cur)
            const turn = node.location && node.location.kind === 'turn' && node.location.turn ? node.location.turn.turn : null
            if (turn !== null && turn !== undefined) byTurn.set(turn, cur)
          } else if (kind === 'assistant-step') {
            const data = node.data && typeof node.data === 'object' ? node.data : node
            const entry = (data.turn !== undefined && byTurn.get(data.turn)) || cur
            appendModelText(entry, data.blocks)
          } else if (kind === 'assistant' && cur) {
            // legacy snapshot.nodes path: assistant node directly after its user node
            const data = node.data && typeof node.data === 'object' ? node.data : node
            appendModelText(cur, data.blocks)
          }
        }
        for (const e of entries) e.modelText = clampModelText(e.modelText)
        return entries
      }

      const noopSub = () => () => {}
      const noopSnap = () => null

      // dev diagnostics (harmless; also used by the standalone test page)
      try {
        window.__dspnNavDebug__ = {
          buildEntries,
          findScrollport,
          readDark,
          version: CSS_VERSION,
        }
      } catch (err) { /* ignore */ }

      // ── the overlay component ──
      function PianoNavOverlay(props) {
        try {
          return PianoNavOverlayInner(props)
        } catch (err) {
          console.error('[dsh-navigation-bar] render error:', err)
          return React.createElement('div', {
            className: 'dspn-root dspn-panic',
            'data-state': 'error',
            style: {
              position: 'absolute', top: 8, left: 8, zIndex: 2147483000,
              background: '#c62828', color: '#fff', font: '11px/15px monospace',
              padding: '6px 10px', borderRadius: 6, maxWidth: 420,
              whiteSpace: 'pre-wrap', pointerEvents: 'auto',
            },
          }, 'dsh-navigation-bar error: ' + String((err && err.message) || err))
        }
      }

      function PianoNavOverlayInner(props) {
        const useSessions = props.useSessions
        const currentId = useSessions ? useSessions((s) => (s && s.current) || undefined) : undefined

        let session = null
        try {
          if (currentId && ctxRef && ctxRef.sessions) {
            const binding = ctxRef.sessions.binding(currentId)
            session = binding ? binding.session : null
          }
        } catch (err) {
          session = null
        }

        const subscribe = useMemo(
          () => (session && typeof session.subscribe === 'function' ? session.subscribe.bind(session) : noopSub),
          [session],
        )
        const getSnap = useMemo(
          () => (session && typeof session.getSnapshot === 'function' ? session.getSnapshot.bind(session) : noopSnap),
          [session],
        )
        const snapshot = useSyncExternalStore(subscribe, getSnap, getSnap)
        const entries = useMemo(() => buildEntries(snapshot), [snapshot])



        const [dark, setDark] = useState(readDark)
        const [hover, setHover] = useState(null)
        const [layout, setLayout] = useState({ hidden: true })
        const [tipExit, setTipExit] = useState(null)
        const lastHoverRef = useRef(null)
        const visibleLoggedRef = useRef(false)
        const missingLoggedRef = useRef(0)

        const entriesRef = useRef(entries)
        useEffect(() => { entriesRef.current = entries }, [entries])

        const rafRef = useRef(0)
        const computeRef = useRef(null)

        const sameLayout = (a, b) => {
          if (!a || !b) return false
          if (a.hidden !== b.hidden || a.left !== b.left || a.top !== b.top || a.height !== b.height || a.active !== b.active) return false
          if (!Array.isArray(a.ys) || !Array.isArray(b.ys) || a.ys.length !== b.ys.length) return false
          for (let i = 0; i < a.ys.length; i++) if (a.ys[i] !== b.ys[i]) return false
          return true
        }

        const compute = () => {
          const list = entriesRef.current || []
          const sp = findScrollport()
          if (!sp || list.length === 0) {
            setLayout((prev) => (prev && prev.hidden ? prev : { hidden: true }))
            return
          }
          const spRect = sp.getBoundingClientRect()
          if (spRect.width < 1 || spRect.height < 1) {
            setLayout((prev) => (prev && prev.hidden ? prev : { hidden: true }))
            return
          }
          const composer = sp.querySelector('[data-composer-seat]')
          const bottomEdge = composer ? Math.min(composer.getBoundingClientRect().top, spRect.bottom) : spRect.bottom
          const top = spRect.top + PAD
          const height = Math.max(60, bottomEdge - top - PAD)
          const left = spRect.left + BAR_LEFT_OFFSET

          // Reference layout: keys cluster as one fixed-pitch run (10px center
          // spacing), vertically centered in the strip — never scattered across
          // it. Only when the cluster would overflow the strip does the pitch
          // compress.
          const n = list.length
          const avail = Math.max(1, height - 2 * PAD)
          const pitch = n * PITCH <= avail ? PITCH : Math.max(MIN_PITCH, avail / n)
          const clusterH = n * pitch
          const startY = top + (height - clusterH) / 2 + pitch / 2
          const ys = new Array(n)
          for (let i = 0; i < n; i++) ys[i] = startY + pitch * i

          // active = the entry whose message row is currently in view
          const scrollTop = sp.scrollTop
          const scrollH = Math.max(1, sp.scrollHeight)
          let active = n - 1
          let found = false
          for (let i = 0; i < n; i++) {
            const row = sp.querySelector('[data-chat-anchor-key="' + list[i].key + '"]')
            if (!row) continue
            const rr = row.getBoundingClientRect()
            if (rr.bottom > spRect.top + 8) {
              active = i
              found = true
              break
            }
          }
          if (!found) {
            active = Math.min(n - 1, Math.max(0, Math.round(((scrollTop + spRect.height / 2) / scrollH) * n)))
          }
          const next = {
            hidden: false,
            left: Math.round(left * 2) / 2,
            top: Math.round(top * 2) / 2,
            height: Math.round(height),
            ys: ys.map((y) => Math.round(y * 2) / 2),
            active,
          }
          // one-shot console diagnostics (never affect rendering)
          if (!next.hidden && !visibleLoggedRef.current) {
            visibleLoggedRef.current = true
            console.info('[dsh-navigation-bar] piano bar visible: entries=' + list.length + ' pitch=' + Math.round(pitch * 10) / 10)
          } else if (next.hidden && list.length > 0 && Date.now() - missingLoggedRef.current > 10000) {
            missingLoggedRef.current = Date.now()
            console.warn('[dsh-navigation-bar] entries present but conversation scrollport not found — retrying')
          }
          setLayout((prev) => (sameLayout(prev, next) ? prev : next))
        }
        computeRef.current = compute

        const schedule = () => {
          if (rafRef.current) return
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0
            if (computeRef.current) computeRef.current()
          })
        }

        // geometry tracking: mount once, then self-heal — the conversation
        // scrollport may not exist yet when the overlay mounts (the root-scope
        // overlay mounts before the session view), so keep retrying instead of
        // giving up after the first miss.
        useEffect(() => {
          const onScroll = () => schedule()
          document.addEventListener('scroll', onScroll, { capture: true, passive: true })
          window.addEventListener('resize', onScroll)
          let ro = null
          if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(() => schedule())
          let mo = null
          if (typeof MutationObserver !== 'undefined') {
            mo = new MutationObserver(() => schedule())
            mo.observe(document.body, { childList: true, subtree: true })
          }
          const retry = window.setInterval(() => {
            const sp = findScrollport()
            if (sp && ro) {
              try { ro.observe(sp) } catch (err) { /* already observed / detached */ }
              if (sp.parentElement) {
                try { ro.observe(sp.parentElement) } catch (err) { /* ignore */ }
              }
            }
            schedule()
          }, 1000)
          schedule()
          return () => {
            document.removeEventListener('scroll', onScroll, { capture: true })
            window.removeEventListener('resize', onScroll)
            if (ro) ro.disconnect()
            if (mo) mo.disconnect()
            window.clearInterval(retry)
          }
        }, [])

        useEffect(() => { schedule() }, [entries])

        // theme tracking
        useEffect(() => {
          const applyTheme = () => setDark(readDark())
          let mo = null
          if (typeof MutationObserver !== 'undefined') {
            mo = new MutationObserver(applyTheme)
            mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
          }
          let mq = null
          if (typeof matchMedia !== 'undefined') {
            mq = matchMedia('(prefers-color-scheme: dark)')
            if (typeof mq.addEventListener === 'function') mq.addEventListener('change', applyTheme)
          }
          applyTheme()
          return () => {
            if (mo) mo.disconnect()
            if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', applyTheme)
          }
        }, [])

        // hover index can drift out of range when messages stream in
        const safeHover = hover != null && entries[hover] ? hover : null

        // soft fade-out: keep the tip rendered with a leave animation when the
        // pointer leaves, then unmount it after the animation completes
        useEffect(() => {
          if (safeHover != null) {
            lastHoverRef.current = safeHover
            setTipExit(null)
            return
          }
          const leaving = lastHoverRef.current
          if (leaving == null) return
          lastHoverRef.current = null
          setTipExit(leaving)
          const t = window.setTimeout(() => {
            setTipExit((cur) => (cur === leaving ? null : cur))
          }, 220)
          return () => window.clearTimeout(t)
        }, [safeHover])

        const jumpTo = (entry) => {
          const sp = findScrollport()
          if (!sp) return
          let row = null
          for (const r of sp.querySelectorAll('[data-chat-anchor-key]')) {
            if (r.dataset.chatAnchorKey === entry.key) { row = r; break }
          }
          if (row) {
            try { row.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (err) { row.scrollIntoView() }
          }
        }

        let stateAttr = 'empty'
        if (entries.length > 0 && layout && !layout.hidden) stateAttr = 'live'
        else if (entries.length > 0) stateAttr = 'waiting'
        if (entries.length === 0) {
          return React.createElement('div', {
            className: 'dspn-root',
            'data-state': 'empty',
            style: { display: 'none' },
          })
        }
        if (!layout || layout.hidden) {
          return React.createElement('div', {
            className: 'dspn-root',
            'data-state': 'waiting',
            style: { display: 'none' },
          })
        }

        const tipIndex = safeHover != null ? safeHover : tipExit

        return React.createElement('div', { className: 'dspn-root', 'data-state': stateAttr, 'data-theme': dark ? 'dark' : 'light' },
          React.createElement('div',
            {
              className: 'dspn-keys',
              style: { left: layout.left, top: layout.top, height: layout.height },
              onMouseLeave: () => setHover(null),
            },
            entries.map((entry, i) => {
              const y = layout.ys[i]
              if (y == null) return null
              const d = safeHover == null ? 4 : Math.min(Math.abs(i - safeHover), 4)
              const isActive = safeHover == null && i === layout.active
              const isHover = i === safeHover
              return React.createElement('button',
                {
                  key: entry.key + ':' + i,
                  type: 'button',
                  tabIndex: -1,
                  className: 'dspn-key' + (isActive ? ' dspn-key-active' : '') + (isHover ? ' dspn-key-hover' : ''),
                  'data-offset': String(d),
                  style: { top: y - KEY_HIT / 2 },
                  'aria-label': entry.userText,
                  onMouseEnter: () => setHover(i),
                  onFocus: () => setHover(i),
                  onClick: () => jumpTo(entry),
                },
                React.createElement('span', { className: 'dspn-key-bar' }),
              )
            }),
          ),
          tipIndex != null && entries[tipIndex] && layout.ys[tipIndex] != null
            ? React.createElement('div',
                {
                  className: 'dspn-tip' + (safeHover == null ? ' dspn-tip-leave' : ''),
                  style: { left: layout.left + KEY_MAX + TIP_GAP, top: layout.ys[tipIndex] },
                },
                entries[tipIndex].userText
                  ? React.createElement('div', { className: 'dspn-tip-user' }, entries[tipIndex].userText)
                  : null,
                entries[tipIndex].modelText
                  ? React.createElement('div', { className: 'dspn-tip-model' }, entries[tipIndex].modelText)
                  : null,
              )
            : null,
        )
      }

      const name = 'dsh-navigation-bar'
      const inject = ['slots', 'sessions']

      function apply(ctx) {
        ctxRef = ctx
        ensureCss()
        let dispose = null
        try {
          if (ctx.slots && typeof ctx.slots.inject === 'function') {
            dispose = ctx.slots.inject('shell.overlay', () => {
              try {
                window.__dspnNavDebug__.registered = true
              } catch (err) { /* ignore */ }
              return ctx.slots.register(
                { name: 'shell.overlay', id: PLUGIN_ID, order: 40 },
                PianoNavOverlay,
              )
            })
            try {
              window.__dspnNavDebug__.applied = true
            } catch (err) { /* ignore */ }
          } else {
            try { window.__dspnNavDebug__.applyError = 'no slots service' } catch (err) { /* ignore */ }
            console.warn('[dsh-navigation-bar] slots service unavailable — piano bar disabled')
          }
        } catch (err) {
          try { window.__dspnNavDebug__.applyError = String((err && err.message) || err) } catch (err2) { /* ignore */ }
          console.warn('[dsh-navigation-bar] shell.overlay registration failed:', err)
        }
        return () => {
          ctxRef = null
          if (dispose) dispose()
        }
      }


      return { name, inject, apply }
    },
  })
})()
