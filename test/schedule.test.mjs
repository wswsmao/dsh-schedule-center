import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_EVERY_MINUTES,
  ScheduleInputError,
  nextOccurrence,
  normalizeSchedule,
  readStoredSchedule,
} from '../lib/schedule.js'

const at = (year, month, day, hour, minute) => new Date(year, month - 1, day, hour, minute, 0, 0).getTime()

test('normalizes a daily rule and truncates seconds', () => {
  assert.deepEqual(normalizeSchedule({ kind: 'daily', time: '08:30:59' }), { kind: 'daily', time: '08:30' })
})

test('rejects malformed daily times', () => {
  for (const time of ['24:00', '8:30', '08:60', '', null, 830]) {
    assert.throws(() => normalizeSchedule({ kind: 'daily', time }), ScheduleInputError)
  }
})

test('sorts and deduplicates weekdays', () => {
  assert.deepEqual(normalizeSchedule({ kind: 'weekly', time: '09:00', weekdays: [5, 1, 5, 3] }), {
    kind: 'weekly',
    time: '09:00',
    weekdays: [1, 3, 5],
  })
})

test('rejects an empty or out-of-range weekday set', () => {
  for (const weekdays of [[], [0], [8], [1.5], 'Monday']) {
    assert.throws(() => normalizeSchedule({ kind: 'weekly', time: '09:00', weekdays }), ScheduleInputError)
  }
})

test('bounds fixed-rate intervals', () => {
  assert.deepEqual(normalizeSchedule({ kind: 'every', everyMinutes: 90 }), { kind: 'every', everyMinutes: 90 })
  for (const everyMinutes of [0, -5, 1.5, MAX_EVERY_MINUTES + 1, Number.NaN]) {
    assert.throws(() => normalizeSchedule({ kind: 'every', everyMinutes }), ScheduleInputError)
  }
})

test('normalizes a one-shot instant to canonical ISO', () => {
  const normalized = normalizeSchedule({ kind: 'once', at: '2026-10-23T11:06:00+08:00' })
  assert.equal(normalized.kind, 'once')
  assert.equal(normalized.at, new Date('2026-10-23T11:06:00+08:00').toISOString())
  assert.throws(() => normalizeSchedule({ kind: 'once', at: 'not-a-date' }), ScheduleInputError)
})

test('rejects unknown kinds', () => {
  assert.throws(() => normalizeSchedule({ kind: 'hourly', time: '08:00' }), ScheduleInputError)
  assert.throws(() => normalizeSchedule(null), ScheduleInputError)
})

test('next daily occurrence is strictly future', () => {
  const before = at(2026, 10, 23, 7, 0)
  assert.equal(nextOccurrence({ kind: 'daily', time: '08:00' }, before), at(2026, 10, 23, 8, 0))
  const after = at(2026, 10, 23, 9, 0)
  assert.equal(nextOccurrence({ kind: 'daily', time: '08:00' }, after), at(2026, 10, 24, 8, 0))
  const exactly = at(2026, 10, 23, 8, 0)
  assert.equal(nextOccurrence({ kind: 'daily', time: '08:00' }, exactly), at(2026, 10, 24, 8, 0))
})

test('next weekly occurrence walks to the requested weekday', () => {
  // 2026-10-19 is a Monday.
  const monday = at(2026, 10, 19, 9, 30)
  assert.equal(nextOccurrence({ kind: 'weekly', time: '10:00', weekdays: [1] }, monday), at(2026, 10, 19, 10, 0))
  assert.equal(nextOccurrence({ kind: 'weekly', time: '10:00', weekdays: [3] }, monday), at(2026, 10, 21, 10, 0))
  assert.equal(nextOccurrence({ kind: 'weekly', time: '09:00', weekdays: [1] }, monday), at(2026, 10, 26, 9, 0))
  assert.equal(nextOccurrence({ kind: 'weekly', time: '10:00', weekdays: [7] }, monday), at(2026, 10, 25, 10, 0))
})

test('fixed-rate next target is anchored to the base instant', () => {
  const base = at(2026, 10, 23, 11, 6)
  assert.equal(nextOccurrence({ kind: 'every', everyMinutes: 90 }, base), base + 90 * 60_000)
})

test('one-shot keeps its instant so a missed run can catch up', () => {
  const instant = at(2026, 10, 23, 11, 6)
  assert.equal(nextOccurrence({ kind: 'once', at: new Date(instant).toISOString() }, at(2026, 10, 24, 0, 0)), instant)
})

test('stored schedules that no longer validate are dropped', () => {
  assert.equal(readStoredSchedule({ kind: 'daily', time: '99:99' }), null)
  assert.deepEqual(readStoredSchedule({ kind: 'daily', time: '09:15' }), { kind: 'daily', time: '09:15' })
})
