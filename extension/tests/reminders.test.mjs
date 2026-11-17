import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const storageKey = 'before-you-agree:local-reminders'
const alarmPrefix = 'before-you-agree:reminder:'
const startTime = Date.parse('2030-01-01T00:00:00Z')
const source = stripTypeScriptTypes(
  readFileSync(new URL('../src/background/index.ts', import.meta.url), 'utf8'),
)

function draft(key = 'request-1') {
  return {
    sourceUrl: 'https://example.com/terms', sourceTitle: 'Terms',
    eventKind: 'trial_end', eventDescription: 'Review trial before renewal',
    sourceSectionId: 'section-1', remindAt: '2030-01-02T09:00:00.000Z',
    timezone: 'Asia/Colombo', idempotencyKey: key,
  }
}

function worker(initialReminders = []) {
  let stored = structuredClone(initialReminders)
  let now = startTime
  let messageListener
  let alarmListener
  let failSchedule = false
  const alarms = new Map()
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const chrome = {
    storage: { local: {
      async get() { return { [storageKey]: structuredClone(stored) } },
      async set(value) { stored = structuredClone(value[storageKey]) },
    } },
    alarms: {
      async create(name, { when }) {
        if (failSchedule) throw new Error('Alarm unavailable')
        alarms.set(name, { name, scheduledTime: when })
      },
      async clear(name) { return alarms.delete(name) },
      async get(name) { return alarms.get(name) },
      onAlarm: { addListener(listener) { alarmListener = listener } },
    },
    runtime: { onMessage: { addListener(listener) { messageListener = listener } } },
  }
  vm.runInNewContext(source, { chrome, crypto: globalThis.crypto, Date: Clock, URL, Intl })
  const send = (type, payload = {}) => new Promise((resolve) => {
    assert.equal(messageListener({ type, requestId: 'test', ...payload }, {}, resolve), true)
  })
  return {
    send, alarms,
    stored: () => structuredClone(stored),
    setTime: (time) => { now = Date.parse(time) },
    failSchedule: (fail) => { failSchedule = fail },
    fire: (id) => alarmListener({ name: `${alarmPrefix}${id}` }),
  }
}

test('concurrent creates are serialized and retried requests are idempotent', async () => {
  const app = worker()
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    app.send('CREATE_LOCAL_REMINDER', { reminder: draft(`request-${index}`) })))
  assert.ok(results.every((result) => result.ok))
  assert.equal(app.stored().length, 6)
  const retry = await app.send('CREATE_LOCAL_REMINDER', { reminder: draft('request-0') })
  assert.equal(retry.data.id, results[0].data.id)
  assert.equal(app.stored().length, 6)
  assert.equal(app.alarms.size, 6)
})

test('invalid input returns an error and leaves the request queue usable', async () => {
  const app = worker()
  for (const reminder of [null, {}, { ...draft(), timezone: 'Invalid/Zone' },
    { ...draft(), remindAt: '2020-01-01' }, { ...draft(), eventDescription: '  ' }]) {
    const response = await app.send('CREATE_LOCAL_REMINDER', { reminder })
    assert.equal(response.error.code, 'REMINDER_INVALID')
  }
  assert.equal((await app.send('CREATE_LOCAL_REMINDER', { reminder: draft() })).ok, true)
})

test('edit replaces the alarm, stale alarms do not mark it due, and cancel clears it', async () => {
  const app = worker()
  const { data: reminder } = await app.send('CREATE_LOCAL_REMINDER', { reminder: draft() })
  const update = { remindAt: '2030-01-03T09:00:00.000Z', timezone: 'UTC', eventDescription: 'Edited note' }
  assert.equal((await app.send('UPDATE_LOCAL_REMINDER', { reminderId: reminder.id, update })).ok, true)
  assert.equal(app.alarms.get(`${alarmPrefix}${reminder.id}`).scheduledTime, Date.parse(update.remindAt))
  app.setTime('2030-01-02T10:00:00Z')
  app.fire(reminder.id)
  const listed = await app.send('LIST_LOCAL_REMINDERS')
  assert.equal(listed.data[0].status, 'scheduled')
  assert.equal(listed.data[0].eventDescription, 'Edited note')
  assert.equal((await app.send('DELETE_LOCAL_REMINDER', { reminderId: reminder.id })).data.status, 'cancelled')
  assert.equal(app.alarms.size, 0)
  app.setTime('2030-01-04T10:00:00Z')
  app.fire(reminder.id)
  assert.equal((await app.send('LIST_LOCAL_REMINDERS')).data[0].status, 'cancelled')
})

test('worker restart restores future alarms and marks missed reminders due', async () => {
  const first = worker()
  await first.send('CREATE_LOCAL_REMINDER', { reminder: draft() })
  const future = worker(first.stored())
  await future.send('LIST_LOCAL_REMINDERS')
  assert.equal(future.alarms.size, 1)
  const overdue = { ...first.stored()[0], remindAt: '2029-12-31T00:00:00Z' }
  const restarted = worker([overdue, { invalid: true }])
  const listed = await restarted.send('LIST_LOCAL_REMINDERS')
  assert.equal(listed.data.length, 1)
  assert.equal(listed.data[0].status, 'due')
  assert.equal(restarted.stored()[0].status, 'due')
  assert.equal(restarted.alarms.size, 0)
})

test('alarm marks a reminder due; lists filter by source URL', async () => {
  const app = worker()
  const { data: reminder } = await app.send('CREATE_LOCAL_REMINDER', { reminder: draft() })
  app.setTime('2030-01-02T10:00:00Z')
  app.fire(reminder.id)
  assert.equal((await app.send('LIST_LOCAL_REMINDERS')).data[0].status, 'due')
  assert.equal((await app.send('LIST_LOCAL_REMINDERS', { sourceUrl: 'https://other.example/' })).data.length, 0)
})

test('failed scheduling can be retried without creating a duplicate reminder', async () => {
  const app = worker()
  await app.send('LIST_LOCAL_REMINDERS')
  app.failSchedule(true)
  assert.equal((await app.send('CREATE_LOCAL_REMINDER', { reminder: draft() })).error.code, 'REMINDER_STORAGE_ERROR')
  app.failSchedule(false)
  assert.equal((await app.send('CREATE_LOCAL_REMINDER', { reminder: draft() })).ok, true)
  assert.equal(app.stored().length, 1)
  assert.equal(app.alarms.size, 1)
})

test('missing reminders return a useful error', async () => {
  const app = worker()
  assert.equal((await app.send('DELETE_LOCAL_REMINDER', { reminderId: 'missing' })).error.code, 'REMINDER_NOT_FOUND')
  assert.equal((await app.send('UPDATE_LOCAL_REMINDER', { reminderId: 'missing', update: draft() })).error.code, 'REMINDER_NOT_FOUND')
})
