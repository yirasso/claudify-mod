import { expect, test } from 'claude-code/testing'

for (const dirty of [true, false]) {
  test(`the band: Save Changes only with something to send (${dirty ? 'changes' : 'clean'}), the checks and the limit bars`, async ($, on) => {
    on('fs.read', async () => ({ value: JSON.stringify({ scripts: { dev: 'vite' } }) }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.list', async () => ({ value: [] }) as never)
    on('env.get', async () => ({ value: undefined }))
    on('settings.read', async () => ({ value: {} }) as never)
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
      const cmd = e.argv.join(' ')
      const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
      if (cmd === 'git rev-parse --is-inside-work-tree') return ok('true\n')
      if (cmd === 'git remote get-url origin') return ok('https://github.com/yirasso/nau.git\n')
      if (cmd === 'git rev-parse --abbrev-ref @{u}') return ok('origin/main\n')
      if (cmd === 'git rev-list --count @{u}..HEAD') return ok('0\n')
      if (cmd === 'git status --porcelain') return ok(dirty ? ' M src/app.ts\n' : '')
      return ok('main\n')
    })
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 50 }, { kind: 'seven_day', percentUsed: 92.5 }] } }) as never)
    on('tool.list', async () => ({ value: [] }))
    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
    const band = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    expect(await band.find({ key: 'session:compact' })).toBeUndefined()
    expect(!!(await band.find({ key: 'github:start' }))).toBe(dirty)
    // GitHub is on, graphify and Ponytail are not: Setup Project stays.
    expect((await band.find({ key: 'project:setup' }))?.text).toContain('Setup Project')
    const shown = (await band.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(shown).toContain('● GitHub')
    expect(shown).toContain('○ graphify')
    expect(shown).toContain('○ Ponytail')
    expect(shown).toContain('5h ████░░░░ 50%')
    expect(shown).toContain('Week ███████░ 93%')
  })
}
