import { expect, test } from 'claude-code/testing'

/** Lets a running script's loop and a button's handler move on (all in-process, a few turns of the queue). */
const nap = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

for (const [files, cmd] of [
  [['Cargo.toml'], 'cargo run'],
  [['uv.lock', 'main.py'], 'uv run python main.py'],
  [['manage.py'], 'python manage.py runserver'],
  [['go.mod'], 'go run .'],
] as const) {
  test(`Start Project beyond npm: ${cmd}`, async ($, on) => {
    on('fs.read', async () => ({ deny: 'ENOENT' }) as never)
    on('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: (files as readonly string[]).some(f => e.path.replace(/\\/g, '/').endsWith(`/${f}`)) }) as never)
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('env.get', async () => ({ value: undefined }))
    let argv: readonly string[] = []
    on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[] }) {
      argv = e.argv
      return { value: { code: 0, signal: null } }
    } as never)
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    const button = (await ui.findAll({ type: 'Button' })).find(b => b.text.includes('Start Project'))
    expect(button).toBeTruthy()
    await ui.press({ key: button?.key ?? '' })
    expect(argv.join(' ')).toContain(cmd)
  })
}

test('a run with an address gets Open; a run that found its port taken gets Free port, which frees it and starts again', async ($, on) => {
  on('fs.read', async () => ({ value: JSON.stringify({ scripts: { dev: 'next dev' } }) }))
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }) as never)
  let starts = 0
  let release: () => void = () => undefined
  on('process.spawn', async function* () {
    starts++
    if (starts === 1) {
      yield { stream: 'stderr' as const, text: '__PID__=11\nError: listen EADDRINUSE: address already in use :::3000\n' }
      return { value: { code: 1, signal: null } }
    }
    yield { stream: 'stdout' as const, text: '__PID__=12\n  - Local: http://localhost:3000\n' }
    await new Promise<void>(r => (release = r))
    return { value: { code: 0, signal: null } }
  } as never)
  const ran: string[] = []
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    ran.push(e.argv.join(' '))
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (e.argv[0] === 'netstat') return ok('  TCP    0.0.0.0:3000     0.0.0.0:0    LISTENING    999\n  TCP    0.0.0.0:30001    0.0.0.0:0    LISTENING    555\n')
    return ok()
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  await ui.press({ key: 'script:dev' })
  expect((await ui.find({ key: 'script:free:dev' }))?.text).toContain('Free port 3000')

  // Frees port 3000 (PID 999, not the one on 30001) and starts again; the new run shows its address and Open.
  void ui.press({ key: 'script:free:dev' })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'script:open:dev' })); i++) await nap()
  expect(ran).toContain('taskkill /PID 999 /T /F')
  expect(ran.some(c => c.includes('/PID 555'))).toBe(false)
  await ui.press({ key: 'script:open:dev' })
  expect(ran).toContain('rundll32 url.dll,FileProtocolHandler http://localhost:3000')
  release()
  for (let i = 0; i < 50 && (await ui.findAll({ type: 'Text' })).every(t => !t.text.includes('dev finished')); i++) await nap()
})

test('Pull: shown while GitHub is ahead; pulls, then the code graph follows with no model and changed docs wait', async ($, on) => {
  const files: Record<string, string> = {}
  const key = (path: string) => path.replace(/\\/g, '/')
  on('fs.read', async (_$: unknown, e: { path: string }) => (key(e.path) in files ? { value: files[key(e.path)] } : { deny: 'ENOENT' }) as never)
  on('fs.write', async (_$: unknown, e: { path: string; text: string }) => ((files[key(e.path)] = e.text), { value: undefined }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: 1_700_000_000_000, isLink: false }] }) as never)
  let pulled = false
  const ran: string[] = []
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const cmd = e.argv.join(' ')
    ran.push(cmd)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'git rev-parse --is-inside-work-tree') return ok('true\n')
    if (cmd === 'git remote get-url origin') return ok('https://github.com/yirasso/nau.git\n')
    if (cmd === 'git rev-parse --abbrev-ref @{u}') return ok('origin/main\n')
    if (cmd === 'git rev-list --count HEAD..@{u}') return ok(pulled ? '0\n' : '2\n')
    if (cmd === 'git pull --ff-only') return (pulled = true), ok('Fast-forward\n')
    if (cmd.startsWith('git log') && cmd.includes('--name-only')) return ok('src/app.ts\nREADME.md\n')
    if (cmd === 'graphify update .') return ok()
    return ok('')
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  let models = 0
  on('model.complete', async () => (models++, { value: { isAnswered: false, reason: 'aborted', usage: {} } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect((await ui.find({ key: 'github:pull' }))?.text).toContain('Pull (2)')
  await ui.press({ key: 'github:pull' })
  expect(ran).toContain('git pull --ff-only')
  expect(ran).toContain('graphify update .')
  expect(models).toBe(0)
  // README.md changed: it waits for Update Graph, from the graph's date.
  expect(files['C:/Dev/Nau/graphify-out/.claudify_docs_since']).toBe('1700000000000')
  expect(await ui.find({ key: 'github:pull' })).toBeUndefined()
  expect(await ui.find({ key: 'graphify:update' })).toBeTruthy()
})

for (const stale of [true, false]) {
  test(`Install deps only while the lockfile is newer than the last install (${stale ? 'newer' : 'installed'})`, async ($, on) => {
    const mtimes: Record<string, number> = { 'package.json': 100, 'package-lock.json': stale ? 300 : 150, 'node_modules/.package-lock.json': 200, node_modules: 200 }
    on('fs.read', async () => ({ value: JSON.stringify({ scripts: { dev: 'vite' } }) }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.stat', async (_$: unknown, e: { path: string }) => {
      const rel = e.path.replace(/\\/g, '/').replace(/^C:\/Dev\/Nau\//, '')
      return (rel in mtimes ? { value: { kind: 'file', size: 1, mtimeMs: mtimes[rel], isLink: false } } : { deny: 'ENOENT' }) as never
    })
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('env.get', async () => ({ value: undefined }))
    let argv: readonly string[] = []
    on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[] }) {
      argv = e.argv
      return { value: { code: 0, signal: null } }
    } as never)
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    expect(!!(await ui.find({ key: 'script:install' }))).toBe(stale)
    if (!stale) return
    await ui.press({ key: 'script:install' })
    expect(argv.join(' ')).toContain('npm install')
  })
}

test('from 70% a limit bar says how long until it resets', async ($, on) => {
  const soon = new Date(Date.now() + 40 * 60_000 - 1000).toISOString()
  const later = new Date(Date.now() + (2 * 86_400_000 + 5 * 3_600_000 - 1000)).toISOString()
  on('fs.read', async () => ({ deny: 'ENOENT' }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: soon }, { kind: 'seven_day', percentUsed: 40, resetsAt: later }] } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(shown).toContain('5h ███████░ 92% · 40m')
  // Under 70%: no countdown.
  expect(shown).toContain('Week ███░░░░░ 40%\n')
})
