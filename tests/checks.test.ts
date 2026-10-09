import { expect, test } from 'claude-code/testing'

for (const [graph, remote] of [
  [true, 'https://github.com/yirasso/nau.git'],
  [false, ''],
] as const) {
  test(`the project says whether it has graphify and GitHub (${graph ? 'with' : 'without'})`, async ($, on) => {
    on('fs.read', async () => ({ value: JSON.stringify({ scripts: { start: 'electron-vite dev' } }) }))
    on('fs.exists', async () => ({ value: false }))
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('fs.list', async () => ({ value: graph ? [{ name: 'graph.json', kind: 'file', size: 0, mtimeMs: Date.now() - 2 * 86_400_000, isLink: false }] : [] }) as never)
    on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
      const cmd = e.argv.join(' ')
      if (cmd.includes('remote get-url')) return { value: { exitCode: remote ? 0 : 2, stdout: remote, stderr: '' } } as never
      if (cmd.includes('rev-parse')) return { value: { exitCode: 0, stdout: 'main\n', stderr: '' } } as never
      return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    })
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    on('tool.list', async () => ({ value: [] }))
    on('ui.open', async () => ({ value: {} }) as never)
    on('command.register', async () => ({ value: undefined }) as never)

    await $.command.run({ command: 'claudify', args: '', origin: { kind: 'user' } } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-board',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'usage-board',
      props: { title: 'Claude', isFocused: false } as never,
      viewport: { columns: 80, rows: 60 } as never,
    })
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    if (graph) {
      expect(text).toContain('built 2 days ago')
      expect(text).toContain('yirasso/nau · main')
    } else {
      expect(text).toContain('no graph (run /graphify)')
      expect(text).toContain('no repository connected')
    }
  })
}
