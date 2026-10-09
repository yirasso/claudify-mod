import { expect, test } from 'claude-code/testing'

for (const [graph, remote] of [
  [true, 'https://github.com/yirasso/nau.git'],
  [false, ''],
] as const) {
  test(`Setup Project is a button only while GitHub, graphify or Ponytail is missing (${graph ? 'with' : 'without'})`, async ($, on) => {
    on('fs.read', async () => ({ value: JSON.stringify({ scripts: { start: 'electron-vite dev' } }) }))
    on('fs.exists', async () => ({ value: false }))
    on('settings.read', async () => ({ value: graph ? { enabledPlugins: { 'ponytail@ponytail': true } } : {} }) as never)
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('fs.list', async () => ({ value: graph ? [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: Date.now() - 2 * 86_400_000, isLink: false }] : [] }) as never)
    on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
      const cmd = e.argv.join(' ')
      if (cmd.includes('remote get-url')) return { value: { exitCode: remote ? 0 : 2, stdout: remote, stderr: '' } } as never
      if (cmd.includes('rev-parse')) return { value: { exitCode: 0, stdout: 'main\n', stderr: '' } } as never
      return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    })
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    on('tool.list', async () => ({ value: [] }))
    let sent = ''
    on('prompt.submit', async (_$: unknown, e: { text: string }) => ((sent = e.text), { drop: 'test' }) as never)

    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'terminal', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    // With GitHub, a graph and Ponytail there is nothing left to set up: the button leaves.
    expect(!!(await ui.find({ key: 'project:setup' }))).toBe(!graph)
    if (graph) return

    // Its message asks for the graph, and for graphify-out/ in .gitignore with it.
    await ui.press({ key: 'project:setup' })
    expect(sent).toContain('/graphify')
    expect(sent).toContain('graphify-out/ to .gitignore')
  })
}
