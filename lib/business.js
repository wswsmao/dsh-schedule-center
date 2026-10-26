/** Fixed business-action registry and durable scheduler bridge. No model prompts or timers. */
export const BUSINESS_TERMINAL = new Set(['complete', 'partial', 'failed', 'cancelled', 'blocked', 'interrupted', 'error', 'success'])
export const BUSINESS_ACTIVE = new Set(['starting', 'queued', 'running', 'cancelling'])
const ACTION_ID = /^[a-z][a-z0-9-]{0,79}$/

export class BusinessActionError extends Error {
  constructor(code, message) { super(message); this.name = 'BusinessActionError'; this.code = code }
}

export class BusinessActionCatalog {
  constructor() { this.actions = new Map() }
  registerAction(definition) {
    if (!definition || !ACTION_ID.test(definition.id) || !definition.title || typeof definition.start !== 'function' || typeof definition.status !== 'function') {
      throw new BusinessActionError('invalid_business_action', '固定业务动作需要唯一标识、标题、start 和 status。')
    }
    if (this.actions.has(definition.id)) throw new BusinessActionError('duplicate_business_action', '该业务动作已经注册。')
    const action = { ...definition, description: String(definition.description ?? '') }
    this.actions.set(action.id, action)
    return () => { if (this.actions.get(action.id) === action) this.actions.delete(action.id) }
  }
  get(id) { return this.actions.get(id) }
  listActions() { return [...this.actions.values()].map(({ id, title, description, cancel }) => ({ id, title, description, canCancel: typeof cancel === 'function' })) }
}

export function occurrenceKey(taskId, trigger, occurrence, runId) {
  if (trigger === 'schedule') {
    if (!Number.isFinite(occurrence)) throw new BusinessActionError('invalid_occurrence', '定时执行缺少固定触发时刻。')
    return `schedule-center:${taskId}:${new Date(occurrence).toISOString()}`
  }
  return `schedule-center:${taskId}:manual:${runId}`
}

/** Only expose safe public result fields, not arbitrary credentials/provider objects. */
export function publicBusinessResult(value) {
  if (!value || typeof value !== 'object' || typeof value.status !== 'string' || (!BUSINESS_ACTIVE.has(value.status) && !BUSINESS_TERMINAL.has(value.status))) {
    throw new BusinessActionError('invalid_business_status', '业务服务返回了未知状态。')
  }
  let reportUrl = null
  const rawUrl = value.report_url ?? value.reportUrl
  if (typeof rawUrl === 'string') { try { const u = new URL(rawUrl); if (['http:', 'https:'].includes(u.protocol) && !u.username && !u.password) reportUrl = u.href } catch {} }
  return {
    status: value.status,
    stages: value.stages && typeof value.stages === 'object' ? JSON.parse(JSON.stringify(value.stages)) : null,
    reportUrl,
    summary: typeof value.summary === 'string' ? value.summary.slice(0, 1000) : null,
    error: typeof value.error === 'string' ? value.error.slice(0, 1000) : typeof value.stop_reason === 'string' ? value.stop_reason.slice(0, 1000) : null,
  }
}

/**
 * Adapter owns receipts and status recovery. The existing scheduler calls refresh()
 * from its sole ticker. Providers must idempotently honor schedule_occurrence.
 */
export class BusinessRuns {
  constructor({ catalog, state, taskOf, persist, clock = () => Date.now(), staleMs = 8 * 60 * 60 * 1000 }) {
    this.catalog = catalog; this.state = state; this.taskOf = taskOf; this.persist = persist; this.clock = clock; this.staleMs = staleMs
    this.inFlight = new Set()
  }
  syncTask(run) {
    const task = this.taskOf(run.taskId)
    if (!task) return
    task.running = BUSINESS_ACTIVE.has(run.status)
    task.lastStatus = run.status
    task.lastBusinessRunId = run.businessRunId ?? null
  }
  async fail(run, code, message) {
    run.status = 'failed'; run.error = message; run.errorCode = code; run.finishedAt = this.clock(); this.syncTask(run); await this.persist()
  }
  async start(run) {
    if (this.inFlight.has(run.id)) return
    const action = this.catalog.get(run.actionId)
    if (!action) {
      run.awaitingAction = true; run.errorCode = 'business_action_unavailable'; run.error = '业务动作尚未加载，等待注册后恢复。'; this.syncTask(run); await this.persist(); return
    }
    this.inFlight.add(run.id)
    try {
      const receipt = await action.start({ project_dir: run.projectDir, trigger: run.trigger, schedule_occurrence: run.occurrenceKey })
      if (!receipt || typeof receipt.run_id !== 'string' || !receipt.run_id || receipt.run_id.length > 256) throw new BusinessActionError('invalid_business_receipt', '业务服务未返回可恢复的 run_id。')
      run.businessRunId = receipt.run_id; run.awaitingAction = false; run.error = null; run.errorCode = null
      const result = publicBusinessResult(receipt)
      this.applyResult(run, result)
      await this.persist()
    } catch (error) {
      await this.fail(run, error.code ?? 'business_start_failed', error instanceof Error ? error.message : String(error))
    } finally { this.inFlight.delete(run.id) }
  }
  applyResult(run, result) {
    run.status = result.status; run.stages = result.stages; run.reportUrl = result.reportUrl
    if (result.summary !== null) run.summary = result.summary
    run.error = result.error; run.errorCode = null; run.awaitingAction = false; run.lastCheckedAt = this.clock()
    if (BUSINESS_TERMINAL.has(run.status)) run.finishedAt = this.clock()
    this.syncTask(run)
  }
  async refresh() {
    const runs = this.state().runs.filter((run) => run.type === 'business' && BUSINESS_ACTIVE.has(run.status))
    for (const run of runs) {
      if (this.inFlight.has(run.id)) continue
      const action = this.catalog.get(run.actionId)
      if (!action) {
        if (this.clock() - run.startedAt >= this.staleMs) await this.fail(run, 'business_action_unavailable', '业务动作长期不可用；未重放任务。')
        else { run.awaitingAction = true; run.errorCode = 'business_action_unavailable'; run.error = '业务动作尚未加载，等待注册后恢复。'; this.syncTask(run); await this.persist() }
        continue
      }
      if (!run.businessRunId) { await this.start(run); continue }
      this.inFlight.add(run.id)
      try {
        const result = publicBusinessResult(await action.status(run.businessRunId))
        this.applyResult(run, result)
        if (BUSINESS_ACTIVE.has(run.status) && this.clock() - run.startedAt >= this.staleMs) {
          // A stale provider is not restarted or replayed. Best-effort cancellation targets only its exact run.
          if (typeof action.cancel === 'function') await action.cancel(run.businessRunId).catch(() => {})
          await this.fail(run, 'business_timeout', '业务任务超过 8 小时未结束。')
        } else await this.persist()
      } catch (error) {
        run.errorCode = error.code ?? 'business_status_unavailable'; run.error = error instanceof Error ? error.message : String(error); run.lastCheckedAt = this.clock()
        if (this.clock() - run.startedAt >= this.staleMs) await this.fail(run, run.errorCode, '业务状态无法恢复，已停止追踪；未重新执行。')
        else await this.persist()
      } finally { this.inFlight.delete(run.id) }
    }
  }
  async cancel(run) {
    if (run.type !== 'business') throw new BusinessActionError('not_business_run', '此操作仅支持固定业务运行。')
    if (BUSINESS_TERMINAL.has(run.status)) return run
    if (!run.businessRunId) throw new BusinessActionError('business_not_started', '业务尚未返回运行标识，暂不能取消。')
    const action = this.catalog.get(run.actionId)
    if (!action || typeof action.cancel !== 'function') throw new BusinessActionError('business_cancel_unavailable', '该业务动作当前不支持取消。')
    const reply = await action.cancel(run.businessRunId)
    if (reply && typeof reply.status === 'string') this.applyResult(run, publicBusinessResult(reply))
    else { run.status = 'cancelling'; this.syncTask(run) }
    await this.persist(); return run
  }
}
