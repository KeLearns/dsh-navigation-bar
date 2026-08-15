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
      const CSS_VERSION = '0.1.0'

      // Geometry (from the reference-image analysis; px)
      const KEY_MAX = 56   // hovered key length
      const KEY_BASE = 14  // shortest key length
      const ACTIVE_LEN = 20
      const KEY_HIT = 18   // hit area height (visual bar is 3px)
      const BAR_LEFT_OFFSET = 6
      const PAD = 10
      const MIN_PITCH = 7
      const TIP_GAP = 10
      const TIP_WIDTH = 280
      const LADDER = [KEY_MAX, 36, 26, 17] // offsets 0..3; >=4 uses base

      let ctxRef = null

      // ── self-injected styles (versioned, self-healing) ──
      const CSS_LINES = [
        '.dspn-root{position:absolute;inset:0;pointer-events:none;z-index:30;',
        '--dspn-key-base:#9CA3AF;--dspn-key-active:#3B82F6;--dspn-key-hover:#374151;',
        '--dspn-key-n1:#6B7280;--dspn-key-n2:#8E939B;--dspn-key-n3:#9CA3AF;',
        '--dspn-glow:0 0 0 rgba(0,0,0,0);',
        '--dspn-tip-bg:#FFFFFF;--dspn-tip-border:#E5E7EB;--dspn-tip-shadow:0 2px 10px rgba(0,0,0,.12);',
        '--dspn-tip-user:#111827;--dspn-tip-model:#6B7280}',
        '.dspn-root[data-theme="dark"]{',
        '--dspn-key-base:rgba(160,160,185,.35);--dspn-key-active:#60A5FA;--dspn-key-hover:rgba(220,220,240,.95);',
        '--dspn-key-n1:rgba(175,175,200,.60);--dspn-key-n2:rgba(165,165,190,.45);--dspn-key-n3:rgba(160,160,185,.40);',
        '--dspn-glow:0 0 6px rgba(220,220,240,.25);',
        '--dspn-tip-bg:#282938;--dspn-tip-border:#3A3B4A;--dspn-tip-shadow:0 2px 12px rgba(0,0,0,.35);',
        '--dspn-tip-user:#D8D8E8;--dspn-tip-model:#9898A8}',
        '.dspn-keys{position:absolute;pointer-events:auto;width:' + (KEY_MAX + 8) + 'px;overflow:visible}',
        '.dspn-key{position:absolute;left:0;width:' + (KEY_MAX + 8) + 'px;height:' + KEY_HIT + 'px;padding:0;margin:0;border:0;background:transparent;cursor:pointer;display:block;transform:translateY(-' + (KEY_HIT / 2) + 'px);outline:none}',
        '.dspn-key-bar{position:absolute;left:0;top:50%;margin-top:-1.5px;height:3px;border-radius:2px;background:var(--dspn-key-base);width:' + KEY_BASE + 'px;transition:width .25s ease-out,background-color .2s ease-out,box-shadow .2s ease-out}',
        '.dspn-key[data-offset="0"] .dspn-key-bar{width:' + LADDER[0] + 'px;background:var(--dspn-key-hover);box-shadow:var(--dspn-glow)}',
        '.dspn-key[data-offset="1"] .dspn-key-bar{width:' + LADDER[1] + 'px;background:var(--dspn-key-n1)}',
        '.dspn-key[data-offset="2"] .dspn-key-bar{width:' + LADDER[2] + 'px;background:var(--dspn-key-n2)}',
        '.dspn-key[data-offset="3"] .dspn-key-bar{width:' + LADDER[3] + 'px;background:var(--dspn-key-n3)}',
        '.dspn-key-active .dspn-key-bar{background:var(--dspn-key-active);width:' + ACTIVE_LEN + 'px}',
        '.dspn-key-active .dspn-key-bar::after{content:"";position:absolute;left:-3px;top:50%;width:5px;height:5px;border-radius:50%;background:var(--dspn-key-active);transform:translateY(-50%)}',
        '.dspn-tip{position:absolute;transform:translateY(-50%);width:' + TIP_WIDTH + 'px;max-width:' + TIP_WIDTH + 'px;box-sizing:border-box;background:var(--dspn-tip-bg);border:1px solid var(--dspn-tip-border);border-radius:10px;box-shadow:var(--dspn-tip-shadow);padding:10px 12px;pointer-events:none;font-family:var(--dsw-font-family,inherit);animation:dspn-tip-in .15s ease-out}',
        '.dspn-tip-user{font-size:13px;line-height:18px;font-weight:600;color:var(--dspn-tip-user);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dspn-tip-model{margin-top:4px;font-size:12px;line-height:18px;font-weight:400;color:var(--dspn-tip-model);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
        '@keyframes dspn-tip-in{from{opacity:0;transform:translateY(-50%) translateX(-4px)}to{opacity:1;transform:translateY(-50%) translateX(0)}}',
        '@media (prefers-reduced-motion:reduce){.dspn-key-bar{transition:none}.dspn-tip{animation:none}}',
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

      /** One piano entry per user message; model text = following assistant text blocks. */
      const buildEntries = (snapshot) => {
        if (!snapshot || typeof snapshot !== 'object') return []
        const entries = []
        let cur = null
        const nodes = []
        const chat = snapshot.chat
        if (chat && Array.isArray(chat.order) && chat.nodes && typeof chat.nodes.get === 'function') {
          for (const key of chat.order) {
            const node = chat.nodes.get(key)
            if (node) nodes.push(node)
          }
        }
        const source = nodes.length > 0 ? nodes : (Array.isArray(snapshot.nodes) ? snapshot.nodes : [])
        for (const node of source) {
          if (!node || typeof node !== 'object') continue
          const kind = node.kind
          if (kind === 'user') {
            const data = node.data && typeof node.data === 'object' && node.data.kind === 'user' ? node.data : node
            const userText = textOfBlocks(data.content)
            cur = {
              key: typeof node.key === 'string' ? node.key : ('u' + (data.seq !== undefined ? data.seq : entries.length)),
              userText: userText || (data.content && data.content.length ? '[附件消息]' : '…'),
              modelText: '',
            }
            entries.push(cur)
          } else if (kind === 'assistant' && cur) {
            const data = node.data && typeof node.data === 'object' ? node.data : node
            const blocks = Array.isArray(data.blocks) ? data.blocks : null
            if (blocks) {
              for (const b of blocks) {
                if (b && b.kind === 'text' && typeof b.text === 'string' && b.text.trim()) {
                  cur.modelText = (cur.modelText ? cur.modelText + ' ' : '') + b.text.replace(/\s+/g, ' ').trim()
                }
              }
            }
          }
        }
        return entries
      }

      const noopSub = () => () => {}
      const noopSnap = () => null

      // ── the overlay component ──
      function PianoNavOverlay(props) {
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
          const scrollTop = sp.scrollTop
          const scrollH = Math.max(1, sp.scrollHeight)
          const rowMap = new Map()
          for (const row of sp.querySelectorAll('[data-chat-anchor-key]')) rowMap.set(row.dataset.chatAnchorKey, row)

          const ys = new Array(list.length).fill(null)
          let matched = 0
          let active = list.length - 1
          let found = false
          for (let i = 0; i < list.length; i++) {
            const row = rowMap.get(list[i].key)
            if (!row) continue
            matched++
            const rr = row.getBoundingClientRect()
            const contentY = rr.top - spRect.top + scrollTop
            const center = Math.min(contentY + Math.min(Math.max(rr.height, 1), 240) / 2, scrollH)
            let y = top + (center / scrollH) * height
            y = Math.max(top + 4, Math.min(top + height - 4, y))
            ys[i] = y
            if (!found && rr.bottom > spRect.top + 8) {
              active = i
              found = true
            }
          }
          if (matched === 0) {
            // degraded fallback: even spacing + scroll-proportional active
            const n = list.length
            for (let i = 0; i < n; i++) ys[i] = top + ((i + 0.5) / n) * height
            active = Math.min(n - 1, Math.max(0, Math.round(((scrollTop + spRect.height / 2) / scrollH) * n)))
            found = true
          }
          if (!found) active = list.length - 1
          // enforce minimum pitch so dense conversations stay readable
          let lastY = -Infinity
          for (let i = 0; i < ys.length; i++) {
            if (ys[i] == null) continue
            if (ys[i] - lastY < MIN_PITCH) ys[i] = Math.min(top + height - 4, lastY + MIN_PITCH)
            lastY = ys[i]
          }
          const next = {
            hidden: false,
            left: Math.round(left * 2) / 2,
            top: Math.round(top * 2) / 2,
            height: Math.round(height),
            ys: ys.map((y) => (y == null ? null : Math.round(y * 2) / 2)),
            active,
          }
          // one-shot console diagnostics (never affect rendering)
          if (!next.hidden && !visibleLoggedRef.current) {
            visibleLoggedRef.current = true
            console.info('[dsh-navigation-bar] piano bar visible: entries=' + list.length + ' rows=' + matched)
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

        if (!layout || layout.hidden || entries.length === 0) return null

        return React.createElement('div', { className: 'dspn-root', 'data-theme': dark ? 'dark' : 'light' },
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
          safeHover != null && entries[safeHover] && layout.ys[safeHover] != null
            ? React.createElement('div',
                {
                  className: 'dspn-tip',
                  style: { left: layout.left + KEY_MAX + TIP_GAP, top: layout.ys[safeHover] },
                },
                React.createElement('div', { className: 'dspn-tip-user' }, entries[safeHover].userText),
                entries[safeHover].modelText
                  ? React.createElement('div', { className: 'dspn-tip-model' }, entries[safeHover].modelText)
                  : null,
              )
            : null,
        )
      }

      const name = 'dsh-navigation-bar'
      const inject = ['slots']

      function apply(ctx) {
        ctxRef = ctx
        ensureCss()
        let dispose = null
        try {
          if (ctx.slots && typeof ctx.slots.inject === 'function') {
            dispose = ctx.slots.inject('shell.overlay', () =>
              ctx.slots.register(
                { name: 'shell.overlay', id: PLUGIN_ID, order: 40 },
                PianoNavOverlay,
              ),
            )
          } else {
            console.warn('[dsh-navigation-bar] slots service unavailable — piano bar disabled')
          }
        } catch (err) {
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
