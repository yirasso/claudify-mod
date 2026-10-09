import { expect, test } from 'claude-code/testing'

const GMAIL = '048e7fe9-3b5b-4646-87a5-b93f826a27a8'
const CAL = '3d463a8e-4e52-44d0-855b-161b4f827fe8'

test('connectors, servers, plugins and built-ins each go in their own place', async ($, on) => {
  on('tool.list', async () => ({
    value: [
      { name: `mcp__${GMAIL}__create_draft`, description: "Creates a new draft email in the authenticated user's Gmail account. Upload to Drive first.", mcp: true },
      { name: `mcp__${GMAIL}__search_threads`, description: "Searches the user's Gmail threads.", mcp: true },
      { name: `mcp__${CAL}__create_event`, description: 'Creates an event.', mcp: true },
      { name: `mcp__${CAL}__list_calendars`, description: 'Lists the calendars.', mcp: true },
      { name: 'mcp__ccd_session__mark_chapter', description: 'Marks a chapter.', mcp: true },
      { name: 'mcp__Roblox_Studio__run_code', description: 'Runs code.', mcp: true },
      { name: 'mcp__plugin_supabase_supabase__execute_sql', description: 'Runs SQL.', mcp: true },
    ],
  }))
  on('session.usage', async () =>
    ({
      value: {
        startedAt: 0,
        rateLimits: [],
        context: {
          breakdown: {
            mcpTools: [],
            skills: {
              skillFrontmatter: [
                { name: 'grilling', source: 'userSettings', tokens: 1 },
                { name: 'simplify', source: 'built-in', tokens: 1 },
                { name: 'supabase:supabase', source: 'plugin', pluginName: 'supabase', tokens: 1 },
                { name: 'anthropic-skills:docx', source: 'plugin', pluginName: 'anthropic-skills', tokens: 1 },
              ],
            },
          },
        },
      },
    }) as never,
  )
  on('ui.open', async () => ({ value: {} }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('fs.read', async () => ({ deny: 'no package.json' }) as never)
  on('fs.exists', async () => ({ value: false }))

  await $.command.run({ command: 'claudify', args: '', origin: { kind: 'user' } } as never)
  const ui = await $.ui.mount({
    plugin: 'usage-board',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'usage-board',
    props: { title: 'Claude', isFocused: false } as never,
    viewport: { columns: 80, rows: 60 } as never,
  })
  const shown = async (): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const label = async (key: string): Promise<string> => (await ui.find({ key }))?.text ?? ''

  // The account's connectors, by product name.
  expect(await label('toggle:connectors')).toContain('Connectors · 2')
  expect(await shown()).toContain('Gmail')
  expect(await shown()).toContain('Google Calendar')
  expect((await shown()).join(' ')).not.toContain(GMAIL)

  // Own servers in view; the Claude Desktop pieces in the drawer, closed.
  expect(await shown()).toContain('Roblox Studio')
  expect(await label('toggle:mcp:builtin')).toContain('Built-in (Claude Desktop) · 1')
  expect(await shown()).not.toContain('ccd session')
  await ui.press({ key: 'toggle:mcp:builtin' })
  expect(await shown()).toContain('ccd session')

  // Your skills in view; Claude Code's in the drawer.
  expect(await shown()).toContain('grilling')
  expect(await shown()).not.toContain('simplify')
  expect(await label('toggle:skills:builtin')).toContain('Built-in · 1')

  // Plugins apart: supabase (with its skill and server) in view, Anthropic's in the drawer.
  expect(await label('toggle:plugins')).toContain('Plugins · 2')
  expect(await label('toggle:plugin:supabase')).toContain('1 skills · 1 servers')
  expect(await label('toggle:plugins:builtin')).toContain('Built-in (Anthropic) · 1')
  expect(await shown()).not.toContain('supabase:supabase')
  await ui.press({ key: 'toggle:plugin:supabase' })
  expect(await shown()).toContain('supabase:supabase')
})

test('a removed connector or a deleted skill leaves the pane on the next read', async ($, on) => {
  let tools = [{ name: `mcp__${GMAIL}__search_threads`, description: "Searches the user's Gmail threads.", mcp: true }]
  let skills = [{ name: 'grilling', source: 'userSettings', tokens: 1 }]
  on('tool.list', async () => ({ value: tools }))
  on('session.usage', async () => ({ value: { startedAt: 0, rateLimits: [], context: { breakdown: { mcpTools: [], skills: { skillFrontmatter: skills } } } } }) as never)
  on('ui.open', async () => ({ value: {} }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('fs.read', async () => ({ deny: 'no package.json' }) as never)
  on('fs.exists', async () => ({ value: false }))
  // The connector is used once, so it has a «last used» time.
  on('tool.call', async () => ({ result: { content: [] } }) as never)

  await $.command.run({ command: 'claudify', args: '', origin: { kind: 'user' } } as never)
  await $.tool.call({ tool: `mcp__${GMAIL}__search_threads` } as never)
  const ui = await $.ui.mount({ plugin: 'usage-board', surface: 'terminal', component: 'Pane', requestId: 'usage-board', props: { title: 'Claude', isFocused: false } as never, viewport: { columns: 80, rows: 60 } as never })
  const shown = async (): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(await shown()).toContain('Gmail')
  expect(await shown()).toContain('grilling')

  tools = []
  skills = []
  // /claudify toggles: the first run closes the pane, the second opens it again and reads the session afresh.
  await $.command.run({ command: 'claudify', args: '', origin: { kind: 'user' } } as never)
  await $.command.run({ command: 'claudify', args: '', origin: { kind: 'user' } } as never)
  expect(await shown()).not.toContain('Gmail')
  expect(await shown()).not.toContain('grilling')
})
