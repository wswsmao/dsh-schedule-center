/**
 * Pure schedule arithmetic shared by the Host half and its tests.
 *
 * Wall-clock rules (daily and weekly) are evaluated in the Host process's
 * local time zone: the desktop user reads the same zone in the task list.
 * Fixed-rate rules are plain millisecond arithmetic.
 *
 * @module schedule-center/lib/schedule
 */

/** Schedule kinds this plugin stores. */
export const SCHEDULE_KINDS = Object.freeze(['daily', 'weekly', 'every', 'once'])

/** Smallest accepted fixed-rate interval, in minutes. */
export const MIN_EVERY_MINUTES = 1

/** Largest accepted fixed-rate interval, in minutes (seven days). */
export const MAX_EVERY_MINUTES = 7 * 24 * 60

/** A validated schedule was missing or malformed. */
export class ScheduleInputError extends Error {
  /**
   * @param {string} message - user-readable reason.
   * @param {string} [code] - stable machine code carried to the client.
   */
  constructor(message, code = 'invalid_schedule') {
    super(message)
    this.name = 'ScheduleInputError'
    this.code = code
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

/**
 * Validate one wire schedule and return its normalized stored form.
 * @param {unknown} input - schedule object from the browser or stored state.
 * @returns {{kind: 'daily', time: string}
 *   | {kind: 'weekly', time: string, weekdays: number[]}
 *   | {kind: 'every', everyMinutes: number}
 *   | {kind: 'once', at: string}} normalized schedule.
 * @throws {ScheduleInputError} when the shape or a field is invalid.
 */
export function normalizeSchedule(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ScheduleInputError('缺少有效的重复规则。')
  }
  const kind = /** @type {{kind?: unknown}} */ (input).kind
  switch (kind) {
    case 'daily':
      return { kind: 'daily', time: normalizeTime(/** @type {{time?: unknown}} */ (input).time) }
    case 'weekly': {
      const weekdays = normalizeWeekdays(/** @type {{weekdays?: unknown}} */ (input).weekdays)
      return { kind: 'weekly', time: normalizeTime(/** @type {{time?: unknown}} */ (input).time), weekdays }
    }
    case 'every': {
      const raw = /** @type {{everyMinutes?: unknown}} */ (input).everyMinutes
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < MIN_EVERY_MINUTES || raw > MAX_EVERY_MINUTES) {
        throw new ScheduleInputError(`间隔必须是 ${MIN_EVERY_MINUTES} 到 ${MAX_EVERY_MINUTES} 之间的整数分钟。`)
      }
      return { kind: 'every', everyMinutes: raw }
    }
    case 'once': {
      const raw = /** @type {{at?: unknown}} */ (input).at
      if (typeof raw !== 'string' || raw.trim() === '') throw new ScheduleInputError('请选择执行时间。')
      const at = Date.parse(raw)
      if (!Number.isFinite(at)) throw new ScheduleInputError('执行时间无法解析。')
      return { kind: 'once', at: new Date(at).toISOString() }
    }
    default:
      throw new ScheduleInputError('不支持的重复规则。')
  }
}

/**
 * Validate one stored or submitted local time.
 * @param {unknown} raw - `HH:MM` or `HH:MM:SS`.
 * @returns {string} `HH:MM`.
 */
function normalizeTime(raw) {
  if (typeof raw !== 'string' || !TIME_PATTERN.test(raw)) {
    throw new ScheduleInputError('时间必须是 24 小时制 HH:MM。')
  }
  return raw.slice(0, 5)
}

/**
 * Validate a weekly weekday set.
 * @param {unknown} raw - array of ISO weekday numbers, Monday 1 through Sunday 7.
 * @returns {number[]} unique ascending weekdays.
 */
function normalizeWeekdays(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new ScheduleInputError('请至少选择一个星期。')
  const seen = new Set()
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 7) {
      throw new ScheduleInputError('星期必须是 1（周一）到 7（周日）之间的整数。')
    }
    seen.add(value)
  }
  return [...seen].sort((left, right) => left - right)
}

/**
 * Compute the next instant a schedule is due.
 *
 * `once` returns its stored instant even when it already passed: the ticker
 * treats that as one missed occurrence, runs it once, and disables the task.
 * @param {ReturnType<typeof normalizeSchedule>} schedule - normalized rule.
 * @param {number} after - epoch milliseconds that the result must be later than,
 *   except for the one-shot catch-up case.
 * @returns {number | null} next epoch milliseconds, or null when none exists.
 */
export function nextOccurrence(schedule, after) {
  switch (schedule.kind) {
    case 'daily':
      return nextDaily(schedule.time, after)
    case 'weekly':
      return nextWeekly(schedule.time, schedule.weekdays, after)
    case 'every':
      return after + schedule.everyMinutes * 60_000
    case 'once':
      return Date.parse(schedule.at)
    default:
      return null
  }
}

/**
 * Next daily wall-clock occurrence strictly after `after`.
 * @param {string} time - `HH:MM`.
 * @param {number} after - epoch milliseconds.
 * @returns {number} next epoch milliseconds.
 */
function nextDaily(time, after) {
  const [hours, minutes] = time.split(':').map(Number)
  const candidate = new Date(after)
  candidate.setHours(hours, minutes, 0, 0)
  if (candidate.getTime() <= after) {
    candidate.setDate(candidate.getDate() + 1)
    candidate.setHours(hours, minutes, 0, 0)
  }
  return candidate.getTime()
}

/**
 * Next weekly wall-clock occurrence strictly after `after`.
 * @param {string} time - `HH:MM`.
 * @param {number[]} weekdays - ISO weekdays, Monday 1 through Sunday 7.
 * @param {number} after - epoch milliseconds.
 * @returns {number | null} next epoch milliseconds, or null when no weekday is set.
 */
function nextWeekly(time, weekdays, after) {
  const wanted = new Set(weekdays)
  const [hours, minutes] = time.split(':').map(Number)
  const base = new Date(after)
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, hours, minutes, 0, 0)
    const isoWeekday = candidate.getDay() === 0 ? 7 : candidate.getDay()
    if (wanted.has(isoWeekday) && candidate.getTime() > after) return candidate.getTime()
  }
  return null
}

/**
 * Validate one schedule loaded from durable state.
 * @param {unknown} value - stored schedule object.
 * @returns {ReturnType<typeof normalizeSchedule> | null} normalized rule, or null when unusable.
 */
export function readStoredSchedule(value) {
  try {
    return normalizeSchedule(value)
  } catch {
    return null
  }
}
