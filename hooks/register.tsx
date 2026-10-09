// The Claudify band above the prompt: the project's actions (Start/Stop Project, Save Changes, Setup Project),
// and on the right whether GitHub, graphify and Ponytail are on and the 5-hour and weekly limits, with the script
// output and the GitHub confirm flow under them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GithubFlow, GithubPlan, ProjectScripts, ScriptRun, UsageLimit } from '../types'

const project = atom({ plugin: 'claudify', key: 'project' } as const, { pm: 'npm', names: [], graphify: null, github: null, branch: null, ponytail: null, git: true, pending: false })
const runs = atom({ plugin: 'claudify', key: 'runs' } as const, {})
const github = atom({ plugin: 'claudify', key: 'github' } as const, { phase: 'idle', plan: 'push', log: [] })
const limits = atom({ plugin: 'claudify', key: 'limits' } as const, [])

// ——— The project: the "dev" and "start" buttons and the checks ———

/** The scripts that get a button, in button order. */
const SCRIPTS = ['dev', 'start'] as const
const TAIL = 6

/** The terminal's colour codes, which the pane does not draw. */
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g')

/**
 * The session folder's project: the package.json scripts that get a button and the package manager (by its
 * lockfile), the graphify graph, and the GitHub repository of the `origin` remote.
 */
/** The message the Setup Project button sends: it asks for what the project's checks still miss. */
function setupPrompt(p: ProjectScripts): string {
  const todo = [
    ...(p.github ? [] : ['publish it to a new private GitHub repository (git init if needed, then gh repo create --private --source . --push)']),
    ...(p.graphify ? [] : ['build the graphify knowledge graph of this project (/graphify) and add graphify-out/ to .gitignore (create the file if it is missing)']),
    ...(p.ponytail ? [] : ['install the Ponytail plugin (/plugin install ponytail@ponytail)']),
  ]
  return `Set up this project: ${todo.join(', and ')}.`
}

async function readProject($: EngineInterface): Promise<void> {
  let names: string[] = []
  try {
    const pkg = JSON.parse(await $.fs.read('package.json')) as { scripts?: Record<string, unknown> }
    names = SCRIPTS.filter(s => typeof pkg.scripts?.[s] === 'string')
  } catch {
    // No package.json, no buttons.
  }
  let pm = 'npm'
  if (await $.fs.exists('pnpm-lock.yaml')) pm = 'pnpm'
  else if (await $.fs.exists('yarn.lock')) pm = 'yarn'
  else if ((await $.fs.exists('bun.lockb')) || (await $.fs.exists('bun.lock'))) pm = 'bun'
  // graphify: graphify-out/graph.json in the session folder (its date says when the graph was built).
  const cwd = await $.session.cwd().catch(() => '.')
  const outDir = `${cwd}/graphify-out`
  const graph = (await $.fs.list(outDir).catch(() => [])).find(x => x.name === 'graph.json' && x.kind === 'file')
  // GitHub: the origin remote points at a github.com repository.
  const git = async (...args: string[]): Promise<string> => {
    const r = await $.process.run(['git', ...args]).catch(() => null)
    return r && r.exitCode === 0 ? r.stdout.trim() : ''
  }
  const isRepo = (await git('rev-parse', '--is-inside-work-tree')) === 'true'
  const remote = await git('remote', 'get-url', 'origin')
  const repo = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote)?.[1] ?? null
  const branch = repo ? (await git('rev-parse', '--abbrev-ref', 'HEAD')) || null : null
  // Something to send to GitHub: a folder with no repo yet, a repo not on GitHub yet, changed files, or
  // commits the remote does not have (all of them, when the branch has no upstream).
  let pending: boolean
  if (!isRepo) pending = (await $.fs.list(cwd).catch(() => [])).some(x => !x.name.startsWith('.'))
  else if (!repo) pending = true
  else {
    const upstream = await git('rev-parse', '--abbrev-ref', '@{u}')
    const ahead = upstream ? Number(await git('rev-list', '--count', '@{u}..HEAD')) || 0 : (await git('rev-parse', 'HEAD')) ? 1 : 0
    pending = (await git('status', '--porcelain')) !== '' || ahead > 0
  }
  // Ponytail: the plugin enabled in the merged settings (user, project or local).
  const settings = (await $.settings.read().catch(() => ({}))) as { enabledPlugins?: Record<string, unknown> }
  const ponytail = Object.entries(settings.enabledPlugins ?? {}).find(([id, on]) => id.startsWith('ponytail@') && on === true)?.[0] ?? null
  // An empty graph.json is a build that failed: it does not count.
  const graphify = graph && graph.size > 0 ? graph.mtimeMs : null
  await update($, project, () => ({ pm, names, graphify, github: repo, branch, ponytail, git: isRepo, pending }))
}

/** Keeps the rate-limit windows the band draws. */
async function setLimits($: EngineInterface, rateLimits: readonly UsageLimit[]): Promise<void> {
  await update($, limits, () => rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) })))
}

/** Ends a script's whole process tree (on Windows, killing only the parent leaves Vite and Electron alive). */
async function killTree($: EngineInterface, pid: string): Promise<void> {
  if ((await $.env.get('OS')) === 'Windows_NT') await $.process.run(['taskkill', '/PID', pid, '/T', '/F']).catch(() => undefined)
  else await $.process.run(['kill', '-TERM', pid]).catch(() => undefined)
}

/** Runs `<pm> run <script>` in the session folder, keeping its state, its last lines and its address. */
async function runScript($: EngineInterface, name: string): Promise<void> {
  const { pm } = await read($, project)
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  // A wrapper that prints its PID first, so "Stop" can end the whole tree.
  const argv = windows
    ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `Write-Output "__PID__=$PID"; ${pm} run ${name}; exit $LASTEXITCODE`]
    : ['sh', '-c', `echo "__PID__=$$"; exec ${pm} run ${name}`]
  const started: ScriptRun = { status: 'running', code: null, tail: [`> ${pm} run ${name}`] }
  await update($, runs, all => ({ ...all, [name]: started }))
  const child = $.process.spawn({ argv })
  try {
    let rest = ''
    while (true) {
      const piece = await child.next()
      if (piece.done) {
        const code = piece.value.code
        await update($, runs, all => {
          // Stopped with the button: taskkill ends it with code 1, which is not a failure.
          const stopped = all[name]?.status === 'stopping'
          const ended: ScriptRun = { ...(all[name] ?? { tail: [] }), status: 'exited', code: stopped ? null : code }
          return { ...all, [name]: ended }
        })
        return
      }
      rest += piece.value.text.replace(ANSI, '')
      const lines = rest.split(/\r?\n/)
      rest = lines.pop() ?? ''
      if (!lines.length) continue
      const pid = lines.map(l => /^__PID__=(\d+)/.exec(l)?.[1]).find(Boolean)
      const url = lines.map(l => /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?[^\s]*/.exec(l)?.[0]).find(Boolean)
      const shown = lines.filter(l => l.trim() && !l.startsWith('__PID__='))
      await update($, runs, all => {
        const was: ScriptRun = all[name] ?? { status: 'running', code: null, tail: [] }
        const now: ScriptRun = { ...was, ...(pid ? { pid } : {}), ...(url && !was.url ? { url } : {}), tail: [...was.tail, ...shown].slice(-TAIL) }
        return { ...all, [name]: now }
      })
    }
  } catch (err) {
    await update($, runs, all => {
      const failed: ScriptRun = { status: 'exited', code: null, tail: [...(all[name]?.tail ?? []), `Could not start: ${String(err)}`].slice(-TAIL) }
      return { ...all, [name]: failed }
    })
  }
}

/** Stops a script: ends its tree by PID (the process ending finishes `runScript`'s loop). */
async function stopScript($: EngineInterface, name: string): Promise<void> {
  const run = (await read($, runs))[name]
  if (!run || run.status !== 'running') return
  const stopping: ScriptRun = { ...run, status: 'stopping' }
  await update($, runs, all => ({ ...all, [name]: stopping }))
  if (run.pid) await killTree($, run.pid)
}

// ——— The GitHub button: create the repo, publish it, or just commit and push ———

/** The model that writes the commit message (always Haiku 5.5 at medium effort). */
const COMMIT_MODEL = 'claude-haiku-5-5'
const DIFF_CHARS = 24_000

/** Runs git or gh in the session folder; resolves the result, or a failed one when it cannot start. */
async function sh($: EngineInterface, argv: string[], stdin?: string) {
  return $.process.run(argv, { timeoutMs: 120_000, ...(stdin !== undefined ? { stdin } : {}) }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
}

/** A safe GitHub repository name from the session folder's name. */
async function repoName($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd().catch(() => 'project')
  const base = cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

/**
 * Step 1 of the button: works out what it will do (create, publish or push), gathers what changed and has
 * Haiku write the commit message, then waits for the person to confirm.
 */
async function prepareGithub($: EngineInterface): Promise<void> {
  await update($, github, (): GithubFlow => ({ phase: 'preparing', plan: 'push', log: [] }))
  const isRepo = (await sh($, ['git', 'rev-parse', '--is-inside-work-tree'])).stdout.trim() === 'true'
  const remotes = isRepo ? (await sh($, ['git', 'remote', '-v'])).stdout : ''
  const onGithub = /github\.com[:/]/.test(remotes)
  const plan: GithubPlan = !isRepo ? 'create' : onGithub ? 'push' : 'publish'
  const target = plan === 'push' ? ((await read($, project)).github ?? 'origin') : `${await repoName($)} (private, new)`

  // What changed: the status and the diff (for a folder with no repo yet, the files it would commit).
  let status = ''
  let diff = ''
  if (isRepo) {
    status = (await sh($, ['git', 'status', '--porcelain'])).stdout.trim()
    diff = (await sh($, ['git', 'diff', 'HEAD', '--stat'])).stdout + '\n' + (await sh($, ['git', 'diff', 'HEAD'])).stdout
  } else {
    const entries = await $.fs.list('.').catch(() => [])
    status = entries.filter(e => !e.name.startsWith('.git')).map(e => `?? ${e.name}${e.kind === 'dir' ? '/' : ''}`).join('\n')
  }
  const files = status ? status.split('\n').filter(Boolean).length : 0
  const ahead = isRepo && onGithub ? Number((await sh($, ['git', 'rev-list', '--count', '@{u}..HEAD'])).stdout.trim()) || 0 : 0
  if (!files && plan === 'push' && !ahead) {
    await update($, github, (): GithubFlow => ({ phase: 'done', plan, log: ['Nothing to commit or push: the branch is up to date.'] }))
    return
  }

  let message = ''
  if (files) {
    const reply = await $.model.complete({
      model: COMMIT_MODEL,
      effort: 'medium',
      maxTokens: 400,
      system:
        'You write git commit messages. Reply with the message only: a subject line in the imperative mood, at most 72 characters, then a blank line and a short body of a few lines saying what changed and why when it helps. No markdown, no code fences, no quotes.',
      prompt: `${plan === 'create' ? 'This is the first commit of a new repository.\n\n' : ''}Files (git status --porcelain):\n${status.slice(0, 4000)}\n\nDiff:\n${diff.slice(0, DIFF_CHARS)}`
    })
    message = reply.isAnswered ? reply.text.trim().replace(/^```\w*\n?|```$/g, '').trim() : ''
    if (!message) {
      await update($, github, (): GithubFlow => ({ phase: 'error', plan, log: [`Haiku did not write a message (${reply.isAnswered ? 'empty reply' : reply.reason}).`] }))
      return
    }
  }
  await update($, github, (): GithubFlow => ({ phase: 'confirm', plan, message, files, target, ahead, log: [] }))
}

/** Step 2: the person confirmed; commit, create or publish the repository when needed, and push. */
async function runGithub($: EngineInterface): Promise<void> {
  const flow = await read($, github)
  if (flow.phase !== 'confirm') return
  const log: string[] = []
  const step = async (label: string, argv: string[], stdin?: string): Promise<boolean> => {
    log.push(`> ${label}`)
    await update($, github, (all): GithubFlow => ({ ...all, phase: 'working', log: [...log] }))
    const r = await sh($, argv, stdin)
    const out = `${r.stdout}\n${r.stderr}`.trim().split('\n').filter(Boolean).slice(-3)
    log.push(...out)
    if (r.exitCode !== 0) {
      await update($, github, (all): GithubFlow => ({ ...all, phase: 'error', log: [...log] }))
      return false
    }
    await update($, github, (all): GithubFlow => ({ ...all, log: [...log] }))
    return true
  }
  if (flow.plan === 'create' && !(await step('git init', ['git', 'init']))) return
  if (flow.files) {
    if (!(await step('git add -A', ['git', 'add', '-A']))) return
    if (!(await step('git commit', ['git', 'commit', '-F', '-'], flow.message ?? ''))) return
  }
  if (flow.plan === 'push') {
    const upstream = (await sh($, ['git', 'rev-parse', '--abbrev-ref', '@{u}'])).exitCode === 0
    if (!(await step('git push', upstream ? ['git', 'push'] : ['git', 'push', '-u', 'origin', 'HEAD']))) return
  } else {
    // A repo with another remote already called origin keeps it; GitHub goes in as "github".
    const hasOrigin = (await sh($, ['git', 'remote'])).stdout.split('\n').includes('origin')
    const name = await repoName($)
    if (!(await step(`gh repo create ${name} --private`, ['gh', 'repo', 'create', name, '--private', '--source', '.', '--remote', hasOrigin ? 'github' : 'origin', '--push']))) return
  }
  const url = (await sh($, ['gh', 'repo', 'view', '--json', 'url', '-q', '.url'])).stdout.trim()
  await update($, github, (all): GithubFlow => ({ ...all, phase: 'done', log: [...log], ...(url ? { url } : {}) }))
  await readProject($)
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

/** The rate-limit windows that get a bar, in order, and the bar's width in cells. */
const LIMITS = [
  ['five_hour', '5h'],
  ['seven_day', 'Week'],
] as const
const BAR = 8

/**
 * The band above the prompt: on the left the actions as real buttons with a symbol in front of the label
 * (Start/Stop Project; Save Changes while something waits to go to GitHub; Setup Project while a check is
 * off); on the right a dot for each check (GitHub, graphify, Ponytail) and the 5-hour and weekly limit
 * bars; then what the scripts and the GitHub flow report.
 */
function actionBar($: EngineInterface, ui: Ui, proj: ProjectScripts, scriptRuns: Record<string, ScriptRun>, gh: GithubFlow, usage: UsageLimit[]) {
  const { Box, Button, Text } = ui
  // Start Project runs the dev script, or the start script when there is no dev.
  const mainScript = proj.names.includes('dev') ? 'dev' : proj.names.includes('start') ? 'start' : (proj.names[0] ?? null)
  const mainRun = mainScript ? scriptRuns[mainScript] : undefined
  const startButton = mainScript ? (
    <Button
      key={`script:${mainScript}`}
      variant={mainRun?.status === 'running' ? 'secondary' : 'primary'}
      label={mainRun?.status === 'stopping' ? '■ Stopping…' : mainRun?.status === 'running' ? '■ Stop Project' : '▶ Start Project'}
      onPress={() => void (mainRun?.status === 'running' ? stopScript($, mainScript) : mainRun?.status === 'stopping' ? undefined : runScript($, mainScript))}
    />
  ) : (
    <Text dimColor>▶ Start Project</Text>
  )
  // Save Changes is there only while something is waiting to go to GitHub, and not while its flow runs.
  const saveButton = proj.pending && (gh.phase === 'idle' || gh.phase === 'done' || gh.phase === 'error') && (
    <Button key="github:start" variant="secondary" label="↑ Save Changes" onPress={() => void prepareGithub($)} />
  )
  // Setup Project leaves once GitHub, graphify and Ponytail are all on.
  const setupButton = (!proj.github || !proj.graphify || !proj.ponytail) && (
    <Button key="project:setup" variant="secondary" label="⚙ Setup Project" onPress={() => void $.prompt.submit({ text: setupPrompt(proj) })} />
  )
  // The checks: a filled green dot when it is on, a hollow dim one when it is not.
  const checks = [
    { label: 'GitHub', on: !!proj.github },
    { label: 'graphify', on: proj.graphify !== null },
    { label: 'Ponytail', on: !!proj.ponytail },
  ]
  // The 5-hour and weekly limits as bars; a window past its reset reads empty until the next response.
  const now = Date.now()
  const bars = LIMITS.flatMap(([kind, label]) => {
    const l = usage.find(x => x.kind === kind)
    if (!l) return []
    const used = l.resetsAt && Date.parse(l.resetsAt) <= now ? 0 : Math.max(0, Math.min(100, l.percentUsed))
    const full = Math.round((used / 100) * BAR)
    return [{ label, used, bar: '█'.repeat(full) + '░'.repeat(BAR - full) }]
  })
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={1} flexWrap="wrap">
        <Box flexDirection="row" gap={1}>
          {startButton}
          {saveButton}
          {setupButton}
        </Box>
        <Box flexDirection="row" gap={2}>
          {checks.map(c => (
            <Text color={c.on ? 'success' : undefined} dimColor={!c.on}>
              {`${c.on ? '●' : '○'} ${c.label}`}
            </Text>
          ))}
          {bars.map(b => (
            <Text color={b.used >= 90 ? 'error' : b.used >= 70 ? 'warning' : undefined}>
              {`${b.label} ${b.bar} ${Math.round(b.used)}%`}
            </Text>
          ))}
        </Box>
      </Box>
    {proj.names.map(name => {
      const run = scriptRuns[name]
      if (!run) return null
      const state = run.status === 'running' ? 'running' : run.status === 'stopping' ? 'stopping' : run.code === 0 ? 'finished' : run.code === null ? 'stopped' : `exited with code ${run.code}`
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={run.status === 'running' ? 'success' : run.code ? 'error' : undefined} dimColor={run.status !== 'running'}>
              {`${name} ${state}`}
            </Text>
            {run.url && run.status === 'running' && <Text color="suggestion">{run.url}</Text>}
          </Box>
          {run.status === 'running' &&
            run.tail.slice(-2).map(line => (
              <Text dimColor wrap="truncate-end">
                {line}
              </Text>
            ))}
        </Box>
      )
    })}
    {gh.phase === 'preparing' && <Text dimColor>Haiku is writing the commit message…</Text>}
    {gh.phase === 'confirm' && (
      <Box flexDirection="column">
        <Text>
          {`${gh.plan === 'create' ? 'New repo' : gh.plan === 'publish' ? 'Publish to' : 'Push to'} ${gh.target ?? ''}${gh.files ? ` · ${gh.files} files` : ''}${gh.ahead ? ` · ${gh.ahead} commits to push` : ''}`}
        </Text>
        {(gh.message ?? '').split('\n').slice(0, 6).map(line => (
          <Text dimColor wrap="truncate-end">
            {`  ${line}`}
          </Text>
        ))}
        <Box flexDirection="row" gap={1}>
          <Button key="github:confirm" variant="primary" label={gh.files ? 'Commit & push' : 'Push'} onPress={() => void runGithub($)} />
          <Button key="github:cancel" label="Cancel" onPress={() => void update($, github, (): GithubFlow => ({ phase: 'idle', plan: 'push', log: [] }))} />
        </Box>
      </Box>
    )}
    {(gh.phase === 'working' || gh.phase === 'done' || gh.phase === 'error') &&
      gh.log.slice(-4).map(line => (
        <Text dimColor={gh.phase !== 'error'} color={gh.phase === 'error' ? 'error' : undefined} wrap="truncate-end">
          {`  ${line}`}
        </Text>
      ))}
    {gh.phase === 'done' && gh.url && <Text color="suggestion">{`  ${gh.url}`}</Text>}
    </Box>
  )
}
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // A mod reload kills the wrapper but not the tree: whatever was left running is ended here.
    for (const [name, run] of Object.entries(await read($, runs))) {
      if (run.status === 'exited') continue
      if (run.pid) await killTree($, run.pid)
      const stopped: ScriptRun = { ...run, status: 'exited', code: null, tail: [...run.tail, 'Stopped when the mod reloaded.'].slice(-TAIL) }
      await update($, runs, all => ({ ...all, [name]: stopped }))
    }
    await readProject($)
    const usage = await $.session.usage().catch(() => null)
    if (usage) await setLimits($, usage.rateLimits)
    // The project's checks stay current: a new graph, a plugin enabled or a new remote shows within 10 s.
    $.clock.every(10_000, () => void readProject($).catch(() => undefined))
    return started
  })

  // The band above the prompt: the project's actions, always at hand.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box } = $.ui.resolve(e)
    const proj = await read($, project)
    const scriptRuns = await read($, runs)
    const gh = await read($, github)
    const usage = await read($, limits)
    return <Box flexDirection="column">{actionBar($, $.ui.resolve(e), proj, scriptRuns, gh, usage)}</Box>
  })

  // The limit bars follow the windows as the engine measures them.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await setLimits($, e.rateLimits)
    return next(e)
  })

  // When the session ends, whatever the buttons left running is ended too.
  on('session.end', async ($, e, next) => {
    for (const run of Object.values(await read($, runs))) if (run.status !== 'exited' && run.pid) await killTree($, run.pid)
    return next(e)
  })

  // When the turn ends, the project is read again (a graph built, a plugin installed).
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await readProject($)
    return done
  })
}
