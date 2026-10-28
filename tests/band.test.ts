import { expect, mock, test } from 'claude-code/testing'

const MORE = { key: 'more', link: { href: 'https://mini-ribbon.invalid/more' } }

const WINDOWS = [
  { kind: 'five_hour', percentUsed: 58, resetsAt: '2099-01-01T00:00:00Z' },
  { kind: 'seven_day', percentUsed: 12.5 },
]

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

test('usage is folded until More opens it, 7D before 5H', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'mini-ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: 'CACHE · waiting for the first reply' })).toBeDefined()
  expect(await band.find({ text: '42% left' })).toBeUndefined()
  expect((await band.find({ key: 'more' }))?.props.text).toContain('[More]')

  await band.press(MORE)
  expect(await band.find({ text: '42% left' })).toBeDefined()
  expect(await band.find({ text: '87.5% left' })).toBeDefined()
  const all = JSON.stringify(await band.find({ type: 'Box' }))
  expect(all.indexOf('7D')).toBeLessThan(all.indexOf('5H'))
  expect((await band.find({ key: 'more' }))?.props.text).toContain('[Less]')

  await band.press(MORE)
  expect(await band.find({ text: '42% left' })).toBeUndefined()
  await band.unmount()
})

test('in a narrow band opened usage stacks, with percent left and reset time on their own lines', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'mini-ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 36 } })
  await band.press(MORE)
  expect(await band.find({ text: '42% left' })).toBeDefined()
  expect(await band.find({ text: 'resets 2h 0m' })).toBeDefined()
  await band.unmount()
})

test('the terminal shows no usage and no More link', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'mini-ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '42% left' })).toBeUndefined()
  expect(await band.find({ key: 'more' })).toBeUndefined()
  await band.unmount()
})
