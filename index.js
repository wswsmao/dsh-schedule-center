/**
 * Host half of the scheduled-tasks plugin.
 *
 * It owns the durable task table, the ticker that starts a fresh Session for a
 * due task, and the small JSON API the browser panel uses. A run admits one
 * ordinary prompt into a newly created Session, so the model works in the
 * task's workspace exactly as it does in a hand-started conversation.
 *
 * @module schedule-center
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { ScheduleInputError, nextOccurrence, normalizeSchedule, readStoredSchedule } from './lib/schedule.js'
import { BUSINESS_ACTIVE, BUSINESS_TERMINAL, BusinessActionCatalog, BusinessActionError, BusinessRuns, occurrenceKey } from './lib/business.js'
import { createScheduleTools } from './lib/tools.js'

/** Cordis plugin name. */
export const name = 'schedule-center'

/** Host services this plugin needs: the route carrier, the trust fence, sessions. */
export const inject = ['webServer', 'connection', 'sessionController', 'sessions', 'tools']

/** Mounted route prefix; every endpoint lives below it. */
const ROUTE_PREFIX = '/plugins/schedule-center'

/** Request bodies are small JSON documents; anything larger is refused. */
const MAX_BODY_BYTES = 256 * 1024

/** Ticker cadence. A due task starts within this window of its target instant. */
const TICK_MS = 15_000

/** Retained run records; older records are dropped. */
const MAX_RUNS = 200

/** A run whose turn never ended is reported as failed after this long. */
const STALE_RUN_MS = 2 * 60 * 60 * 1000

const STATE_VERSION = 2

const FALLBACK_PERMISSIONS = Object.freeze({
  options: [
    { value: 'danger-full-access', name: 'Full access' },
    { value: 'workspace-write', name: 'Workspace write' },
  ],
  defaultPreset: 'danger-full-access',
})

/**
 * Mount the scheduled-tasks service.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx, config = {}) {
  const dataDir = typeof config.dataDir === 'string' ? config.dataDir : resolveDataDir()
  const statePath = join(dataDir, 'state.json')
  /** @type {{version: number, tasks: any[], runs: any[]}} */
  let state = { version: STATE_VERSION, tasks: [], runs: [] }
  let loaded = false
  let disposed = false
  let ticking = false
  const catalog = new BusinessActionCatalog()
  const business = new BusinessRuns({ catalog, state: () => state, taskOf, persist })
  const center = {
    registerAction: (definition) => catalog.registerAction(definition),
    listActions: () => catalog.listActions(),
    createTask,
    readTask: (id) => publicTask(requireTask(id)),
    list: () => snapshot(),
    runTask: (id) => startRun(requireTask(id), 'manual'),
    setEnabled,
    removeTask,
    cancelRun,
    tick: runTick,
    ready: null,
  }
  ctx.provide('scheduleCenter', center)
  /** Serializes durable writes so two mutations never interleave. */
  let writes = Promise.resolve()

  /** Persist the current in-memory state, atomically and in order. */
  function persist() {
    const text = JSON.stringify(state, null, 2)
    writes = writes
      .catch(() => {})
      .then(async () => {
        await mkdir(dataDir, { recursive: true })
        const temporary = `${statePath}.${process.pid}.tmp`
        await writeFile(temporary, text, 'utf8')
        await rename(temporary, statePath)
      })
    writes.catch((error) => console.error('[schedule-center] could not persist state:', error))
    return writes
  }

  /** Load durable state once, repairing what it can and backing up what it cannot. */
  async function load() {
    try {
      const text = await readFile(statePath, 'utf8')
      state = sanitizeState(JSON.parse(text))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('[schedule-center] could not read state:', error)
        try {
          await rename(statePath, `${statePath}.corrupt-${Date.now()}`)
        } catch {
          /* best effort backup */
        }
      }
    }
    for (const task of state.tasks) {
      reconcileTask(task, Date.now())
      if (task.type === 'business') task.running = state.runs.some((run) => run.type === 'business' && run.taskId === task.id && BUSINESS_ACTIVE.has(run.status))
    }
    loaded = true
    await persist()
  }

  /** Recompute one task's next target from its rule and current enablement. */
  function reconcileTask(task, now) {
    if (!task.enabled) {
      task.nextRunAt = null
      return
    }
    if (task.schedule.kind === 'once') {
      if (task.lastStatus !== null) {
        task.enabled = false
        task.nextRunAt = null
        return
      }
      task.nextRunAt = Date.parse(task.schedule.at)
      return
    }
    if (typeof task.nextRunAt !== 'number' || !Number.isFinite(task.nextRunAt)) {
      task.nextRunAt = nextOccurrence(task.schedule, now)
    }
  }

  /** Schedule lookups and mutations share one in-memory table. */
  function taskOf(id) {
    return state.tasks.find((task) => task.id === id)
  }

  function trimRuns() {
    // Never evict a live business receipt: it is required for recovery and cancellation.
    const active = state.runs.filter((run) => run.type === 'business' && BUSINESS_ACTIVE.has(run.status))
    const retained = state.runs.filter((run) => !(run.type === 'business' && BUSINESS_ACTIVE.has(run.status))).slice(0, MAX_RUNS)
    state.runs = [...active, ...retained].sort((left, right) => right.startedAt - left.startedAt)
  }

  /** Mark runs whose turn never settled as failed after the stale window. */
  function sweepStaleRuns(now) {
    let changed = false
    for (const run of state.runs) {
      if (run.type === 'business' || run.status !== 'running' || typeof run.startedAt !== 'number') continue
      if (now - run.startedAt < STALE_RUN_MS) continue
      run.status = 'error'
      run.error = '运行超时（未在 2 小时内结束）'
      run.finishedAt = now
      const task = taskOf(run.taskId)
      if (task !== undefined) task.lastStatus = 'error'
      changed = true
    }
    return changed
  }

  /**
   * Start one run: create a Session in the task's workspace, pin the requested
   * permission preset, and admit the task prompt.
   * @param {any} task - stored task.
   * @param {'schedule' | 'manual'} trigger - why the run started.
   * @returns {Promise<{run: any} | {code: string, message: string}>}
   */
  async function startRun(task, trigger, occurrence = null) {
    await center.ready
    if (disposed) return { code: 'scheduler_unloaded', message: '定时任务插件已停用。' }
    if (task.type === 'business' && trigger === 'schedule') {
      const key = occurrenceKey(task.id, trigger, occurrence, '')
      const previous = state.runs.find((run) => run.type === 'business' && run.occurrenceKey === key)
      if (previous) return { run: previous, deduplicated: true }
      if (task.lastOccurrenceKey === key) return { code: 'occurrence_already_started', message: '该定时触发已经记录，不会重复执行。' }
    }
    if (task.running) return { code: 'task_busy', message: '任务正在运行中，请稍后再试。' }
    const now = Date.now()
    task.running = true
    task.lastRunAt = now
    const run = {
      id: randomUUID(),
      taskId: task.id,
      taskName: task.name,
      trigger,
      startedAt: now,
      finishedAt: null,
      status: 'running',
      sessionId: null,
      summary: null,
      error: null,
      type: task.type ?? 'prompt',
      actionId: task.type === 'business' ? task.actionId : null,
      businessRunId: null,
      projectDir: task.cwd,
      occurrenceKey: task.type === 'business' ? occurrenceKey(task.id, trigger, occurrence, '') : null,
      stages: null,
      reportUrl: null,
      awaitingAction: false,
      errorCode: null,
    }
    if (task.type === 'business') {
      if (trigger === 'manual') run.occurrenceKey = occurrenceKey(task.id, trigger, occurrence, run.id)
      task.lastOccurrenceKey = run.occurrenceKey
    }
    state.runs.unshift(run)
    trimRuns()
    await persist()
    if (task.type === 'business') {
      await business.start(run)
      return { run }
    }
    try {
      const created = await ctx.sessionController.create(
        task.workspaceId === null ? { cwd: task.cwd } : { workspaceId: task.workspaceId },
      )
      const sessionId = created.sessionId
      run.sessionId = sessionId
      task.lastSessionId = sessionId
      applyPermission(sessionId, task.permission)
      await ctx.sessionController.prompt(
        {
          requestId: `schedule-center-${run.id}`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: task.prompt }],
          clientTimeZone: localTimeZone(),
        },
        new AbortController().signal,
      )
    } catch (error) {
      run.status = 'error'
      run.finishedAt = Date.now()
      run.error = describeError(error)
      task.lastStatus = 'error'
    } finally {
      task.running = false
      await persist()
    }
    return { run }
  }

  /**
   * Pin the task's permission preset on the freshly created Session, before
   * the admitted prompt reaches its first tool call.
   * @param {string} sessionId - created Session identity.
   * @param {string | null} preset - requested preset name.
   */
  function applyPermission(sessionId, preset) {
    if (typeof preset !== 'string' || preset === '') return
    const presets = ctx.get('permissionPresets')
    if (presets === undefined) return
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) return
    try {
      presets.set(session, preset)
    } catch (error) {
      console.warn(`[schedule-center] could not apply permission preset "${preset}":`, error)
    }
  }

  /** Current selectable permission presets, with a safe fallback. */
  function permissionCatalog() {
    const presets = ctx.get('permissionPresets')
    if (presets !== undefined) {
      try {
        const catalog = presets.catalog()
        if (Array.isArray(catalog?.options) && catalog.options.length > 0) {
          return {
            options: catalog.options,
            defaultPreset: typeof catalog.defaultPreset === 'string' ? catalog.defaultPreset : catalog.options[0].value,
          }
        }
      } catch (error) {
        console.warn('[schedule-center] could not read permission presets:', error)
      }
    }
    return FALLBACK_PERMISSIONS
  }

  /** Registered workspaces offered by the dialog's picker. */
  function workspaceOptions() {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) return []
    try {
      return registry.list().map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
      }))
    } catch (error) {
      console.warn('[schedule-center] could not list workspaces:', error)
      return []
    }
  }

  /** The full snapshot the panel polls. */
  function snapshot() {
    return {
      version: STATE_VERSION,
      now: Date.now(),
      dataPath: statePath,
      tasks: state.tasks.map(publicTask),
      runs: state.runs.slice(0, 100),
      workspaces: workspaceOptions(),
      permissions: permissionCatalog(),
      businessActions: catalog.listActions(),
    }
  }

  /** Strip internal fields from a stored task for the browser. */
  function publicTask(task) {
    return {
      id: task.id,
      name: task.name,
      prompt: task.prompt,
      type: task.type ?? 'prompt',
      actionId: task.actionId ?? null,
      actionTitle: task.type === 'business' ? catalog.get(task.actionId)?.title ?? task.actionId : null,
      actionAvailable: task.type !== 'business' || catalog.get(task.actionId) !== undefined,
      lastBusinessRunId: task.lastBusinessRunId ?? null,
      workspaceId: task.workspaceId,
      cwd: task.cwd,
      permission: task.permission,
      schedule: task.schedule,
      enabled: task.enabled,
      running: task.running === true,
      createdAt: task.createdAt,
      nextRunAt: task.enabled ? task.nextRunAt : null,
      lastRunAt: task.lastRunAt,
      lastStatus: task.lastStatus,
      lastSessionId: task.lastSessionId,
    }
  }

  /**
   * Validate one create request and append its task.
   * @param {Record<string, unknown>} body - parsed request body.
   * @returns {Promise<any>} the stored task.
   */
  async function createTask(body, { userInterface = false } = {}) {
    await center.ready
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '任务定义必须是对象。')
    const type = body.type === undefined ? 'prompt' : body.type
    if (type !== 'prompt' && type !== 'business') throw new HttpError(400, '任务类型必须是 prompt 或 business。')
    const taskName = typeof body.name === 'string' ? body.name.trim() : ''
    if (taskName === '') throw new HttpError(400, '请填写任务名称。')
    if (taskName.length > 120) throw new HttpError(400, '任务名称不能超过 120 个字符。')
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (type === 'prompt' && prompt === '') throw new HttpError(400, '请填写任务提示词。')
    const actionId = type === 'business' && typeof body.actionId === 'string' ? body.actionId : null
    if (type === 'business' && catalog.get(actionId) === undefined) throw new HttpError(400, '所选固定业务动作未注册或不可用。', 'business_action_unavailable')
    if (!userInterface && body.permission !== undefined) throw new HttpError(400, '代理工具不能选择或提升任务权限，请在界面中配置。', 'permission_user_only')
    if (prompt.length > 20_000) throw new HttpError(400, '提示词过长。')

    const target = await resolveTarget(body)
    const schedule = normalizeSchedule(body.schedule)
    if (schedule.kind === 'once' && Date.parse(schedule.at) <= Date.now()) {
      throw new HttpError(400, '仅一次任务的时间必须晚于当前时间。')
    }
    const permissions = permissionCatalog()
    const requested = type === 'business' ? null : typeof body.permission === 'string' && body.permission !== '' ? body.permission : permissions.defaultPreset
    const now = Date.now()
    const task = {
      id: randomUUID(),
      name: taskName,
      type,
      actionId,
      prompt: type === 'prompt' ? prompt : '',
      workspaceId: target.workspaceId,
      cwd: target.cwd,
      permission: requested,
      schedule,
      enabled: body.enabled !== false,
      running: false,
      createdAt: now,
      nextRunAt: body.enabled === false ? null : nextOccurrence(schedule, now),
      lastRunAt: null,
      lastStatus: null,
      lastSessionId: null,
      lastBusinessRunId: null,
      lastOccurrenceKey: null,
    }
    state.tasks.unshift(task)
    await persist()
    return task
  }

  /**
   * Resolve the task's workspace directory from a registered workspace id or an
   * explicit absolute directory. A directory that is not registered yet is
   * registered, so its Sessions appear under a workspace in the sidebar.
   * @param {Record<string, unknown>} body - parsed create request.
   * @returns {Promise<{workspaceId: string | null, cwd: string}>} target.
   */
  async function resolveTarget(body) {
    const registry = ctx.get('workspaceRegistry')
    if (typeof body.workspaceId === 'string' && body.workspaceId !== '') {
      const workspace = registry?.get(body.workspaceId)
      if (workspace === undefined) throw new HttpError(400, '所选工作空间不存在。')
      return { workspaceId: workspace.id, cwd: workspace.path }
    }
    const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
    if (cwd === '' || !isAbsolute(cwd)) throw new HttpError(400, '请选择一个工作空间或绝对目录。')
    if (registry !== undefined) {
      try {
        const workspace = await registry.create(cwd)
        return { workspaceId: workspace.id, cwd: workspace.path }
      } catch {
        /* keep the explicit directory when registration fails */
      }
    }
    return { workspaceId: null, cwd }
  }

  async function setEnabled(id, enabled) {
    await center.ready
    const task = requireTask(id)
    if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled 必须是布尔值。')
    if (enabled) {
      if (task.schedule.kind === 'once' && Date.parse(task.schedule.at) <= Date.now()) throw new HttpError(400, '仅一次任务的时间已过，无法启用。')
      task.enabled = true
      task.nextRunAt = nextOccurrence(task.schedule, Date.now())
    } else { task.enabled = false; task.nextRunAt = null }
    await persist()
    return publicTask(task)
  }

  async function removeTask(id) {
    await center.ready
    const task = requireTask(id)
    if (task.type === 'business' && task.running) throw new HttpError(409, '请先取消正在运行的业务任务再删除。', 'task_busy')
    state.tasks = state.tasks.filter((candidate) => candidate.id !== task.id)
    state.runs = state.runs.filter((candidate) => candidate.taskId !== task.id)
    await persist()
    return { removed: true }
  }

  async function cancelRun(id) {
    await center.ready
    const run = state.runs.find((candidate) => candidate.id === id)
    if (!run) throw new HttpError(404, '运行记录不存在。')
    return business.cancel(run)
  }

  /** Answer one HTTP request below the plugin's route prefix. */
  async function handleRequest(req, res) {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    const url = new URL(String(req.url ?? '/'), 'http://schedule-center.invalid')
    const rest = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : ''
    try {
      if (req.method === 'GET' && rest === '/state') {
        sendJson(res, 200, { ok: true, state: snapshot() })
        return
      }
      if (req.method === 'POST' && rest === '/tasks') {
        const body = await readJsonBody(req)
        const task = await createTask(body, { userInterface: true })
        sendJson(res, 200, { ok: true, task: publicTask(task) })
        return
      }
      const enabledMatch = /^\/tasks\/([^/]+)\/enabled$/.exec(rest)
      if (req.method === 'POST' && enabledMatch !== null) {
        const body = await readJsonBody(req)
        const task = await setEnabled(enabledMatch[1], body.enabled)
        sendJson(res, 200, { ok: true, task })
        return
      }
      const runMatch = /^\/tasks\/([^/]+)\/run$/.exec(rest)
      if (req.method === 'POST' && runMatch !== null) {
        const task = requireTask(runMatch[1])
        const outcome = await startRun(task, 'manual')
        if ('code' in outcome) throw new HttpError(409, outcome.message)
        sendJson(res, 200, { ok: true, run: outcome.run, task: publicTask(task) })
        return
      }
      const cancelMatch = /^\/runs\/([^/]+)\/cancel$/.exec(rest)
      if (req.method === 'POST' && cancelMatch !== null) {
        const run = await cancelRun(decodeURIComponent(cancelMatch[1]))
        sendJson(res, 200, { ok: true, run })
        return
      }
      const deleteMatch = /^\/tasks\/([^/]+)$/.exec(rest)
      if (req.method === 'DELETE' && deleteMatch !== null) {
        await removeTask(deleteMatch[1])
        sendJson(res, 200, { ok: true })
        return
      }
      sendJson(res, 404, { ok: false, code: 'not_found', message: '未知接口。' })
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { ok: false, code: error.code, message: error.message })
        return
      }
      if (error instanceof BusinessActionError) {
        sendJson(res, 409, { ok: false, code: error.code, message: error.message })
        return
      }
      if (error instanceof ScheduleInputError) {
        sendJson(res, 400, { ok: false, code: error.code, message: error.message })
        return
      }
      console.error('[schedule-center] request failed:', error)
      sendJson(res, 500, { ok: false, code: 'internal_error', message: '服务内部错误。' })
    }
  }

  /**
   * Resolve one task by path id.
   * @param {string} rawId - percent-encoded path segment.
   * @returns {any} the stored task.
   */
  function requireTask(rawId) {
    let id
    try {
      id = decodeURIComponent(rawId)
    } catch {
      throw new HttpError(400, '任务标识无效。')
    }
    const task = taskOf(id)
    if (task === undefined) throw new HttpError(404, '任务不存在。')
    return task
  }

  // Routes, ticker, and session observation are effects of this plugin's context.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: handleRequest,
      }),
    'schedule-center: JSON API',
  )

  async function runTick() {
    if (!loaded || disposed || ticking) return
    ticking = true
    try {
      await business.refresh()
      const now = Date.now()
      let changed = sweepStaleRuns(now)
      for (const task of state.tasks) {
        if (!task.enabled || task.running === true) continue
        if (typeof task.nextRunAt !== 'number' || !Number.isFinite(task.nextRunAt)) { task.nextRunAt = nextOccurrence(task.schedule, now); changed = true; continue }
        if (task.nextRunAt > now) continue
        const occurrence = task.nextRunAt
        if (task.type === 'business') {
          // Advance and persist the durable intent in startRun before invoking a provider.
          if (task.schedule.kind === 'once') { task.enabled = false; task.nextRunAt = null }
          else task.nextRunAt = nextOccurrence(task.schedule, now)
          await startRun(task, 'schedule', occurrence)
        } else {
          // Preserve the existing prompt-task scheduling path.
          if (task.schedule.kind === 'once') { task.enabled = false; task.nextRunAt = null }
          else task.nextRunAt = nextOccurrence(task.schedule, now)
          void startRun(task, 'schedule').catch((error) => console.error('[schedule-center] prompt run failed:', error))
        }
        changed = true
      }
      if (changed) await persist()
    } finally { ticking = false }
  }

  ctx.effect(
    () => {
      const tick = () => { void runTick().catch((error) => console.error('[schedule-center] ticker failed:', error)) }
      const timer = ctx.get('timer')
      if (timer !== undefined && typeof timer.setInterval === 'function') return timer.setInterval(tick, TICK_MS)
      const handle = setInterval(tick, TICK_MS)
      return () => clearInterval(handle)
    },
    'schedule-center: ticker',
  )
  ctx.effect(() => () => { disposed = true; return writes.catch(() => {}) }, 'schedule-center: durable shutdown')
  ctx.effect(() => {
    const disposers = createScheduleTools(center).map((definition) => ctx.tools.register(definition))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'schedule-center: agent tools')

  ctx.on('session/event', (session, event) => {
    if (event === undefined || (event.type !== 'assistant/message' && event.type !== 'turn/end')) return
    const sessionId = session?.id
    if (typeof sessionId !== 'string') return
    const run = state.runs.find((candidate) => candidate.type !== 'business' && candidate.status === 'running' && candidate.sessionId === sessionId)
    if (run === undefined) return
    if (event.type === 'assistant/message') {
      const text = messageText(event.data?.message)
      if (text !== '') run.summary = text.slice(0, 280)
      void persist()
      return
    }
    const reason = event.data?.reason?.kind
    run.status = reason === 'completed' || reason === 'forked' ? 'success' : 'error'
    if (run.status === 'error') run.error = `运行结束：${String(reason ?? 'unknown')}`
    run.finishedAt = Date.now()
    const task = taskOf(run.taskId)
    if (task !== undefined) {
      task.lastStatus = run.status
      task.lastSessionId = run.sessionId
    }
    void persist()
  })

  center.ready = load()
  center.ready.catch((error) => console.error('[schedule-center] initialization failed:', error))
  return center
}

/** One HTTP failure the route turns into a JSON response. */
class HttpError extends Error {
  /**
   * @param {number} status - HTTP status code.
   * @param {string} message - user-readable reason.
   * @param {string} [code] - stable machine code.
   */
  constructor(status, message, code = 'bad_request') {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

/** Response helper for the plugin's JSON API. */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Read one bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<Record<string, unknown>>} parsed object.
 */
async function readJsonBody(req) {
  const mediaType = String(req.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (mediaType !== 'application/json') {
    throw new HttpError(415, '请求必须是 application/json。', 'unsupported_media_type')
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      throw new HttpError(413, '请求体过大。', 'payload_too_large')
    }
    chunks.push(chunk)
  }
  let body
  try {
    body = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是有效的 JSON。')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, '请求体必须是 JSON 对象。')
  }
  return body
}

/** Build a safe message from an unknown thrown value. */
function describeError(error) {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

/** Text of one assistant message, for the run summary. */
function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/** The desktop's wall-clock zone, used for the recorded prompt's time context. */
function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

/** Durable state directory: `$DSH_HOME/schedule-center`, or an explicit override. */
function resolveDataDir() {
  const override = process.env.DSH_SCHEDULE_CENTER_DIR?.trim()
  if (override !== undefined && override !== '') return override
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'schedule-center')
}

/**
 * Normalize a stored state document, dropping records it cannot trust.
 * @param {unknown} raw - parsed file content.
 * @returns {{version: number, tasks: any[], runs: any[]}} usable state.
 */
function sanitizeState(raw) {
  const state = { version: STATE_VERSION, tasks: [], runs: [] }
  if (typeof raw !== 'object' || raw === null) return state
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : []
  for (const candidate of tasks) {
    const task = sanitizeTask(candidate)
    if (task !== null) state.tasks.push(task)
  }
  const runs = Array.isArray(raw.runs) ? raw.runs : []
  for (const candidate of runs) {
    const run = sanitizeRun(candidate)
    if (run !== null) state.runs.push(run)
  }
  const active = state.runs.filter((run) => run.type === 'business' && BUSINESS_ACTIVE.has(run.status))
  const retained = state.runs.filter((run) => !(run.type === 'business' && BUSINESS_ACTIVE.has(run.status))).slice(0, MAX_RUNS)
  state.runs = [...active, ...retained].sort((left, right) => right.startedAt - left.startedAt)
  return state
}

/** Validate one stored task. */
function sanitizeTask(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  if (typeof raw.id !== 'string' || raw.id === '') return null
  const type = raw.type === 'business' ? 'business' : 'prompt'
  if (typeof raw.name !== 'string' || (type === 'prompt' && typeof raw.prompt !== 'string')) return null
  if (type === 'business' && (typeof raw.actionId !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(raw.actionId))) return null
  const schedule = readStoredSchedule(raw.schedule)
  if (schedule === null) return null
  const workspaceId = typeof raw.workspaceId === 'string' && raw.workspaceId !== '' ? raw.workspaceId : null
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : ''
  if (workspaceId === null && (cwd === '' || !isAbsolute(cwd))) return null
  return {
    id: raw.id,
    name: raw.name.slice(0, 120),
    type,
    actionId: type === 'business' ? raw.actionId : null,
    prompt: type === 'prompt' ? raw.prompt : '',
    workspaceId,
    cwd,
    permission: typeof raw.permission === 'string' ? raw.permission : 'danger-full-access',
    schedule,
    enabled: raw.enabled !== false,
    running: false,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    nextRunAt: typeof raw.nextRunAt === 'number' ? raw.nextRunAt : null,
    lastRunAt: typeof raw.lastRunAt === 'number' ? raw.lastRunAt : null,
    lastStatus: typeof raw.lastStatus === 'string' ? raw.lastStatus : null,
    lastSessionId: typeof raw.lastSessionId === 'string' ? raw.lastSessionId : null,
    lastBusinessRunId: typeof raw.lastBusinessRunId === 'string' ? raw.lastBusinessRunId : null,
    lastOccurrenceKey: typeof raw.lastOccurrenceKey === 'string' ? raw.lastOccurrenceKey : null,
  }
}

/** Validate one stored run record. */
function sanitizeRun(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  if (typeof raw.id !== 'string' || typeof raw.taskId !== 'string') return null
  const type = raw.type === 'business' ? 'business' : 'prompt'
  const status = type === 'business'
    ? BUSINESS_ACTIVE.has(raw.status) || BUSINESS_TERMINAL.has(raw.status) ? raw.status : 'failed'
    : raw.status === 'success' || raw.status === 'error' || raw.status === 'running' ? raw.status : 'error'
  return {
    id: raw.id,
    taskId: raw.taskId,
    taskName: typeof raw.taskName === 'string' ? raw.taskName : '',
    type,
    actionId: typeof raw.actionId === 'string' ? raw.actionId : null,
    businessRunId: typeof raw.businessRunId === 'string' ? raw.businessRunId : null,
    projectDir: typeof raw.projectDir === 'string' ? raw.projectDir : '',
    occurrenceKey: typeof raw.occurrenceKey === 'string' ? raw.occurrenceKey : `schedule-center:legacy:${raw.id}`,
    stages: raw.stages && typeof raw.stages === 'object' ? raw.stages : null,
    reportUrl: typeof raw.reportUrl === 'string' ? raw.reportUrl : null,
    errorCode: typeof raw.errorCode === 'string' ? raw.errorCode : null,
    awaitingAction: raw.awaitingAction === true,
    lastCheckedAt: typeof raw.lastCheckedAt === 'number' ? raw.lastCheckedAt : null,
    trigger: raw.trigger === 'manual' ? 'manual' : 'schedule',
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : Date.now(),
    finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : null,
    status,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    summary: typeof raw.summary === 'string' ? raw.summary : null,
    error: typeof raw.error === 'string' ? raw.error : null,
  }
}
