import { expect, test } from 'claude-code/testing'

for (const [graph, remote] of [
  [true, 'https://github.com/yirasso/nau.git'],
  [false, ''],
] as const) {
  test(`Setup Project is a button only while GitHub, graphify or Ponytail is missing, and sets them up in code (${graph ? 'with' : 'without'})`, async ($, on) => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ scripts: { start: 'electron-vite dev' } }),
      'C:/Dev/Nau/.gitignore': 'node_modules/',
      'C:/Users/T/.claude/skills/graphify/references/extraction-spec.md': '# spec\n\n```\nFiles (chunk CHUNK_NUM of TOTAL_CHUNKS):\nFILE_LIST\n```\n',
      'C:/Dev/Nau/README.md': '# Nau\nA boat.',
      'C:/Dev/Nau/docs/guide.md': '# Guide',
      // With everything set up, CLAUDE.md already has graphify's rule.
      ...(graph ? { 'C:/Dev/Nau/CLAUDE.md': '# Nau\n\n## graphify\n\nRules: ...\n' } : {}),
    }
    const key = (path: string) => path.replace(/\\/g, '/')
    on('fs.read', async (_$: unknown, e: { path: string }) => (key(e.path) in files ? { value: files[key(e.path)] } : { deny: 'ENOENT' }) as never)
    on('fs.write', async (_$: unknown, e: { path: string; text: string }) => ((files[key(e.path)] = e.text), { value: undefined }) as never)
    on('fs.exists', async () => ({ value: false }))
    on('env.get', async (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/T' : undefined }) as never)
    on('settings.read', async () => ({ value: graph ? { enabledPlugins: { 'ponytail@ponytail': true } } : {} }) as never)
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('fs.list', async () => ({ value: graph ? [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: Date.now() - 2 * 86_400_000, isLink: false }] : [{ name: 'package.json', kind: 'file', size: 64, mtimeMs: 0, isLink: false }] }) as never)
    const ran: string[] = []
    on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
      const cmd = e.argv.join(' ')
      ran.push(cmd)
      const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
      if (cmd === 'graphify update .') return ok('Code graph updated.\n')
      if (cmd.includes('graph_docs.py')) return ok('12 nodes\n')
      // graphify writes its rule into CLAUDE.md and its hooks (with this machine's path) into settings.json.
      if (cmd === 'graphify claude install') {
        files['C:/Dev/Nau/CLAUDE.md'] = '## graphify\n\nRules: ...\n'
        const settings = JSON.parse(files['C:/Dev/Nau/.claude/settings.json'] ?? '{}')
        files['C:/Dev/Nau/.claude/settings.json'] = JSON.stringify({ ...settings, hooks: { PreToolUse: [{ matcher: 'Bash|Grep', hooks: [{ type: 'command', command: '"C:/Users/T/.local/bin/graphify.EXE" hook-guard search' }] }] } })
        return ok()
      }
      if (cmd === 'git check-ignore -q .claude/settings.local.json') return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
      if (cmd === 'git ls-files') return ok('README.md\nsrc/main.ts\ndocs/guide.md\n')
      if (cmd.includes('remote get-url')) return { value: { exitCode: remote ? 0 : 2, stdout: remote, stderr: '' } } as never
      if (cmd.includes('rev-parse')) return ok(graph ? 'main\n' : 'false\n')
      return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    })
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    const asked: { model: string; prompt: string }[] = []
    on('model.complete', async (_$: unknown, e: { model: string; prompt: string }) => {
      asked.push(e)
      const text = e.prompt.includes('FILE_LIST') || e.prompt.includes('Files (chunk') ? '{"nodes":[{"id":"readme_nau","label":"Nau"}],"edges":[]}' : 'Initial commit'
      return { value: { isAnswered: true, text, usage: {} } } as never
    })
    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'terminal', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    // With GitHub, a graph and Ponytail there is nothing left to set up: the button leaves.
    expect(!!(await ui.find({ key: 'project:setup' }))).toBe(!graph)
    if (graph) return

    await ui.press({ key: 'project:setup' })
    // Ponytail on in the project's settings, graphify-out/ ignored, the code graph built with no model.
    expect(JSON.parse(files['C:/Dev/Nau/.claude/settings.json'] ?? '{}').enabledPlugins).toEqual({ 'ponytail@ponytail': true })
    expect(files['C:/Dev/Nau/.gitignore']).toBe('node_modules/\ngraphify-out/\n.claude/settings.local.json\n')
    // The rule telling Claude to read the graph is in CLAUDE.md; graphify's hooks, which name this machine's path,
    // moved from the shared settings to the local ones.
    expect(ran).toContain('graphify claude install')
    expect(files['C:/Dev/Nau/CLAUDE.md']).toContain('## graphify')
    expect(files['C:/Dev/Nau/.claude/settings.json']).not.toContain('graphify.EXE')
    expect(files['C:/Dev/Nau/.claude/settings.local.json']).toContain('hook-guard search')
    expect(ran).toContain('graphify update .')
    // Only the docs go to Sonnet, as text with the skill's spec; graph_docs.py merges what it returned.
    const docsAsk = asked.find(a => a.prompt.includes('Files (chunk 1 of 1)'))
    expect(docsAsk?.model).toBe('claude-sonnet-5-5')
    expect(docsAsk?.prompt).toContain('C:/Dev/Nau/README.md\nC:/Dev/Nau/docs/guide.md')
    expect(docsAsk?.prompt).toContain('A boat.')
    expect(docsAsk?.prompt).not.toContain('src/main.ts')
    expect(JSON.parse(files['C:/Dev/Nau/graphify-out/.graphify_chunk_01.json'] ?? '{}').nodes).toHaveLength(1)
    expect(ran.some(c => c.includes('graph_docs.py'))).toBe(true)
    // The first commit's message comes from Sonnet too, and nothing is pushed before the person confirms.
    expect(asked.filter(a => a !== docsAsk).every(a => a.model === 'claude-sonnet-5-5')).toBe(true)
    expect(asked.length).toBe(2)
    expect(await ui.find({ key: 'github:confirm' })).toBeTruthy()
    expect(ran.some(c => c.startsWith('gh repo create'))).toBe(false)
  })
}

for (const stale of [true, false]) {
  test(`graphify: a yellow dot and Update Graph only with commits newer than the graph (${stale ? 'stale' : 'current'})`, async ($, on) => {
    on('fs.read', async () => ({ value: '{}' }))
    on('fs.exists', async () => ({ value: false }))
    on('settings.read', async () => ({ value: {} }) as never)
    on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
    on('fs.list', async () => ({ value: [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: 1_700_000_000_000, isLink: false }] }) as never)
    let since = ''
    const ran: string[] = []
    on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
      const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
      ran.push(e.argv.join(' '))
      if (e.argv[0] === 'graphify') return ok()
      // The files commits after the graph touched (none on disk here: they count as changed since).
      if (e.argv[1] === 'log' && e.argv.includes('--name-only')) return (since ||= e.argv[2] ?? ''), ok(stale ? 'hooks/register.tsx\n' : '')
      if (e.argv[1] === 'log') return ok('')
      if (e.argv.join(' ') === 'git rev-parse --is-inside-work-tree') return ok('true\n')
      return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    })
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    let spawned = 0
    on('agent.spawn', async () => (spawned++, { model: 'claude-sonnet-5-5', agentId: 'a1' }) as never)
    on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

    await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    // The commits are read from the graph's own date.
    expect(since).toBe('--since=@1700000000')
    expect(!!(await ui.find({ key: 'graphify:update' }))).toBe(stale)
    if (!stale) return
    await ui.press({ key: 'graphify:update' })
    expect(ran).toContain('graphify update .')
    // Only code changed: no model runs.
    expect(spawned).toBe(0)
  })
}

test('graphify: a failed update shows its line and keeps Update Graph to try again', async ($, on) => {
  on('fs.read', async () => ({ value: '{}' }))
  on('fs.exists', async () => ({ value: false }))
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: 1_700_000_000_000, isLink: false }] }) as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (e.argv[0] === 'graphify') return { value: { exitCode: 1, stdout: '', stderr: 'boom\n' } } as never
    if (e.argv[1] === 'log') return ok('abc123\n')
    if (e.argv.join(' ') === 'git rev-parse --is-inside-work-tree') return ok('true\n')
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  await ui.press({ key: 'graphify:update' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('graphify update failed: boom')
  expect(await ui.find({ key: 'graphify:update' })).toBeTruthy()
})

test('graphify follows the work: code a turn changed goes in with no model; a commit with docs brings them in by itself', async ($, on) => {
  const files: Record<string, string> = { 'C:/Dev/Nau/README.md': '# Nau' }
  const key = (path: string) => path.replace(/\\/g, '/')
  on('fs.read', async (_$: unknown, e: { path: string }) => (key(e.path) in files ? { value: files[key(e.path)] } : { deny: 'ENOENT' }) as never)
  on('fs.write', async (_$: unknown, e: { path: string; text: string }) => ((files[key(e.path)] = e.text), { value: undefined }) as never)
  on('fs.exists', async () => ({ value: false }))
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/T' : undefined }) as never)
  files['C:/Users/T/.claude/skills/graphify/references/extraction-spec.md'] = '```\nFiles (chunk CHUNK_NUM of TOTAL_CHUNKS):\nFILE_LIST\n```'
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: Date.now(), isLink: false }] }) as never)
  let head = 'aaa'
  let tree = ''
  const ran: string[] = []
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const cmd = e.argv.join(' ')
    ran.push(cmd)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'git rev-parse --is-inside-work-tree') return ok('true\n')
    if (cmd === 'git rev-parse HEAD') return ok(`${head}\n`)
    if (cmd === 'git status --porcelain') return ok(tree)
    if (cmd.startsWith('git log -1 --format=%ct')) return ok('1700000000\n')
    if (cmd === 'git diff --name-only aaa bbb') return ok('src/app.ts\nREADME.md\n')
    if (cmd.startsWith('git log --since') && cmd.includes('--name-only')) return ok(head === 'bbb' ? 'src/app.ts\nREADME.md\n' : '')
    if (cmd === 'graphify hook status') return ok('post-commit: not installed\n')
    return ok('')
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  const asked: string[] = []
  on('model.complete', async (_$: unknown, e: { prompt: string }) => (asked.push(e.prompt), { value: { isAnswered: true, text: '{"nodes":[{"id":"readme_nau"}],"edges":[]}', usage: {} } }) as never)
  on('turn.complete', async () => ({ text: 'done' }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)
  const settle = async () => {
    const later = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout
    for (let i = 0; i < 20; i++) await new Promise<void>(r => later(r, 5))
  }
  const turn = async () => {
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't' } as never)
    await settle()
  }

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  // A turn with nothing changed: no rebuild.
  await turn()
  expect(ran.filter(c => c === 'graphify update .').length).toBe(0)
  // A turn that changed code: the code graph is rebuilt, no model.
  tree = ' M src/app.ts\n'
  await turn()
  expect(ran.filter(c => c === 'graphify update .').length).toBe(1)
  expect(asked.length).toBe(0)
  // A commit that changed README.md: its docs go to Sonnet without a button.
  head = 'bbb'
  tree = ''
  await turn()
  expect(asked.some(p => p.includes('C:/Dev/Nau/README.md'))).toBe(true)
  expect(ran.some(c => c.includes('graph_docs.py'))).toBe(true)
})

test('a commit that only records files the graph already read leaves the graph current (Setup Project)', async ($, on) => {
  const graphAt = 1_700_000_000_000
  on('fs.read', async () => ({ deny: 'ENOENT' }) as never)
  on('fs.exists', async () => ({ value: false }))
  // Every file was last written before the graph was built.
  on('fs.stat', async () => ({ value: { kind: 'file', size: 10, mtimeMs: graphAt - 60_000, isLink: false } }) as never)
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', async () => ({ value: 'C:/Dev/Nau' }))
  on('fs.list', async () => ({ value: [{ name: 'graph.json', kind: 'file', size: 2048, mtimeMs: graphAt, isLink: false }] }) as never)
  on('process.run', async (_$: unknown, e: { argv: readonly string[] }) => {
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (e.argv.join(' ') === 'git rev-parse --is-inside-work-tree') return ok('true\n')
    // The first commit, made after the graph: it records the same files.
    if (e.argv[1] === 'log' && e.argv.includes('--name-only')) return ok('README.md\nserver.js\npackage.json\n')
    return ok('')
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.start', async () => ({ cwd: 'C:/Dev/Nau' }) as never)

  await $.session.start({ cwd: 'C:/Dev/Nau', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'claudify', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await ui.find({ key: 'graphify:update' })).toBeUndefined()
})
