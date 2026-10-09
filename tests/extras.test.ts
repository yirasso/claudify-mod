import { expect, test } from 'claude-code/testing'

/** A repo on GitHub on a feature branch, with `files` changed and the last commit `hoursAgo` hours ago. */
// The test's `on`, loosely typed: each call below names its own event.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function repo(on: (...args: any[]) => unknown, files: number, hoursAgo: number, ran: string[]) {
  on('fs.read', async () => ({ deny: 'ENOENT' }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }) as never)
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const cmd = e.argv.join(' ')
    ran.push(cmd)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'git rev-parse --is-inside-work-tree') return ok('true\n')
    if (cmd === 'git remote get-url origin') return ok('https://github.com/yirasso/nau.git\n')
    if (cmd === 'git remote -v') return ok('origin\thttps://github.com/yirasso/nau.git (push)\n')
    if (cmd === 'git rev-parse --abbrev-ref HEAD') return ok('feature/login\n')
    if (cmd === 'git status --porcelain') return ok(Array.from({ length: files }, (_, i) => ` M src/f${i}.ts`).join('\n'))
    if (cmd === 'git log -1 --format=%ct') return ok(`${Math.floor((Date.now() - hoursAgo * 3_600_000) / 1000)}\n`)
    if (cmd === 'git rev-parse HEAD') return ok('abc1234def\n')
    return ok('')
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)
}

for (const [files, hoursAgo, nudged] of [
  [3, 0.5, false],
  [20, 0.5, true],
  [3, 3, true],
] as const) {
  test(`the branch shows off main, and Save Changes counts the files and stands out when it is time (${files} files, ${hoursAgo} h)`, async ($, on) => {
    repo(on, files, hoursAgo, [])
    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('⎇ feature/login')
    const save = await ui.find({ key: 'github:start' })
    expect(save?.text).toContain(`Save Changes (${files})`)
    expect((save as { props?: { variant?: string } } | undefined)?.props?.variant === 'primary').toBe(nudged)
  })
}

test('after Save Changes, Undo reverts the commit and pushes the revert', async ($, on) => {
  const ran: string[] = []
  repo(on, 2, 0.5, ran)
  on('model.complete', async () => ({ value: { isAnswered: true, text: 'Add login', usage: {} } }) as never)
  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  await ui.press({ key: 'github:start' })
  // The push names the branch it goes to.
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('yirasso/nau ⎇ feature/login')
  await ui.press({ key: 'github:confirm' })
  await ui.press({ key: 'github:undo' })
  expect(ran).toContain('git revert --no-edit abc1234def')
  expect(ran.filter(c => c === 'git push').length).toBe(2)
})

test('the bell turns the done sound for long turns on and off, and the folder and editor buttons open them', async ($, on) => {
  const ran: string[] = []
  repo(on, 0, 0.5, ran)
  const stored: Record<string, unknown> = {}
  on('store.get', async (_$: unknown, e: { key: string }) => ({ value: stored[e.key] }) as never)
  on('store.set', async (_$: unknown, e: { key: string; value: unknown }) => ((stored[e.key] = e.value), { value: undefined }) as never)
  on('turn.complete', async () => ({ text: 'done' }) as never)
  const later = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise<void>(r => later(r, 5))
  }
  const turn = async (ms: number) => {
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: ms, isAborted: false, turnId: 't' } as never)
    await settle()
  }
  const toasts = () => ran.filter(c => c.startsWith('powershell.exe') && c.includes('SoundPlayer') && c.includes('done.wav')).length

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  await turn(20_000)
  expect(toasts()).toBe(0)
  await turn(90_000)
  expect(toasts()).toBe(1)
  await ui.press({ key: 'notify:toggle' })
  expect(stored.notify).toBe(false)
  expect((await ui.find({ key: 'notify:toggle' }))?.text).toContain('🔕')
  await turn(90_000)
  expect(toasts()).toBe(1)

  await ui.press({ key: 'project:folder' })
  await ui.press({ key: 'project:editor' })
  expect(ran).toContain("powershell.exe -NoProfile -NonInteractive -Command Invoke-Item -LiteralPath 'C:\\Dev\\Nau'")
  expect(ran).toContain('cmd /c code C:/Dev/Nau')
})
