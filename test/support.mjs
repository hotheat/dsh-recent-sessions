import { readFileSync } from 'node:fs'

export function loadClient(modules = {}, browser = {}) {
  let entry
  const window = { ...browser, __ModuleLoader__: { load: value => { entry = value } } }
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  Function('window', 'document', source)(window, browser.document)
  const requested = []
  const plugin = entry.factory(name => {
    requested.push(name)
    return modules[name] ?? {}
  })
  return { entry, plugin, requested }
}
