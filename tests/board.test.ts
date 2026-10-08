import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

const pane = (surface: (typeof SURFACES)[number]) => ({
  plugin: 'usage-board',
  surface,
  component: 'Pane' as const,
  requestId: 'usage-board',
  props: { title: 'Claude', isFocused: false } as never,
  viewport: { columns: 60, rows: 40 } as never,
})

for (const surface of SURFACES) {
  test(`an MCP server is «in use» while its tool runs (${surface})`, async ($, on) => {
    let during = ''
    // The test stands in for the engine: while the tool «runs», it reads the pane.
    on('tool.call', { tool: 'mcp__Roblox_Studio__run_code' }, async () => {
      during = await shown()
      return { result: { content: [] } } as never
    })
    const ui = await $.ui.mount(pane(surface))
    const shown = async (): Promise<string> => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    await $.tool.call({ tool: 'mcp__Roblox_Studio__run_code' } as never)
    expect(during).toContain('in use')

    // Not in the session's list: it showed only while in use, and leaves with the call.
    const after = await shown()
    expect(after).not.toContain('in use')
    expect(after).not.toContain('Roblox Studio')
  })

  test(`a skill called through Skill lights up, and the section collapses and expands (${surface})`, async ($, on) => {
    on('tool.call', { tool: 'Skill' }, async () => ({ result: { success: true } }) as never)
    await $.tool.call({ tool: 'Skill', skill: 'impeccable' } as never)
    const ui = await $.ui.mount(pane(surface))
    const texts = async (): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect((await ui.find({ key: 'toggle:skills' }))?.text).toContain('1 in use')
    expect(await texts()).toContain('impeccable')

    await ui.press({ key: 'toggle:skills' })
    expect((await ui.find({ key: 'toggle:skills' }))?.text).toContain('▸ Skills')
    expect(await texts()).not.toContain('impeccable')
    await ui.press({ key: 'toggle:skills' })
    expect(await texts()).toContain('impeccable')
  })
}

test('the band above the prompt shows and hides the pane', async ($, on) => {
  const calls: string[] = []
  on('ui.open', async () => (calls.push('open'), { value: { isPlaced: true } }) as never)
  on('ui.close', async () => (calls.push('close'), { value: undefined }) as never)
  const band = await $.ui.mount({ plugin: 'usage-board', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect((await band.find({ key: 'band:toggle' }))?.text).toContain('Show Claude panel')
  await band.press({ key: 'band:toggle' })
  expect(calls).toEqual(['open'])
  expect((await band.find({ key: 'band:toggle' }))?.text).toContain('Hide Claude panel')
  await band.press({ key: 'band:toggle' })
  expect(calls).toEqual(['open', 'close'])
  expect((await band.find({ key: 'band:toggle' }))?.text).toContain('Show Claude panel')
})
