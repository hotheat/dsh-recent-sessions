import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadClient } from './support.mjs'
import * as host from '../lib/index.js'

const { entry, plugin, requested } = loadClient()
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
assert.equal(entry.id, manifest.name)
assert.equal(entry.id, 'dsh-recent-sessions')
assert.equal(typeof plugin.apply, 'function')
assert.deepEqual(plugin.inject, ['slots', 'locale', 'uiSession', 'uiWorkspace'])
assert.deepEqual(requested, ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'])
assert.deepEqual(Object.keys(host), ['apply'])
assert.equal(host.apply(), undefined)
assert.equal(manifest.private, true)
assert.equal(manifest.engines.dsh, '>=0.2.1-rc.2')
assert.equal(manifest.dsh.client.platform, 'web')
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.deepEqual(manifest.dsh.client.inject, [
  'locale', 'ui-primitives', 'ui-renderer', 'ui-slots', 'ui-layout', 'ui-sidebar', 'ui-session', 'ui-workspace',
].map(owner => `@deepseek-ai/dsh-client-${owner}`))
assert.match(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), /^- insert:\n    - id: recent-sessions\n      name: dsh-recent-sessions\n$/)

const calls = []
const opened = []
const ctx = {
  effect: callback => callback(),
  locale: { register: (ns, dictionaries) => { calls.push(['locale', ns, dictionaries]) } },
  slots: {
    inject(name, callback) { calls.push(['inject', name]); callback() },
    register(options, component) { calls.push(['register', options, component]) },
  },
  uiWorkspace: { openSession: id => opened.push(id) },
}
plugin.apply(ctx)
assert.equal(calls[0][0], 'locale')
assert.equal(calls[0][1], entry.id)
assert.equal(calls[0][2].zh.recent, '最近')
assert.equal(calls[0][2].en.recent, 'Recent')
assert.deepEqual(Object.keys(calls[0][2].zh), Object.keys(calls[0][2].en))
assert.deepEqual(calls[1], ['inject', 'sidebar.footer.action'])
const [, options, Component] = calls[2]
assert.equal(options.name, 'sidebar.footer.action')
assert.equal(options.id, 'recent-sessions')
assert.equal(options.order, 30)
assert.equal(options.locale, entry.id)
options.inject().openSession('session-1')
assert.deepEqual(opened, ['session-1'])
assert.equal(Component({ wide: false }), null, 'rail renders nothing and calls no hooks')
console.log('dsh-recent-sessions client load test: ok')
