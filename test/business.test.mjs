import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'
import { BusinessActionCatalog, BusinessActionError, occurrenceKey } from '../lib/business.js'

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = path.join(repo, '.runtime', 'tests')
const later = () => ({ kind: 'once', at: new Date(Date.now() + 3600_000).toISOString() })

async function fixture(t, seed = null) {
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(path.join(root, 'business-'))
  if (seed) await writeFile(path.join(dir, 'state.json'), JSON.stringify(seed), 'utf8')
  const effects = [], listeners = {}, registeredTools = [], sessionCalls = []
  const ctx = {
    provide(name, value) { this[name] = value; effects.push(() => { delete this[name] }); return effects.at(-1) },
    get(name) { if (name === 'timer') return { setInterval(callback) { ctx.ticker = callback; return () => { ctx.ticker = null } } }; return undefined },
    effect(factory) { const cleanup = factory(); if (typeof cleanup === 'function') effects.push(cleanup); return cleanup },
    on(name, callback) { listeners[name] = callback; return () => { delete listeners[name] } },
    tools: { register(definition) { registeredTools.push(definition); return () => {} } },
    webServer: { register(route) { ctx.route = route; return () => { ctx.route = null } } },
    connection: { requestRejection: () => undefined },
    sessions: { get: () => undefined },
    sessionController: {
      async create(request) { sessionCalls.push({ method: 'create', request }); return { sessionId: 'prompt-session' } },
      async prompt(request) { sessionCalls.push({ method: 'prompt', request }); return { accepted: true } },
    },
  }
  const returned = apply(ctx, { dataDir: dir })
  assert.equal(returned, undefined) // Cordis apply effects cannot return an arbitrary service object.
  const center = ctx.scheduleCenter
  await center.ready
  t.after(async () => { for (const dispose of effects.reverse()) await dispose(); await rm(dir, { recursive: true, force: true }) })
  return { ctx, center, dir, sessionCalls, listeners, registeredTools, effects }
}

function action(overrides = {}) {
  const calls = []
  let state = 'running'
  const definition = {
    id: 'ai-tech-daily', title: 'AI技术日报', description: 'Fixed business test',
    async start(input) { calls.push(input); return { run_id: 'daily-run', status: state } },
    async status(runId) { assert.equal(runId, 'daily-run'); return { status: state, stages: { collect: 'complete' }, report_url: 'https://daily.example/report', summary: 'checked', stop_reason: state === 'partial' ? 'coverage incomplete' : null } },
    async cancel() { state = 'cancelled'; return { status: state } },
    ...overrides,
  }
  return { definition, calls, setState: (next) => { state = next } }
}

async function newBusiness(f, options = {}) {
  return f.center.createTask({ name: 'AI技术日报', type: 'business', actionId: 'ai-tech-daily', cwd: f.dir, enabled: false, schedule: later(), ...options })
}

function seedTask(dir) {
  return { id: 'task-old', name: 'AI日报', type: 'business', actionId: 'ai-tech-daily', prompt: '', cwd: dir, workspaceId: null, permission: null, schedule: { kind: 'every', everyMinutes: 60 }, enabled: true, nextRunAt: Date.now() + 3600_000, createdAt: Date.now() - 3600_000, lastRunAt: Date.now() - 60_000, lastStatus: 'running', lastOccurrenceKey: 'schedule-center:task-old:2026-10-26T04:30:00.000Z' }
}

test('action catalog is registered-only, unique and reversible', () => {
  const catalog = new BusinessActionCatalog(); const a = action(); const dispose = catalog.registerAction(a.definition)
  assert.equal(catalog.listActions()[0].id, 'ai-tech-daily')
  assert.throws(() => catalog.registerAction(a.definition), BusinessActionError)
  assert.throws(() => catalog.registerAction({ id: 'any-code', title: 'x' }), BusinessActionError)
  dispose(); assert.deepEqual(catalog.listActions(), [])
})

test('prompt tasks retain Session creation, prompt and turn-end status', async (t) => {
  const f = await fixture(t)
  const task = await f.center.createTask({ name: 'old prompt', prompt: 'keep exact prompt', cwd: f.dir, enabled: false, schedule: later() })
  const { run } = await f.center.runTask(task.id)
  assert.equal(task.type, 'prompt'); assert.equal(run.type, 'prompt')
  assert.deepEqual(f.sessionCalls.map((entry) => entry.method), ['create', 'prompt'])
  assert.equal(f.sessionCalls[1].request.content[0].text, 'keep exact prompt')
  f.listeners['session/event']({ id: 'prompt-session' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(run.status, 'success')
})

test('business run bypasses model Session and keeps task busy until provider terminal', async (t) => {
  const f = await fixture(t); const a = action(); f.center.registerAction(a.definition)
  const task = await newBusiness(f); const { run } = await f.center.runTask(task.id)
  assert.equal(run.businessRunId, 'daily-run'); assert.equal(run.status, 'running')
  assert.deepEqual(f.sessionCalls, [])
  assert.equal(a.calls[0].project_dir, f.dir); assert.equal(a.calls[0].trigger, 'manual')
  assert.match(a.calls[0].schedule_occurrence, /^schedule-center:.*:manual:/)
  assert.equal(f.center.readTask(task.id).running, true)
  assert.equal((await f.center.runTask(task.id)).code, 'task_busy')
  a.setState('complete'); await f.center.tick()
  assert.equal(run.status, 'complete'); assert.equal(run.reportUrl, 'https://daily.example/report')
  assert.equal(f.center.readTask(task.id).running, false)
})

for (const status of ['partial', 'failed', 'cancelled', 'blocked', 'interrupted']) {
  test(`real business terminal ${status} is retained, not turned into prompt success`, async (t) => {
    const f = await fixture(t); const a = action(); f.center.registerAction(a.definition)
    const task = await newBusiness(f); const { run } = await f.center.runTask(task.id)
    a.setState(status); await f.center.tick()
    assert.equal(run.status, status); assert.notEqual(run.finishedAt, null)
    assert.equal(f.center.readTask(task.id).lastStatus, status)
    assert.equal(f.sessionCalls.length, 0)
  })
}

test('business cancellation targets provider run and records actual cancelled terminal', async (t) => {
  const f = await fixture(t); const a = action(); f.center.registerAction(a.definition)
  const task = await newBusiness(f); const { run } = await f.center.runTask(task.id)
  await f.center.cancelRun(run.id)
  assert.equal(run.status, 'cancelled'); assert.equal(f.center.readTask(task.id).running, false)
})

test('unregistered actions cannot create tasks or invoke arbitrary callbacks', async (t) => {
  const f = await fixture(t)
  await assert.rejects(() => newBusiness(f), { code: 'business_action_unavailable' })
  assert.equal(f.sessionCalls.length, 0); assert.equal(f.center.list().tasks.length, 0)
})

test('missing registered provider pauses existing task and resumes exact durable intent', async (t) => {
  const f = await fixture(t); const a = action(); const dispose = f.center.registerAction(a.definition)
  const task = await newBusiness(f); dispose()
  const { run } = await f.center.runTask(task.id)
  assert.equal(run.awaitingAction, true); assert.equal(run.businessRunId, null); assert.equal(a.calls.length, 0)
  f.center.registerAction(a.definition); await f.center.tick()
  assert.equal(run.businessRunId, 'daily-run'); assert.equal(a.calls.length, 1)
  assert.equal(a.calls[0].schedule_occurrence, run.occurrenceKey)
})

test('same due occurrence is recorded once even with concurrent ticks', async (t) => {
  const f = await fixture(t); const a = action(); f.center.registerAction(a.definition)
  const task = await newBusiness(f, { enabled: true, schedule: { kind: 'every', everyMinutes: 1 } })
  task.nextRunAt = Date.now() - 1000
  await Promise.all([f.center.tick(), f.center.tick(), f.center.tick()])
  assert.equal(a.calls.length, 1); assert.equal(f.center.list().runs.length, 1)
  assert.match(f.center.list().runs[0].occurrenceKey, /^schedule-center:/)
  const stored = JSON.parse(await readFile(path.join(f.dir, 'state.json'), 'utf8'))
  assert.equal(stored.runs[0].businessRunId, 'daily-run')
})

test('restart with receipt recovers status without restarting business', async (t) => {
  const f = await fixture(t)
  const task = seedTask(f.dir)
  const run = { id: 'run-old', taskId: task.id, taskName: task.name, type: 'business', actionId: task.actionId, projectDir: f.dir, businessRunId: 'daily-run', occurrenceKey: task.lastOccurrenceKey, startedAt: Date.now() - 60_000, finishedAt: null, status: 'running', trigger: 'schedule' }
  await writeFile(path.join(f.dir, 'state.json'), JSON.stringify({ version: 2, tasks: [task], runs: [run] }), 'utf8')
  const g = await fixture(t, { version: 2, tasks: [task], runs: [run] })
  const a = action(); a.setState('partial'); g.center.registerAction(a.definition)
  await g.center.tick()
  assert.equal(a.calls.length, 0); assert.equal(g.center.list().runs[0].status, 'partial')
  assert.equal(g.center.readTask(task.id).running, false)
})

test('restart without receipt reuses fixed occurrence for provider idempotency', async (t) => {
  const f = await fixture(t); const task = seedTask(f.dir)
  const run = { id: 'run-intent', taskId: task.id, taskName: task.name, type: 'business', actionId: task.actionId, projectDir: f.dir, businessRunId: null, occurrenceKey: task.lastOccurrenceKey, startedAt: Date.now() - 60_000, status: 'running', trigger: 'schedule' }
  const g = await fixture(t, { version: 2, tasks: [task], runs: [run] }); const a = action(); g.center.registerAction(a.definition)
  await g.center.tick(); await g.center.tick()
  assert.equal(a.calls.length, 1); assert.equal(a.calls[0].schedule_occurrence, task.lastOccurrenceKey)
  assert.equal(g.center.list().runs.length, 1)
})

test('unknown business status is not accepted as completion', async (t) => {
  const f = await fixture(t); const a = action({ async start() { return { run_id: 'bad', status: 'ok' } } }); f.center.registerAction(a.definition)
  const task = await newBusiness(f); const { run } = await f.center.runTask(task.id)
  assert.equal(run.status, 'failed'); assert.equal(run.errorCode, 'invalid_business_status')
})

test('agent tool exposes registered business task creation but cannot select permissions', async (t) => {
  const f = await fixture(t); const a = action(); f.center.registerAction(a.definition)
  const tool = f.registeredTools.find((entry) => entry.name === 'schedule_center')
  assert(tool); assert.equal(tool.parameters.properties.permission, undefined)
  const listed = await tool.execute({ action: 'list' }); assert.equal(listed.businessActions[0].id, a.definition.id)
  const { task } = await tool.execute({ action: 'create_business', name: 'daily', action_id: a.definition.id, project_dir: f.dir, schedule: later(), enabled: false })
  assert.equal(task.type, 'business'); assert.equal(task.permission, null)
  await assert.rejects(() => tool.execute({ action: 'create_business', name: 'daily', permission: 'danger-full-access' }))
  await assert.rejects(() => f.center.createTask({ type: 'prompt', name: 'unsafe', prompt: 'x', cwd: f.dir, schedule: later(), permission: 'danger-full-access' }), { code: 'permission_user_only' })
})

test('stable occurrence keys distinguish scheduled and manual runs', () => {
  assert.equal(occurrenceKey('task', 'schedule', 0, ''), 'schedule-center:task:1970-01-01T00:00:00.000Z')
  assert.notEqual(occurrenceKey('task', 'manual', null, 'one'), occurrenceKey('task', 'manual', null, 'two'))
})
