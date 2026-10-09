import { expect, test } from 'claude-code/testing'

/** A repo on GitHub, `behind` commits behind; `answer` answers the commands the test cares about. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function repo(on: (...args: any[]) => unknown, ran: string[], answer: (cmd: string) => { exitCode: number; stdout?: string; stderr?: string } | undefined) {
  on('fs.read', async (_$: unknown, e: { path: string }) => (e.path.replace(/\\/g, '/').endsWith('/package.json') ? { value: JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }) } : { deny: 'ENOENT' }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const cmd = e.argv.join(' ')
    ran.push(cmd)
    const own = answer(cmd)
    if (own) return { value: { stdout: '', stderr: '', ...own } } as never
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'git rev-parse --is-inside-work-tree') return ok('true\n')
    if (cmd === 'git remote get-url origin') return ok('https://github.com/yirasso/nau.git\n')
    if (cmd === 'git remote -v') return ok('origin\thttps://github.com/yirasso/nau.git (push)\n')
    if (cmd === 'git rev-parse --abbrev-ref @{u}') return ok('origin/main\n')
    if (cmd === 'git rev-list --count HEAD..@{u}') return ok('2\n')
    return ok('')
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)
}

test('a pull that stops on conflicts offers them to Claude', async ($, on) => {
  const ran: string[] = []
  repo(on, ran, cmd => {
    if (cmd === 'git pull --rebase --autostash') return { exitCode: 1, stderr: 'CONFLICT (content): Merge conflict in src/app.ts\nerror: could not apply abc123' }
    if (cmd === 'git diff --name-only --diff-filter=U') return { exitCode: 0, stdout: 'src/app.ts\nsrc/store.ts\n' }
    return undefined
  })
  let sent = ''
  on('prompt.submit', async (_$: unknown, e: { text: string }) => ((sent = e.text), { drop: 'test' }) as never)
  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  await ui.press({ key: 'github:pull' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('Conflicts: src/app.ts, src/store.ts')
  await ui.press({ key: 'github:conflicts' })
  expect(sent).toContain('- src/app.ts\n- src/store.ts')
  expect(sent).toContain('git rebase --continue')
})

test('a push GitHub refuses says to Pull first and asks GitHub what it has', async ($, on) => {
  const ran: string[] = []
  repo(on, ran, cmd => {
    if (cmd === 'git status --porcelain') return { exitCode: 0, stdout: ' M src/app.ts\n' }
    if (cmd === 'git push') return { exitCode: 1, stderr: ' ! [rejected]        main -> main (fetch first)' }
    return undefined
  })
  on('model.complete', async () => ({ value: { isAnswered: true, text: 'Change the app', usage: {} } }) as never)
  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  await ui.press({ key: 'github:start' })
  await ui.press({ key: 'github:confirm' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('GitHub has newer commits: Pull, then Save Changes again.')
  expect(ran.filter(c => c === 'git fetch --quiet').length >= 2).toBe(true)
})

test('Build runs the build script, and a failed build offers Send error', async ($, on) => {
  const ran: string[] = []
  repo(on, ran, () => undefined)
  let argv: readonly string[] = []
  on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[] }) {
    argv = e.argv
    yield { stream: 'stderr' as const, text: '__PID__=9\nerror during build: Could not resolve "./missing"\n' }
    return { value: { code: 1, signal: null } }
  } as never)
  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  await ui.press({ key: 'script:build' })
  expect(argv.join(' ')).toContain('npm run build')
  expect(await ui.find({ key: 'script:send:build' })).toBeTruthy()
})
