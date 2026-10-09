import { expect, test } from 'claude-code/testing'

test('the band above the prompt carries the actions and a dot for each check, and no Compact', async ($, on) => {
  on('fs.read', async () => ({ value: JSON.stringify({ scripts: { dev: 'vite' } }) }))
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async () => ({ value: undefined }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.list', async () => ({ value: [] }))

  const band = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await band.find({ key: 'session:compact' })).toBeUndefined()
  expect((await band.find({ key: 'github:start' }))?.text).toContain('Save Changes')
  expect((await band.find({ key: 'project:setup' }))?.text).toContain('Setup Project')
  // Nothing set up in the test: every check shows off.
  expect(await band.find({ type: 'Text', text: /○ GitHub/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /○ graphify/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /○ Ponytail/ })).toBeDefined()
})
