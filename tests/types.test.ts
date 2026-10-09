import { expect, test } from 'claude-code/testing'

/** Lets background work move on (the kit's clock is not running). */
async function settle(): Promise<void> {
  const later = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout
  for (let i = 0; i < 10; i++) await new Promise<void>(r => later(r, 5))
}

test('after a turn that changed code the typecheck runs; a failure shows a red Types dot and sends its errors', async ($, on) => {
  let tree = ''
  let failing = true
  const ran: string[] = []
  on('fs.read', async () => ({ deny: 'ENOENT' }) as never)
  on('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: e.path.replace(/\\/g, '/').endsWith('/tsconfig.json') }) as never)
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }) as never)
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const cmd = e.argv.join(' ')
    ran.push(cmd)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'git rev-parse --is-inside-work-tree') return ok('true\n')
    if (cmd === 'git status --porcelain') return ok(tree)
    if (cmd.includes('tsc --noEmit')) return failing ? ({ value: { exitCode: 2, stdout: "src/app.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n", stderr: '' } } as never) : ok()
    return ok('')
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('turn.complete', async () => ({ text: 'done' }) as never)
  let sent = ''
  on('prompt.submit', async (_$: unknown, e: { text: string }) => ((sent = e.text), { drop: 'test' }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)
  const turn = async () => {
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't' } as never)
    await settle()
  }
  const shown = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  tree = ' M src/app.ts\n'
  await turn()
  expect(ran).toContain('cmd /c npx --no-install tsc --noEmit -p .')
  expect(await shown()).toContain('● Types')
  expect(await shown()).toContain('error TS2322')
  await ui.press({ key: 'types:send' })
  expect(sent).toContain("error TS2322: Type 'string' is not assignable to type 'number'.")
  // Fixed: the next turn's changes pass, and the errors go.
  failing = false
  tree = ' M src/app.ts\n M src/other.ts\n'
  await turn()
  expect(await shown()).not.toContain('error TS2322')
  expect(await ui.find({ key: 'types:send' })).toBeUndefined()
  // A turn that changed nothing does not run it again.
  const runs = ran.filter(c => c.includes('tsc')).length
  await turn()
  expect(ran.filter(c => c.includes('tsc')).length).toBe(runs)
})

test('/claudify off hides the band and stops the automatic work; /claudify brings it back', async ($, on) => {
  const stored: Record<string, unknown> = {}
  const ran: string[] = []
  on('fs.read', async () => ({ deny: 'ENOENT' }) as never)
  on('fs.exists', async () => ({ value: true }) as never)
  on('env.get', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => (ran.push(e.argv.join(' ')), { value: { exitCode: 0, stdout: e.argv.join(' ') === 'git status --porcelain' ? ' M a.ts\n' : '', stderr: '' } }) as never)
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('store.get', async (_$: unknown, e: { key: string }) => ({ value: stored[e.key] }) as never)
  on('store.set', async (_$: unknown, e: { key: string; value: unknown }) => ((stored[e.key] = e.value), { value: undefined }) as never)
  on('store.delete', async (_$: unknown, e: { key: string }) => (delete stored[e.key], { value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('turn.complete', async () => ({ text: 'done' }) as never)
  // The engine's own band, beneath the plugin: an empty box.
  const h = (globalThis as unknown as { h: (type: string, props: object) => unknown }).h
  on('ui.render', async () => h('Box', {}) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect((await ui.findAll({ type: 'Text' })).length > 0).toBe(true)

  const said = await $.command.run({ command: 'claudify', args: 'off' } as never)
  expect((said as { text?: string }).text).toContain('Claudify is off')
  expect(stored['off:c:/dev/nau']).toBe(true)
  expect((await ui.findAll({ type: 'Text' })).length).toBe(0)
  const before = ran.length
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't' } as never)
  await settle()
  expect(ran.slice(before).some(c => c.includes('tsc') || c.startsWith('graphify'))).toBe(false)

  await $.command.run({ command: 'claudify', args: '' } as never)
  expect(stored['off:c:/dev/nau']).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).length > 0).toBe(true)
})

for (const [label, files, expected] of [
  ["the project's typecheck script", { 'package.json': JSON.stringify({ scripts: { typecheck: 'tsc --noEmit -p tsconfig.web.json' } }), 'tsconfig.json': '{}' }, 'cmd /c npm run typecheck'],
  [
    'each tsconfig a references-only root lists',
    { 'tsconfig.json': '{\n  // electron-vite\n  "files": [],\n  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]\n}' },
    'cmd /c npx --no-install tsc --noEmit -p ./tsconfig.node.json && npx --no-install tsc --noEmit -p ./tsconfig.web.json',
  ],
] as const) {
  test(`the typecheck runs ${label}`, async ($, on) => {
    const ran: string[] = []
    const at = (path: string) => path.replace(/\\/g, '/').replace(/^C:\/Dev\/Nau\//, '')
    on('fs.read', async (_$: unknown, e: { path: string }) => (at(e.path) in files ? { value: (files as Record<string, string>)[at(e.path)] } : { deny: 'ENOENT' }) as never)
    on('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: at(e.path) in files }) as never)
    on('env.get', async (_$: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }) as never)
    on('settings.read', async () => ({ value: {} }) as never)
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('fs.list', async () => ({ value: [] }) as never)
    on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
      const cmd = e.argv.join(' ')
      ran.push(cmd)
      return { value: { exitCode: 0, stdout: cmd === 'git status --porcelain' ? ' M src/app.ts\n' : cmd === 'git rev-parse --is-inside-work-tree' ? 'true\n' : '', stderr: '' } } as never
    })
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    on('turn.complete', async () => ({ text: 'done' }) as never)
    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't' } as never)
    await settle()
    expect(ran).toContain(expected)
  })
}
