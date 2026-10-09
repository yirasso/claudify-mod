import { expect, test } from 'claude-code/testing'

test('the band above the prompt carries the actions, and Compact compacts the conversation', async ($, on) => {
  on('fs.read', async () => ({ value: JSON.stringify({ scripts: { dev: 'vite' } }) }))
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async () => ({ value: undefined }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.list', async () => ({ value: [] }))
  let compacted = 0
  on('session.compact', async () => (compacted++, { skip: 'test' }) as never)

  const band = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await band.find({ key: 'band:toggle' })).toBeDefined()
  expect((await band.find({ key: 'session:compact' }))?.text).toContain('Compact')
  expect((await band.find({ key: 'github:start' }))?.text).toContain('Save Changes')
  expect((await band.find({ key: 'project:setup' }))?.text).toContain('Setup Project')

  await band.press({ key: 'session:compact' })
  expect(compacted).toBe(1)
})
