import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await fs.readFile(new URL('../client.js', import.meta.url), 'utf8')

test('client module registers unchanged slots and loads without top-level failures', () => {
  let registration
  const window = { __ModuleLoader__: { load(value) { registration = value } } }
  vm.runInNewContext(source, { window, console })
  assert.equal(registration.id, '@local/dsh-schedule-center')
  const noop = () => {}
  const React = { createElement: noop, useCallback: noop, useEffect: noop, useMemo: noop, useRef: noop, useState: noop }
  const plugin = registration.factory((name) => { assert.equal(name, 'react'); return React })
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'uiWorkspace'])
  assert.equal(typeof plugin.apply, 'function')
})

test('new task UI keeps prompt default and chooses only registered business actions', () => {
  assert(source.includes("const [taskType, setTaskType] = useState('prompt')"))
  assert(source.includes("taskType === 'business' && !chosenAction"))
  assert(source.includes("type: taskType"))
  assert(source.includes("actionId: taskType === 'business' ? actionId : undefined"))
  assert(source.includes("permission: taskType === 'prompt' ? permission : undefined"))
  assert(source.includes('businessActions'))
  assert(source.includes('function TaskCard({ task, now, t,')) // preserve user's t fix
})

test('business result rendering has true partial/blocked states and safe report links', () => {
  for (const state of ['partial', 'blocked', 'interrupted', 'cancelled', 'complete']) {
    assert(source.includes(`'run.status.${state}'`))
  }
  assert(source.includes('safeReportUrl(run.reportUrl)'))
  assert(source.includes("['http:', 'https:'].includes(u.protocol)"))
  assert(source.includes('noopener noreferrer'))
  assert(source.includes('/runs/${encodeURIComponent(entry.id)}/cancel'))
})
