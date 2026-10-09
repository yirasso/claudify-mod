import { expect, test } from 'claude-code/testing'

type Case = { name: string; repo: boolean; remote: string; button: string; last: string }

const CASES: Case[] = [
  { name: 'no repo: creates it, commits and publishes it', repo: false, remote: '', button: 'Create GitHub repo & push', last: 'gh repo create nau --private --source . --remote origin --push' },
  { name: 'repo without GitHub: commits and publishes it', repo: true, remote: '', button: 'Publish to GitHub & push', last: 'gh repo create nau --private --source . --remote origin --push' },
  { name: 'repo on GitHub: commits and pushes', repo: true, remote: 'origin\thttps://github.com/yirasso/nau.git (fetch)', button: 'Commit & push', last: 'git push' },
]

for (const c of CASES) {
  test(`the GitHub button: ${c.name}`, async ($, on) => {
    const ran: string[] = []
    let message = ''
    let model = ''
    on('process.run', async (_$: unknown, e: { argv: readonly string[]; init?: { stdin?: string } }) => {
      const cmd = e.argv.join(' ')
      ran.push(cmd)
      const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
      if (cmd === 'git rev-parse --is-inside-work-tree') return c.repo ? ok('true\n') : ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } } as never)
      if (cmd === 'git remote -v') return ok(c.remote)
      if (cmd === 'git remote get-url origin') return c.remote ? ok('https://github.com/yirasso/nau.git') : ({ value: { exitCode: 2, stdout: '', stderr: '' } } as never)
      if (cmd === 'git remote') return ok(c.remote ? 'origin\n' : '')
      if (cmd === 'git status --porcelain') return ok(' M src/app.ts\n')
      if (cmd.startsWith('git diff')) return ok('diff --git a/src/app.ts b/src/app.ts')
      if (cmd === 'git rev-list --count @{u}..HEAD') return ok('0')
      if (cmd === 'git rev-parse --abbrev-ref @{u}') return ok('origin/main')
      if (cmd.startsWith('git commit')) message = e.init?.stdin ?? ''
      if (cmd.startsWith('gh repo view')) return ok('https://github.com/yirasso/nau\n')
      return ok()
    })
    on('model.complete', async (_$: unknown, e: { model: string }) => {
      model = e.model
      return { value: { isAnswered: true, text: 'Add the app shell\n\nWires the window to the store.', usage: {} } } as never
    })
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('fs.list', async () => ({ value: [{ name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }) as never)
    on('fs.read', async () => ({ deny: 'no package.json' }) as never)
    on('fs.exists', async () => ({ value: false }))
    on('settings.read', async () => ({ value: {} }) as never)
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
      viewport: { columns: 90, rows: 60 } as never,
    })
    expect((await ui.find({ key: 'github:start' }))?.text).toContain(c.button)

    // First press: Sonnet writes the message, and nothing changes until the person confirms.
    ran.length = 0
    await ui.press({ key: 'github:start' })
    expect(model).toBe('claude-sonnet-5-5')
    expect(ran.some(r => r.startsWith('git commit') || r.startsWith('git push') || r.startsWith('gh repo create') || r === 'git init')).toBe(false)
    const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(shown).toContain('Add the app shell')

    // Confirm: init (no repo), add, commit with the message, then publish or push.
    await ui.press({ key: 'github:confirm' })
    if (!c.repo) expect(ran).toContain('git init')
    expect(ran).toContain('git add -A')
    expect(message).toContain('Add the app shell')
    expect(ran).toContain(c.last)
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('https://github.com/yirasso/nau')
  })
}
