import { expect, test } from 'claude-code/testing'

for (const [graph, remote] of [
  [true, 'https://github.com/yirasso/nau.git'],
  [false, ''],
] as const) {
  test(`Setup Project is a button only while GitHub, graphify or Ponytail is missing, and sets them up in code (${graph ? 'with' : 'without'})`, async ($, on) => {
    const files: Record<string, string> = { 'package.json': JSON.stringify({ scripts: { start: 'electron-vite dev' } }), 'C:/Dev/Nau/.gitignore': 'node_modules/' }
    const key = (path: string) => path.replace(/\\/g, '/')
    on('fs.read', async (_$: unknown, e: { path: string }) => (key(e.path) in files ? { value: files[key(e.path)] } : { deny: 'ENOENT' }) as never)
    on('fs.write', async (_$: unknown, e: { path: string; text: string }) => ((files[key(e.path)] = e.text), { value: undefined }) as never)
    on('fs.exists', async () => ({ value: false }))
    on('settings.read', async () => ({ value: graph ? { enabledPlugins: { 'ponytail@ponytail': true } } : {} }) as never)
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('fs.list', async () => ({ value: graph ? [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: Date.now() - 2 * 86_400_000, isLink: false }] : [{ name: 'package.json', kind: 'file', size: 64, mtimeMs: 0, isLink: false }] }) as never)
    const ran: string[] = []
    on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
      const cmd = e.argv.join(' ')
      ran.push(cmd)
      const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
      if (cmd === 'graphify update .') return ok('Code graph updated.\n')
      if (cmd === 'git ls-files') return ok('README.md\nsrc/main.ts\ndocs/guide.md\n')
      if (cmd.includes('remote get-url')) return { value: { exitCode: remote ? 0 : 2, stdout: remote, stderr: '' } } as never
      if (cmd.includes('rev-parse')) return ok(graph ? 'main\n' : 'false\n')
      return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    })
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    on('agent.register', async (_$: unknown, e: { name: string }) => ({ value: { agent: `claudify:${e.name}` } }) as never)
    const spawned: { subagent_type?: string; prompt: string }[] = []
    on('agent.spawn', async (_$: unknown, e: { subagent_type?: string; prompt: string }) => (spawned.push(e), { model: 'claude-sonnet-5-5', agentId: 'a1' }) as never)
    let model = ''
    on('model.complete', async (_$: unknown, e: { model: string }) => ((model = e.model), { value: { isAnswered: true, text: 'Initial commit', usage: {} } }) as never)
    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'terminal', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    // With GitHub, a graph and Ponytail there is nothing left to set up: the button leaves.
    expect(!!(await ui.find({ key: 'project:setup' }))).toBe(!graph)
    if (graph) return

    await ui.press({ key: 'project:setup' })
    // Ponytail on in the project's settings, graphify-out/ ignored, the code graph built with no model.
    expect(JSON.parse(files['C:/Dev/Nau/.claude/settings.json'] ?? '{}').enabledPlugins).toEqual({ 'ponytail@ponytail': true })
    expect(files['C:/Dev/Nau/.gitignore']).toBe('node_modules/\ngraphify-out/\n')
    expect(ran).toContain('graphify update .')
    // Only the docs go to Sonnet, as the band's own agent.
    expect(spawned.length).toBe(1)
    expect(spawned[0]?.subagent_type).toBe('claudify:graph-docs')
    expect(spawned[0]?.prompt).toContain('README.md\ndocs/guide.md')
    expect(spawned[0]?.prompt).not.toContain('src/main.ts')
    // The first commit's message comes from Sonnet, and nothing is pushed before the person confirms.
    expect(model).toBe('claude-sonnet-5-5')
    expect(await ui.find({ key: 'github:confirm' })).toBeTruthy()
    expect(ran.some(c => c.startsWith('gh repo create'))).toBe(false)
  })
}

for (const stale of [true, false]) {
  test(`graphify: a yellow dot and Update Graph only with commits newer than the graph (${stale ? 'stale' : 'current'})`, async ($, on) => {
    on('fs.read', async () => ({ value: '{}' }))
    on('fs.exists', async () => ({ value: false }))
    on('settings.read', async () => ({ value: {} }) as never)
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('fs.list', async () => ({ value: [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: 1_700_000_000_000, isLink: false }] }) as never)
    let since = ''
    const ran: string[] = []
    on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
      const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
      ran.push(e.argv.join(' '))
      if (e.argv[0] === 'graphify') return ok()
      if (e.argv[1] === 'log' && e.argv.includes('--name-only')) return ok('hooks/register.tsx\n')
      if (e.argv[1] === 'log') return (since = e.argv[2] ?? ''), ok(stale ? 'abc123\n' : '')
      if (e.argv.join(' ') === 'git rev-parse --is-inside-work-tree') return ok('true\n')
      return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    })
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    let spawned = 0
    on('agent.spawn', async () => (spawned++, { model: 'claude-sonnet-5-5', agentId: 'a1' }) as never)
    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    // The commits are read from the graph's own date.
    expect(since).toBe('--since=@1700000000')
    expect(!!(await ui.find({ key: 'graphify:update' }))).toBe(stale)
    if (!stale) return
    await ui.press({ key: 'graphify:update' })
    expect(ran).toContain('graphify update .')
    // Only code changed: no model runs.
    expect(spawned).toBe(0)
  })
}
