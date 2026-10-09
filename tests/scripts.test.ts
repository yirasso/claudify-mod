import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

for (const surface of SURFACES) {
  test(`the «dev» button runs the script and the band shows its output (${surface})`, async ($, on) => {
    // The test stands in for the engine: a project with a `dev` script, no lockfiles, not on Windows.
    on('fs.read', async () => ({ value: JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }) }))
    on('fs.exists', async () => ({ value: false }))
    on('env.get', async () => ({ value: undefined }))
    let argv: readonly string[] = []
    on("process.spawn", async function* (_$: unknown, e: { argv: readonly string[] }) {
      argv = e.argv
      yield { stream: 'stdout' as const, text: '__PID__=4242\n' }
      yield { stream: 'stdout' as const, text: '\u001b[32mVITE\u001b[0m ready\n  Local: http://localhost:5173/\n' }
      return { value: { code: 0, signal: null } }
    } as never)
    // Without a real session, the pane reads the rest as empty.
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    on('tool.list', async () => ({ value: [] }))

    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'terminal', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    expect((await ui.find({ key: 'script:dev' }))?.text).toContain('Start Project')
    expect(await ui.find({ key: 'script:start' })).toBeUndefined()

    await ui.press({ key: 'script:dev' })
    expect(argv.join(' ')).toContain('npm run dev')
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(text).toContain('dev finished')
    expect(text).not.toContain('__PID__')
  })
}

test('stopping a script with the button shows «stopped», not a failed exit', async ($, on) => {
  on('fs.read', async () => ({ value: JSON.stringify({ scripts: { start: 'electron-vite dev --watch' } }) }))
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async () => ({ value: undefined }))
  let release: () => void = () => undefined
  const killed = new Promise<void>(r => (release = r))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: '__PID__=4242\nstarting electron app...\n' }
    await killed
    return { value: { code: 1, signal: null } }
  } as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    if (e.argv[0] === 'kill' || e.argv[0] === 'taskkill') release()
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.list', async () => ({ value: [] }))

  // The test kit's engine has the clock too; its typings leave it out.
  // Lets the script's loop and the button's handler run (all in-process, so a few turns of the queue).
  const nap = async (_ms: number): Promise<void> => {
    for (let i = 0; i < 50; i++) await Promise.resolve()
  }
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)
  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  void ui.press({ key: 'script:start' })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'script:start' }))?.text.includes('Stop Project'); i++) await nap(10)
  await ui.press({ key: 'script:start' })
  for (let i = 0; i < 50 && (await ui.findAll({ type: 'Text' })).every(t => !t.text.includes('stopped')); i++) await nap(10)
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(text.join(' ')).toContain('start stopped')
  expect(text.join(' ')).not.toContain('exited with code')
})
