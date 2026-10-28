import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClient } from './support.mjs'

const { deriveRecentRows, pageRows, relativeTime } = loadClient().plugin
const session = (id, updatedAt = 0, extra = {}) => ({
  id, title: `title:${id}`, displayTitle: `fallback:${id}`, updatedAt,
  blank: false, running: false, ...extra,
})
function derive(sessions, overrides = {}) {
  return deriveRecentRows({
    list: { ids: sessions.map(s => s.id), byId: Object.fromEntries(sessions.map(s => [s.id, s])) },
    workspaces: [], archivedSessionIds: [], status: new Map(), ungroupedLabel: '未分组', ...overrides,
  })
}

test('empty catalog and empty page', () => {
  assert.deepEqual(derive([]), [])
  assert.deepEqual(pageRows([]), { rows: [], hasMore: false })
})
test('all blank sessions are removed', () => {
  assert.deepEqual(derive([session('a', 9, { blank: true }), session('b', 10, { blank: true })]), [])
})
test('archived sessions are removed across workspaces', () => {
  assert.deepEqual(derive([session('a'), session('b')], { archivedSessionIds: ['a', 'b'] }), [])
})
test('subagent sessions are removed', () => {
  assert.deepEqual(derive([session('a', 1, { origin: 'subagent' })]), [])
})
test('filter before sorting and paging; strictly newest first even when older sessions run', () => {
  const rows = derive([
    session('old-running', 1, { running: true }), session('newest', 30), session('middle', 20),
    session('blank', 100, { blank: true }), session('archived', 200), session('child', 300, { origin: 'subagent' }),
  ], { archivedSessionIds: ['archived'] })
  assert.deepEqual(rows.map(r => r.id), ['newest', 'middle', 'old-running'])
  assert.deepEqual(pageRows(rows, 2).rows.map(r => r.id), ['newest', 'middle'])
})
test('equal timestamps retain source order; input is unchanged', () => {
  const input = [session('z', 0), session('a', 0), session('m', 0)]
  const before = structuredClone(input)
  assert.deepEqual(derive(input).map(r => r.id), ['z', 'a', 'm'])
  assert.deepEqual(input, before)
})
test('durable title wins; absent title uses native displayTitle; workspace tooltip labels', () => {
  const rows = derive([session('a', 3), session('b', 2, { title: undefined, cwd: '/projects/b/' }), session('c', 1)], {
    workspaces: [{ title: '项目 A', sessionIds: ['a'] }],
  })
  assert.equal(rows[0].title, 'title:a')
  assert.equal(rows[0].workspace, '项目 A')
  assert.equal(rows[1].title, 'fallback:b')
  assert.equal(rows[1].workspace, 'b')
  assert.equal(rows[2].workspace, '未分组')
})
test('native state priority: pending interaction, running, unread completion, idle', () => {
  for (const pendingInteraction of ['approval', 'question', 'plan-review', null]) {
    const [row] = derive([session('a', 0, { running: true })], {
      status: new Map([['a', { pendingInteraction, running: true, completionUnread: true }]]),
    })
    assert.equal(row.state, 'warning')
  }
  for (const [live, running, expected] of [
    [{ running: true, completionUnread: true }, false, 'ongoing'],
    [{ completionUnread: true }, true, 'ongoing'],
    [undefined, true, 'ongoing'],
    [{ running: false, completionUnread: true }, true, 'done'],
    [{ running: false }, true, null],
    [{ completionUnread: true }, false, 'done'],
    [undefined, false, null],
  ]) {
    const [row] = derive([session('a', 0, { running })], { status: new Map([['a', live]]) })
    assert.equal(row.state, expected)
  }
})
test('pagination: under, exactly, and over 10; grow by 10 and hide final more row', () => {
  const rows = derive(Array.from({ length: 21 }, (_, i) => session(String(i), i)))
  assert.equal(pageRows(rows.slice(0, 9)).hasMore, false)
  assert.equal(pageRows(rows.slice(0, 10)).hasMore, false)
  assert.equal(pageRows(rows).rows.length, 10)
  assert.equal(pageRows(rows).hasMore, true)
  assert.equal(pageRows(rows, 20).rows.length, 20)
  assert.equal(pageRows(rows, 20).hasMore, true)
  assert.equal(pageRows(rows, 30).rows.length, 21)
  assert.equal(pageRows(rows, 30).hasMore, false)
  assert.deepEqual(pageRows(rows, 0), { rows: [], hasMore: true })
})
test('relative time boundaries and future clock skew', () => {
  const t = (key, vars) => vars ? `${key}:${vars.n}` : key
  assert.equal(relativeTime(t, 1000, 0), 'now')
  assert.equal(relativeTime(t, 0, 59000), 'now')
  assert.equal(relativeTime(t, 0, 60000), 'minutes:1')
  assert.equal(relativeTime(t, 0, 3600000), 'hours:1')
  assert.equal(relativeTime(t, 0, 86400000), 'days:1')
})

test('native row slots render StateDot only for active states and label row buttons accessibly', () => {
  const effects = [], styles = []
  const element = (type, props) => ({ type, props })
  const StateDot = () => {}
  const { plugin } = loadClient({
    react: {
      useLayoutEffect: effect => effects.push(effect), useMemo: compute => compute(),
      useRef: () => ({ current: null }),
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    },
    'react-dom': { createPortal: content => content },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    '@deepseek-ai/dsh-client-ui-primitives': { StateDot },
  }, {
    localStorage: { getItem: () => null },
    document: {
      createElement: () => ({}), getElementById: () => null,
      head: { append: style => styles.push(style.textContent) },
    },
  })
  let Component, dictionaries
  plugin.apply({
    effect: effect => effect(),
    locale: { register: (_ns, value) => { dictionaries = value } },
    slots: {
      inject: (_name, effect) => effect(),
      register: (_options, component) => { Component = component },
    },
  })
  const sessions = ['warning', 'ongoing', 'done', 'idle'].map(id => session(id))
  const list = { ids: sessions.map(s => s.id), byId: Object.fromEntries(sessions.map(s => [s.id, s])) }
  const status = new Map([
    ['warning', { pendingInteraction: 'question', running: true, completionUnread: true }],
    ['ongoing', { running: true, completionUnread: true }],
    ['done', { completionUnread: true }],
  ])
  for (const locale of ['zh', 'en']) {
    const wide = Component({
      wide: true, useSessions: select => select(list), useSessionStatus: select => select(status),
      useWorkspaces: select => select({ items: [], archivedSessionIds: [] }),
      t: key => dictionaries[locale][key], openSession: () => {},
    })
    const rows = wide.type(wide.props).props.children.props.children[1]
    assert.equal(rows.length, 4)
    rows.forEach((row, index) => {
      assert.equal(row.props.className, 'dsh-recent-row')
      const [slot, title] = row.props.children
      assert.equal(slot.type, 'span')
      assert.equal(slot.props.className, 'dsh-recent-slot')
      assert.equal(title.props.className, 'dsh-recent-title')
      assert.equal(title.props.children, `title:${sessions[index].id}`)
      assert.equal(row.props.title, `${dictionaries[locale].ungrouped} · ${relativeTime(key => dictionaries[locale][key], sessions[index].updatedAt, Date.now())}`)
      const assertNoHiddenStatus = node => {
        if (!node || typeof node !== 'object') return
        assert.notEqual(node.props?.className, 'dsh-recent-sr-only')
        const children = node.props?.children
        for (const child of Array.isArray(children) ? children : [children]) assertNoHiddenStatus(child)
      }
      assertNoHiddenStatus(row)
      if (index === 3) {
        assert.equal(slot.props.children, null, 'idle leaves an empty slot')
        assert.equal(row.props['aria-label'], undefined, 'idle uses its visible title as accessible name')
      } else {
        const dot = slot.props.children
        assert.equal(dot.type, StateDot)
        assert.equal(dot.props.state, sessions[index].id)
        assert.equal(row.props['aria-label'], `${title.props.children}，${dictionaries[locale][['waiting', 'running', 'done'][index]]}`)
      }
    })
  }
  effects[0]()
  const css = styles[0]
  assert.match(css, /\.dsh-recent-slot \{[^}]*width: 16px;[^}]*height: 20px;/)
  assert.match(css, /\.dsh-recent-row \{ gap: 4px; \}/)
  assert.match(css, /\.dsh-recent-section \{[^}]*padding: 0 0 4px;[^}]*margin-top: 4px;/)
  assert.match(css, /\.dsh-recent-section button \{[^}]*height: 32px;[^}]*padding: 0 8px;/)
  assert.match(css, /\.dsh-recent-title \{ flex: 1; min-width: 0;/)
  assert.doesNotMatch(css, /dsh-recent-sr-only|dsh-recent-dot|dsh-recent-breathe|@keyframes/)
})
