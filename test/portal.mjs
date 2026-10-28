import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClient } from './support.mjs'

test('ensureStyle replaces stale CSS and skips identical CSS', () => {
  const styles = []
  let created = 0, appended = 0
  const document = {
    getElementById: id => styles.find(style => style.id === id) ?? null,
    createElement(tag) {
      assert.equal(tag, 'style')
      created++
      return {
        id: '', textContent: '',
        remove() { styles.splice(styles.indexOf(this), 1) },
      }
    },
    head: { append(style) { styles.push(style); appended++ } },
  }
  const stale = document.createElement('style')
  stale.id = 'dsh-recent-style'
  stale.textContent = '/* stale CSS */'
  document.head.append(stale)
  const { plugin } = loadClient({}, { document })

  plugin.ensureStyle()
  assert.equal(styles.length, 1)
  const current = styles[0]
  assert.notEqual(current, stale)
  assert.equal(current.id, 'dsh-recent-style')
  assert.match(current.textContent, /\.dsh-recent-host/)
  assert.equal(created, 2)
  assert.equal(appended, 2)

  plugin.ensureStyle()
  assert.deepEqual(styles, [current])
  assert.equal(created, 2, 'identical CSS must not create another node')
  assert.equal(appended, 2, 'identical CSS must not be appended again')
})

function fixture() {
  const moved = []
  function node(name) {
    const classes = new Set()
    return {
      name, parentElement: null, children: [],
      classList: {
        toggle(value, on) { if (on) classes.add(value); else classes.delete(value) },
        contains: value => classes.has(value),
      },
      get lastChild() { return this.children.at(-1) ?? null },
      appendChild(child) {
        child.remove()
        this.children.push(child)
        child.parentElement = this
        moved.push(child)
        return child
      },
      remove() {
        const parent = this.parentElement
        if (parent) parent.children.splice(parent.children.indexOf(this), 1)
        this.parentElement = null
      },
    }
  }
  const scope = node('sidebar')
  let groups = [], queries = 0
  scope.querySelector = selector => {
    assert.equal(selector, '[class*="_groupSection"]')
    queries++
    return groups[0] ?? null
  }
  const anchor = node('footer anchor')
  anchor.closest = selector => {
    assert.equal(selector, '[data-slot="sidebar"]')
    return scope
  }
  const container = node('tree list')
  container.clientHeight = 600
  container.scrollHeight = 272
  scope.appendChild(container)
  scope.appendChild(anchor)
  for (let i = 0; i < 8; i++) {
    const group = node(`group ${i}`)
    container.appendChild(group)
    groups.push(group)
  }
  const host = node('plugin host')
  const section = node('React section')
  host.appendChild(section)
  moved.length = 0
  return {
    node, scope, anchor, container, host, section, moved,
    setGroups: value => { groups = value },
    queries: () => queries,
  }
}

function runtime() {
  const observers = [], frames = new Map(), canceled = []
  let nextFrame = 0
  const { plugin } = loadClient({}, {
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe(scope, options) {
        this.scope = scope
        this.options = options
        this.observeCount = (this.observeCount ?? 0) + 1
      }
      disconnect() {
        this.disconnected = true
        this.disconnectCount = (this.disconnectCount ?? 0) + 1
      }
    },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame(id) { frames.delete(id); canceled.push(id) },
  })
  return {
    ...plugin, observers, frames, canceled,
    flushFrame() {
      const batch = [...frames.values()]
      frames.clear()
      for (const callback of batch) callback()
    },
  }
}

test('8 non-overflowing groups still resolve to the first group parent', () => {
  const f = fixture(), r = runtime()
  assert.ok(f.container.scrollHeight < f.container.clientHeight)
  assert.deepEqual(r.resolveWorkspaceContainer(f.anchor), {
    scope: f.scope, container: f.container, mode: 'tree',
  })
  // Group structure alone is authoritative, even if layout metrics are unavailable.
  Object.defineProperty(f.container, 'scrollHeight', { get() { throw Error('must not read layout') } })
  Object.defineProperty(f.container, 'clientHeight', { get() { throw Error('must not read layout') } })
  assert.equal(r.resolveWorkspaceContainer(f.anchor).container, f.container)
})

test('flat/search/changed structures without groups hide; a missing sidebar also hides', () => {
  const f = fixture(), r = runtime()
  for (const mode of ['flat', 'search', 'changed']) {
    f.setGroups([])
    const resolved = r.resolveWorkspaceContainer(f.anchor)
    assert.equal(resolved.mode, 'hidden', mode)
    assert.equal(resolved.container, null)
    r.mountRecentHost(f.host, resolved)
    assert.equal(f.host.parentElement, null)
    assert.equal(f.anchor.children.length, 0)
  }
  assert.equal(r.resolveWorkspaceContainer({ closest: () => null }).mode, 'hidden')
  assert.equal(r.resolveWorkspaceContainer(null).mode, 'hidden')
})

test('only a group with no parent falls back to the footer with inline scrolling', () => {
  const f = fixture(), r = runtime()
  f.setGroups([{ parentElement: null }])
  const resolved = r.resolveWorkspaceContainer(f.anchor)
  assert.deepEqual(resolved, { scope: f.scope, container: f.anchor, mode: 'inline' })
  r.mountRecentHost(f.host, resolved)
  assert.equal(f.anchor.lastChild, f.host)
  assert.equal(f.host.classList.contains('dsh-recent-inline'), true)
  f.setGroups([{ parentElement: f.container }])
  r.mountRecentHost(f.host, r.resolveWorkspaceContainer(f.anchor))
  assert.equal(f.host.parentElement, f.container)
  assert.equal(f.host.classList.contains('dsh-recent-inline'), false)
})

test('mount, reordering and replacement only move host; React children retain their parent', () => {
  const f = fixture(), r = runtime()
  const originalGroups = [...f.container.children]
  const stop = r.watchWorkspaceContainer(f.anchor, f.host)
  assert.equal(f.container.lastChild, f.host)
  assert.deepEqual(f.container.children.slice(0, -1), originalGroups)
  assert.equal(f.section.parentElement, f.host)
  const count = f.moved.length
  r.observers[0].callback()
  r.flushFrame()
  assert.equal(f.moved.length, count, 'same last-child placement is a no-op')

  const native = f.node('new native group')
  f.container.appendChild(native)
  f.moved.length = 0
  r.observers[0].callback()
  r.flushFrame()
  assert.equal(f.container.lastChild, f.host)
  assert.deepEqual(f.moved, [f.host])
  assert.deepEqual(f.container.children.slice(0, -1), [...originalGroups, native])

  const replacement = f.node('replacement list')
  f.setGroups([{ parentElement: replacement }])
  f.moved.length = 0
  r.observers[0].callback()
  r.flushFrame()
  assert.equal(f.host.parentElement, replacement)
  assert.deepEqual(f.moved, [f.host])
  assert.equal(f.section.parentElement, f.host)
  assert.deepEqual(f.host.children, [f.section])
  stop()
  assert.equal(f.host.parentElement, null)
  assert.equal(f.section.parentElement, f.host, 'React still owns children inside the detached host')
})

test('observe sidebar childList only; bursts coalesce into one resolution per animation frame', () => {
  const f = fixture(), r = runtime()
  const stop = r.watchWorkspaceContainer(f.anchor, f.host)
  assert.equal(r.observers.length, 1)
  const observer = r.observers[0]
  assert.equal(observer.scope, f.scope)
  assert.deepEqual(observer.options, { childList: true, subtree: true })
  const before = f.queries()
  observer.callback()
  observer.callback()
  observer.callback()
  assert.equal(r.frames.size, 1)
  assert.equal(f.queries(), before, 'mutation callback does no immediate query')
  r.flushFrame()
  assert.equal(f.queries(), before + 1)
  assert.equal(r.frames.size, 0)
  observer.callback()
  assert.equal(r.frames.size, 1)
  stop()
  assert.equal(observer.disconnected, true)
  assert.equal(r.frames.size, 0)
  assert.equal(r.canceled.length, 1)
  r.flushFrame()
  assert.equal(f.queries(), before + 1, 'disconnect cancels the pending resolution')
  assert.equal(f.host.parentElement, null)
})

test('observer handles tree -> hidden -> abnormal fallback -> tree without touching React children', () => {
  const f = fixture(), r = runtime()
  const stop = r.watchWorkspaceContainer(f.anchor, f.host)
  const observer = r.observers[0]
  f.setGroups([])
  observer.callback()
  r.flushFrame()
  assert.equal(f.host.parentElement, null)
  assert.equal(f.section.parentElement, f.host)
  f.setGroups([{ parentElement: null }])
  observer.callback()
  r.flushFrame()
  assert.equal(f.host.parentElement, f.anchor)
  assert.equal(f.host.classList.contains('dsh-recent-inline'), true)
  f.setGroups([{ parentElement: f.container }])
  observer.callback()
  r.flushFrame()
  assert.equal(f.host.parentElement, f.container)
  assert.equal(f.host.classList.contains('dsh-recent-inline'), false)
  assert.equal(f.section.parentElement, f.host)
  assert.ok(f.moved.every(node => node === f.host))
  stop()
})

test('sidebar scope replacement rebinds observation once and follows subsequent mutations', () => {
  const f = fixture(), replacement = fixture(), r = runtime()
  const stop = r.watchWorkspaceContainer(f.anchor, f.host)
  const observer = r.observers[0]
  const beforeDisconnect = observer.disconnectCount ?? 0
  f.anchor.closest = () => replacement.scope
  observer.callback()
  r.flushFrame()
  assert.equal(observer.scope, replacement.scope)
  assert.equal(observer.observeCount, 2)
  assert.equal(observer.disconnectCount, beforeDisconnect + 1)
  assert.equal(f.host.parentElement, replacement.container)
  assert.equal(f.section.parentElement, f.host)

  const moved = replacement.moved.length
  observer.callback()
  r.flushFrame()
  assert.equal(observer.observeCount, 2, 'unchanged scope must not be observed again')
  assert.equal(observer.disconnectCount, beforeDisconnect + 1)
  assert.equal(replacement.moved.length, moved, 'unchanged placement must not move the host')
  assert.equal(r.frames.size, 0)

  replacement.setGroups([])
  observer.callback()
  r.flushFrame()
  assert.equal(f.host.parentElement, null, 'new sidebar mutations still update placement')
  stop()
})
