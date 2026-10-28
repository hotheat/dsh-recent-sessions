window.__ModuleLoader__.load({
  id: 'dsh-recent-sessions',
  factory: (require) => {
    const { useLayoutEffect, useMemo, useRef, useState } = require('react')
    const { createPortal } = require('react-dom')
    const { jsx, jsxs } = require('react/jsx-runtime')
    const { StateDot } = require('@deepseek-ai/dsh-client-ui-primitives')
    const NS = 'dsh-recent-sessions'
    const COLLAPSED_KEY = `${NS}:collapsed`
    const PAGE_SIZE = 10
    const zh = {
      recent: '最近', more: '展开更多', ungrouped: '未分组',
      now: '刚刚', minutes: '{n} 分钟前', hours: '{n} 小时前', days: '{n} 天前',
      months: '{n} 个月前', years: '{n} 年前', running: '运行中', waiting: '等待响应', done: '已完成未读',
    }
    const en = {
      recent: 'Recent', more: 'Show more', ungrouped: 'Ungrouped',
      now: 'Just now', minutes: '{n} min ago', hours: '{n} hr ago', days: '{n} days ago',
      months: '{n} months ago', years: '{n} years ago', running: 'Running', waiting: 'Waiting for response', done: 'Completed, unread',
    }

    // The controller exposes the durable title and its native display fallback.
    function deriveRecentRows({ list, workspaces, archivedSessionIds, status, ungroupedLabel }) {
      const archived = new Set(archivedSessionIds)
      const workspaceOf = new Map()
      for (const workspace of workspaces) {
        for (const id of workspace.sessionIds) {
          if (!workspaceOf.has(id)) workspaceOf.set(id, workspace.title)
        }
      }
      return list.ids
        .map(id => list.byId[id])
        .filter(session => !session.blank && session.origin !== 'subagent' && !archived.has(session.id))
        .map(session => {
          const live = status.get(session.id)
          return {
            id: session.id,
            title: session.title ?? session.displayTitle,
            workspace: workspaceOf.get(session.id) ?? session.cwd?.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ungroupedLabel,
            updatedAt: session.updatedAt,
            state: live?.pendingInteraction !== undefined ? 'warning'
              : (live?.running ?? session.running) === true ? 'ongoing'
                : live?.completionUnread === true ? 'done' : null,
          }
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }

    function pageRows(rows, limit = PAGE_SIZE) {
      return { rows: rows.slice(0, limit), hasMore: rows.length > limit }
    }

    function relativeTime(t, updatedAt, now) {
      const seconds = Math.max(0, (now - updatedAt) / 1000)
      for (const [unit, size] of [['years', 31536000], ['months', 2592000], ['days', 86400], ['hours', 3600], ['minutes', 60]]) {
        if (seconds >= size) return t(unit, { n: Math.floor(seconds / size) })
      }
      return t('now')
    }

    function resolveWorkspaceContainer(anchor) {
      const scope = anchor?.closest('[data-slot="sidebar"]')
      const group = scope?.querySelector('[class*="_groupSection"]')
      if (!group) return { scope, container: null, mode: 'hidden' }
      if (!group.parentElement) return { scope, container: anchor, mode: 'inline' }
      return { scope, container: group.parentElement, mode: 'tree' }
    }

    function mountRecentHost(host, { container, mode }) {
      host.classList.toggle('dsh-recent-inline', mode === 'inline')
      if (!container) {
        host.remove()
        return
      }
      if (host.parentElement !== container || container.lastChild !== host) {
        container.appendChild(host)
      }
    }

    function watchWorkspaceContainer(anchor, host) {
      let scope = null
      const sync = () => {
        const resolved = resolveWorkspaceContainer(anchor)
        if (resolved.scope !== scope) {
          observer.disconnect()
          scope = resolved.scope
          if (scope) observer.observe(scope, { childList: true, subtree: true })
        }
        mountRecentHost(host, resolved)
      }
      let frame = null
      const observer = new window.MutationObserver(() => {
        if (frame !== null) return
        frame = window.requestAnimationFrame(() => {
          frame = null
          sync()
        })
      })
      sync()
      return () => {
        observer.disconnect()
        if (frame !== null) window.cancelAnimationFrame(frame)
        host.remove()
      }
    }

    function loadCollapsed() {
      try {
        return window.localStorage.getItem(COLLAPSED_KEY) === 'true'
      } catch {
        return false
      }
    }

    const CSS = `
.dsh-recent-host { width: 100%; min-width: 0; }
.dsh-recent-section { box-sizing: border-box; width: 100%; padding: 0 0 4px; margin-top: 4px; min-width: 0; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.dsh-recent-section button { box-sizing: border-box; display: flex; align-items: center; width: 100%; height: 32px; margin: 0; padding: 0 8px; border: 0; border-radius: var(--dsw-radius-md); background: transparent; color: inherit; font-family: inherit; font-size: 14px; font-weight: inherit; line-height: 20px; text-align: left; cursor: pointer; }
.dsh-recent-section .dsh-recent-header, .dsh-recent-section .dsh-recent-more { color: var(--dsw-alias-label-tertiary); }
.dsh-recent-section .dsh-recent-header { gap: 6px; font-size: 12px; }
.dsh-recent-header svg { width: 12px; height: 12px; flex: none; }
.dsh-recent-section button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-recent-section button:focus-visible { outline: 1px solid currentColor; outline-offset: -1px; }
.dsh-recent-row { gap: 4px; }
.dsh-recent-slot { flex: none; width: 16px; height: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }
.dsh-recent-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-recent-inline { max-height: min(40vh, 384px); overflow-y: auto; }
`

    function ensureStyle() {
      const existing = document.getElementById('dsh-recent-style')
      if (existing) {
        if (existing.textContent === CSS) return
        existing.remove()
      }
      const style = document.createElement('style')
      style.id = 'dsh-recent-style'
      style.textContent = CSS
      document.head.append(style)
    }

    function WideRecentSessions({ useSessions, useSessionStatus, useWorkspaces, t, openSession }) {
      const list = useSessions(state => state)
      const status = useSessionStatus(state => state)
      const workspace = useWorkspaces(state => state)
      const ungroupedLabel = t('ungrouped')
      const rows = useMemo(() => deriveRecentRows({
        list, status, workspaces: workspace.items,
        archivedSessionIds: workspace.archivedSessionIds, ungroupedLabel,
      }), [list, status, workspace, ungroupedLabel])
      const [collapsed, setCollapsed] = useState(loadCollapsed)
      const [limit, setLimit] = useState(PAGE_SIZE)
      const [host] = useState(() => {
        const element = document.createElement('div')
        element.className = 'dsh-recent-host'
        return element
      })
      const [now, setNow] = useState(() => Date.now())
      const anchor = useRef(null)
      const present = rows.length > 0

      useLayoutEffect(ensureStyle, [])
      useLayoutEffect(() => {
        if (!present) return
        return watchWorkspaceContainer(anchor.current, host)
      }, [present, host])

      if (!present) return null
      const page = pageRows(rows, limit)
      const toggle = () => {
        const next = !collapsed
        setCollapsed(next)
        try {
          window.localStorage.setItem(COLLAPSED_KEY, String(next))
        } catch {
          // Storage may be unavailable; the choice still applies to this mount.
        }
      }
      const content = jsxs('section', {
        className: 'dsh-recent-section',
        'aria-label': t('recent'),
        children: [
          jsxs('button', {
            type: 'button', className: 'dsh-recent-header', onClick: toggle,
            'aria-expanded': !collapsed,
            children: [t('recent'), jsx('svg', {
              viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
              children: jsx('path', { d: collapsed ? 'M6 4L10 8L6 12' : 'M4 6L8 10L12 6', stroke: 'currentColor', strokeWidth: 1.2 }),
            })],
          }),
          !collapsed && page.rows.map(row => jsxs('button', {
            type: 'button', className: 'dsh-recent-row',
            title: `${row.workspace} · ${relativeTime(t, row.updatedAt, now)}`,
            'aria-label': row.state === null ? undefined : `${row.title}，${t(row.state === 'warning' ? 'waiting' : row.state === 'ongoing' ? 'running' : 'done')}`,
            onMouseEnter: () => setNow(Date.now()),
            onFocus: () => setNow(Date.now()),
            onClick: () => openSession(row.id),
            children: [
              jsx('span', {
                className: 'dsh-recent-slot',
                children: row.state === null ? null : jsx(StateDot, { state: row.state }),
              }),
              jsx('span', { className: 'dsh-recent-title', children: row.title }),
            ],
          }, row.id)),
          !collapsed && page.hasMore && jsx('button', {
            type: 'button', className: 'dsh-recent-more', onClick: () => setLimit(value => value + PAGE_SIZE),
            children: t('more'),
          }),
        ],
      })
      return jsx('div', {
        ref: anchor, style: { display: 'contents' },
        children: createPortal(content, host),
      })
    }

    function RecentSessions(props) {
      return props.wide ? jsx(WideRecentSessions, props) : null
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'recent-sessions: dictionaries')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action', id: 'recent-sessions', order: 30, locale: NS,
        inject: () => ({ openSession: id => ctx.uiWorkspace.openSession(id) }),
      }, RecentSessions))
    }

    return {
      apply, inject: ['slots', 'locale', 'uiSession', 'uiWorkspace'],
      deriveRecentRows, pageRows, relativeTime, resolveWorkspaceContainer, mountRecentHost, watchWorkspaceContainer, ensureStyle,
    }
  },
})
