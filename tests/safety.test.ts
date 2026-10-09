import { expect, test } from 'claude-code/testing'

/** Lets background work move on (the kit's clock is not running). */
async function settle(): Promise<void> {
  const later = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout
  for (let i = 0; i < 10; i++) await new Promise<void>(r => later(r, 5))
}

test('Save Changes warns about secret-looking files and tokens, and can leave them out', async ($, on) => {
  const files: Record<string, string> = { 'C:/Dev/Nau/.gitignore': 'node_modules/\n' }
  const key = (path: string) => path.replace(/\\/g, '/')
  let ignored = false
  const ran: string[] = []
  on('fs.read', async (_$: unknown, e: { path: string }) => (key(e.path) in files ? { value: files[key(e.path)] } : { deny: 'ENOENT' }) as never)
  on('fs.write', async (_$: unknown, e: { path: string; text: string }) => ((files[key(e.path)] = e.text), (ignored = true), { value: undefined }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const cmd = e.argv.join(' ')
    ran.push(cmd)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'git rev-parse --is-inside-work-tree') return ok('true\n')
    if (cmd === 'git remote -v') return ok('origin\thttps://github.com/yirasso/nau.git (push)\n')
    if (cmd === 'git status --porcelain') return ok(ignored ? ' M src/app.ts\n' : ' M src/app.ts\n?? .env\n')
    if (cmd === 'git status --porcelain -uall') return ok(ignored ? ' M src/app.ts\n' : ' M src/app.ts\n?? .env\n?? .env.example\n')
    if (cmd === 'git diff HEAD') return ok('+++ b/src/app.ts\n+const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"\n')
    return ok('')
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('model.complete', async () => ({ value: { isAnswered: true, text: 'Add the app', usage: {} } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  await ui.press({ key: 'github:start' })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(shown).toContain('⚠ Looks secret: .env, src/app.ts')
  expect(shown).not.toContain('.env.example')
  // The secret itself is never shown.
  expect(shown).not.toContain('sk-ant-api03')
  expect((await ui.find({ key: 'github:confirm' }))?.text).toContain('Commit & push anyway')

  await ui.press({ key: 'github:ignore-secrets' })
  expect(files['C:/Dev/Nau/.gitignore']).toBe('node_modules/\n.env\nsrc/app.ts\n')
  expect(ran).toContain('git rm --cached -q --ignore-unmatch -- .env src/app.ts')
})

test('a line under the band says what the mod needs and is missing', async ($, on) => {
  on('fs.read', async () => ({ deny: 'ENOENT' }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [] }) as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const cmd = e.argv.join(' ')
    if (cmd === 'gh auth status') return { value: { exitCode: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts.' } } as never
    if (cmd === 'graphify --help') return { value: { exitCode: 1, stdout: '', stderr: 'not recognized' } } as never
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  await settle()
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(shown).toContain('⚠ gh not signed in (gh auth login) · graphify not installed (uv tool install graphifyy)')
  expect(shown).not.toContain('git not installed')
})
