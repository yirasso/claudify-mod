// The "Claude" pane: the project (its dev/start buttons and checks), the account's usage limits (the 5-hour
// and 7-day windows), and the session's skills, MCP servers, connectors and plugins. A skill lights up when
// it is called (through the Skill tool or as /name) and stays lit until the turn ends; a server lights up
// while one of its tools runs.

import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, RenderChildren, SvgProps } from 'claude-code'

import { dashboard } from './cards'

import type { GithubFlow, GithubPlan, Limit, ScriptRun, ServerRow, SkillRow } from '../types'

const PANE = 'usage-board'
const TITLE = 'Claude'

const limits = atom({ plugin: 'usage-board', key: 'limits' } as const, [])
const skills = atom({ plugin: 'usage-board', key: 'skills' } as const, [])
const servers = atom({ plugin: 'usage-board', key: 'servers' } as const, [])
const busy = atom({ plugin: 'usage-board', key: 'busy' } as const, {})
const used = atom({ plugin: 'usage-board', key: 'used' } as const, {})
const tick = atom({ plugin: 'usage-board', key: 'tick' } as const, 0)
const project = atom({ plugin: 'usage-board', key: 'project' } as const, { pm: 'npm', names: [], graphify: null, github: null, branch: null, ponytail: null, git: true })
const runs = atom({ plugin: 'usage-board', key: 'runs' } as const, {})
const open = atom({ plugin: 'usage-board', key: 'open' } as const, {})
const github = atom({ plugin: 'usage-board', key: 'github' } as const, { phase: 'idle', plan: 'push', log: [] })
const context = atom({ plugin: 'usage-board', key: 'context' } as const, null)
const paneOpen = atom({ plugin: 'usage-board', key: 'paneOpen' } as const, false)

/** An MCP tool's server prefix: `mcp__claude_ai_Gmail__create_draft` → `claude_ai_Gmail`. */
const wireOf = (tool: string): string | null => {
  const m = /^mcp__(.+?)__/.exec(tool)
  return m?.[1] ?? null
}

const LIMIT_NAMES: Record<string, string> = { five_hour: 'Session (5 h)', seven_day: 'Week (7 days)', spend_limit: 'Spend' }

/** "resets in 2 h 13 min", from an ISO instant. */
function until(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'resetting'
  const min = Math.round(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d) return `resets in ${d} d ${h} h`
  if (h) return `resets in ${h} h ${m} min`
  return `resets in ${m} min`
}

/** "3 min ago", for what was used recently (up to an hour). */
function ago(at: number | undefined, now: number): string {
  if (!at) return ''
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return ''
}

/** A text bar, filled for the part used. */
function bar(percent: number, width: number): string {
  const full = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(full) + '░'.repeat(width - full)
}

const levelColor = (percent: number): string => (percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success')

/** A server named by a UUID: a Claude account connector that the Claude Desktop app hands to the session. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The products, by the word their tools' descriptions keep repeating. */
const BRANDS: [word: RegExp, name: string][] = [
  [/\bGmail\b/g, 'Gmail'],
  [/\bGoogle Drive\b|\bDrive\b/g, 'Google Drive'],
  [/\bGoogle Calendar\b|\bcalendars?\b/gi, 'Google Calendar'],
  [/\bSupabase\b/g, 'Supabase'],
  [/\bVercel\b/g, 'Vercel'],
  [/\bMobbin\b/g, 'Mobbin'],
  [/\bOriginkit\b/gi, 'Originkit'],
  [/\bGitHub\b/g, 'GitHub'],
  [/\bNotion\b/g, 'Notion'],
  [/\bSlack\b/g, 'Slack'],
  [/\bLinear\b/g, 'Linear'],
  [/\bFigma\b/g, 'Figma'],
  [/\bStripe\b/g, 'Stripe'],
  [/\bHubSpot\b/g, 'HubSpot'],
  [/\bAsana\b/g, 'Asana'],
  [/\bJira\b|\bAtlassian\b/g, 'Atlassian']
]

/**
 * The name of a Claude account connector the session only knows by its UUID: from the tools it has (for the
 * ones whose descriptions never name the product) or the brand its tools' descriptions repeat the most.
 */
function guessConnector(tools: { name: string; description: string }[]): string | null {
  const has = (n: string): boolean => tools.some(t => t.name === n)
  if (has('show_widget') && has('read_me')) return 'Visualize'
  if (has('guide') && has('batch')) return 'Claude Docs'
  if (has('create_event') && has('list_calendars')) return 'Google Calendar'
  const text = tools.map(t => t.description).join(' ')
  let best: string | null = null
  let most = 0
  for (const [word, name] of BRANDS) {
    const n = text.match(word)?.length ?? 0
    if (n > most) {
      most = n
      best = name
    }
  }
  return best
}

/** The Claude Desktop app's own pieces, which it connects to every session. */
const DESKTOP_PIECES = ['Claude_Browser', 'Claude_Preview', 'claude-in-chrome', 'computer-use', 'terminal', 'visualize', 'scheduled-tasks', 'mcp-registry']
const isDesktopPiece = (wire: string): boolean => wire.startsWith('ccd_') || DESKTOP_PIECES.includes(wire)

/** The plugin behind an MCP server a plugin brings (`plugin_supabase_supabase` → `supabase`). */
const pluginOfServer = (wire: string): string | null => /^plugin_([^_]+)_/.exec(wire)?.[1] ?? null

/** The plugins that come with Claude (the Anthropic skills the Claude Desktop app keeps). */
const isBuiltinPlugin = (name: string): boolean => name.startsWith('anthropic')

/** Reads the session's limits, skills and servers (the local context count, which costs nothing). */
async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  await update($, limits, () => usage.rateLimits.map((r): Limit => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })))
  const c = usage.context
  await update($, context, () => (c.percent !== undefined && c.tokens !== undefined ? { percent: c.percent, tokens: c.tokens, window: c.window } : null))
  const b = usage.context.breakdown
  const skillRows: SkillRow[] = (b?.skills?.skillFrontmatter ?? []).map(s => ({ name: s.name, source: s.source, ...(s.pluginName ? { plugin: s.pluginName } : {}) }))
  await update($, skills, () => skillRows.sort((x, y) => x.name.localeCompare(y.name)))
  // The servers: those of the tools the model has, with the name /mcp gives them when it is known.
  const names = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const t of b?.mcpTools ?? []) {
    const wire = wireOf(t.name)
    if (!wire) continue
    names.set(wire, t.serverName)
    counts.set(wire, (counts.get(wire) ?? 0) + 1)
  }
  const tools = new Map<string, { name: string; description: string }[]>()
  for (const t of await $.tool.list()) {
    if (!t.mcp) continue
    const wire = wireOf(t.name)
    if (!wire) continue
    if (!counts.has(wire)) counts.set(wire, 0)
    if (!b?.mcpTools?.length) counts.set(wire, (counts.get(wire) ?? 0) + 1)
    tools.set(wire, [...(tools.get(wire) ?? []), { name: t.name.slice(`mcp__${wire}__`.length), description: t.description }])
  }
  const rows: ServerRow[] = [...counts].map(([wire, n]) => {
    const known = names.get(wire)
    const name = known && !UUID.test(known) ? known : UUID.test(wire) ? (guessConnector(tools.get(wire) ?? []) ?? `Connector ${wire.slice(0, 8)}`) : wire.replace(/_/g, ' ')
    return { wire, tools: n, name }
  })
  await update($, servers, () => rows.sort((x, y) => x.name.localeCompare(y.name)))
}

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
  // Ponytail: the plugin enabled in the merged settings (user, project or local).
  const settings = (await $.settings.read().catch(() => ({}))) as { enabledPlugins?: Record<string, unknown> }
  const ponytail = Object.entries(settings.enabledPlugins ?? {}).find(([id, on]) => id.startsWith('ponytail@') && on === true)?.[0] ?? null
  await update($, project, () => ({ pm, names, graphify: graph ? graph.mtimeMs : null, github: repo, branch, ponytail, git: isRepo }))
}

/** "built today", "built yesterday", "built 3 days ago": when the graphify graph was made. */
function since(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000)
  return days <= 0 ? 'built today' : days === 1 ? 'built yesterday' : `built ${days} days ago`
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

/** The model that writes the commit message (always Sonnet 5.5 at medium effort). */
const COMMIT_MODEL = 'claude-sonnet-5-5'
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
 * Sonnet write the commit message, then waits for the person to confirm.
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
      await update($, github, (): GithubFlow => ({ phase: 'error', plan, log: [`Sonnet did not write a message (${reply.isAnswered ? 'empty reply' : reply.reason}).`] }))
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

/** Opens the pane and remembers it is open (the band's button shows "Close"). */
async function openPane($: EngineInterface): Promise<void> {
  const r = await $.ui.open({ id: PANE, title: TITLE })
  await update($, paneOpen, () => r.isPlaced !== false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'usage-board', description: 'Open the pane with the usage limits, skills, MCP servers, connectors and plugins' })
    // A mod reload kills the wrapper but not the tree: whatever was left running is ended here.
    for (const [name, run] of Object.entries(await read($, runs))) {
      if (run.status === 'exited') continue
      if (run.pid) await killTree($, run.pid)
      const stopped: ScriptRun = { ...run, status: 'exited', code: null, tail: [...run.tail, 'Stopped when the pane reloaded.'].slice(-TAIL) }
      await update($, runs, all => ({ ...all, [name]: stopped }))
    }
    void openPane($)
    await readProject($)
    await refresh($)
    $.clock.every(30_000, () => void update($, tick, n => n + 1))
    // Everything stays current: a removed connector, a deleted skill or a new server shows within 10 s.
    $.clock.every(10_000, () => void refresh($).then(() => readProject($)).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'usage-board' }, async $ => {
    await openPane($)
    await readProject($)
    await refresh($)
    return { text: 'Opened the "Claude" pane.' }
  })

  // The pane closed (its X, Escape, or the band's button): the band shows "Open" again.
  on('ui.close', async ($, e, next) => {
    const done = await next(e)
    if (e.id === PANE) await update($, paneOpen, () => false)
    return done
  })

  // The band above the prompt: one button that opens and closes the pane, always at hand (a mod cannot put
  // a button in the Claude Desktop title bar next to the terminal button).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const isOpen = await read($, paneOpen)
    return (
      <Box flexDirection="row" justifyContent="flex-end">
        <Button
          key="band:toggle"
          plain
          dimColor
          label={isOpen ? '◧ Hide Claude panel' : '◧ Show Claude panel'}
          onPress={() => void (isOpen ? $.ui.close({ id: PANE }).catch(() => undefined).then(() => update($, paneOpen, () => false)) : openPane($))}
        />
      </Box>
    )
  })

  // When the session ends, whatever the buttons left running is ended too.
  on('session.end', async ($, e, next) => {
    for (const run of Object.values(await read($, runs))) if (run.status !== 'exited' && run.pid) await killTree($, run.pid)
    return next(e)
  })

  // The limits move during the session: the engine says when a window moves a point.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') && e.context.percent !== undefined && e.context.tokens !== undefined) {
      const c = e.context
      await update($, context, () => ({ percent: c.percent ?? 0, tokens: c.tokens ?? 0, window: c.window }))
    }
    if (e.changed.includes('rateLimits')) await update($, limits, () => e.rateLimits.map((r): Limit => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })))
    return next(e)
  })

  // A skill typed as /name (or preloaded) lights up until the turn ends.
  on('skill.prompt', async ($, e, next) => {
    await update($, busy, all => ({ ...all, [`skill:${e.skill}`]: 1 }))
    await update($, used, all => ({ ...all, [`skill:${e.skill}`]: Date.now() }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // The Skill tool: the skill stays lit until the turn ends (it is what the model is following).
    if (e.tool === 'Skill') {
      const name = String((e as { skill?: unknown }).skill ?? '')
      if (name) {
        await update($, busy, all => ({ ...all, [`skill:${name}`]: 1 }))
        await update($, used, all => ({ ...all, [`skill:${name}`]: Date.now() }))
      }
      return next(e)
    }
    // An MCP tool: its server stays lit while it runs.
    const wire = wireOf(e.tool)
    if (!wire) return next(e)
    const key = `mcp:${wire}`
    await update($, busy, all => ({ ...all, [key]: (all[key] ?? 0) + 1 }))
    await update($, used, all => ({ ...all, [key]: Date.now() }))
    try {
      return await next(e)
    } finally {
      await update($, busy, all => {
        const left = (all[key] ?? 1) - 1
        const out = { ...all }
        if (left > 0) out[key] = left
        else delete out[key]
        return out
      })
    }
  })

  // When the turn ends, the skills go dark and the lists are read again (a new skill or server).
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await update($, busy, all => Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('skill:'))))
    await readProject($)
    await refresh($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // The desktop draws SVG (the glass icons, the gauges); the terminal keeps the text version.
    const Svg = e.surface === 'desktop' ? ((($.ui.resolve(e) as unknown) as { Svg?: ElementConstructor<SvgProps> }).Svg ?? null) : null
    await read($, tick)
    const proj = await read($, project)
    const scriptRuns = await read($, runs)
    const isOpen = await read($, open)
    const gh = await read($, github)
    const now = Date.now()
    const lims = await read($, limits)
    const ctx = await read($, context)
    const listedSkills = await read($, skills)
    const listedServers = await read($, servers)
    const live = await read($, busy)
    const last = await read($, used)
    // What is in use right now always shows, even before the list has it (a server connected just now);
    // what was only used before shows only while it still exists.
    const seen = Object.keys(live)
    const allSkills: SkillRow[] = [
      ...listedSkills,
      ...seen.filter(k => k.startsWith('skill:') && !listedSkills.some(s => `skill:${s.name}` === k)).map(k => ({ name: k.slice(6), source: '' }))
    ]
    const allServers: ServerRow[] = [
      ...listedServers,
      ...seen.filter(k => k.startsWith('mcp:') && !listedServers.some(s => `mcp:${s.wire}` === k)).map(k => ({ wire: k.slice(4), name: k.slice(4).replace(/_/g, ' '), tools: 0 }))
    ]
    const cols = e.viewport?.columns ?? 40
    const barWidth = Math.max(8, Math.min(24, cols - 14))

    // ——— Sorting: plugins apart, and in each category what comes built in goes in a drawer ———
    const pluginOfSkill = (s: SkillRow): string | null => s.plugin ?? (s.name.includes(':') ? (s.name.split(':')[0] ?? null) : null)
    const ownSkills = allSkills.filter(s => !pluginOfSkill(s) && s.source !== 'built-in')
    const builtinSkills = allSkills.filter(s => !pluginOfSkill(s) && s.source === 'built-in')
    const connectors = allServers.filter(s => UUID.test(s.wire))
    const pluginServers = allServers.filter(s => pluginOfServer(s.wire))
    const ownServers = allServers.filter(s => !UUID.test(s.wire) && !pluginOfServer(s.wire) && !isDesktopPiece(s.wire))
    const desktopServers = allServers.filter(s => !UUID.test(s.wire) && !pluginOfServer(s.wire) && isDesktopPiece(s.wire))
    // The plugins: each one's skills and servers.
    const plugins = new Map<string, { skills: SkillRow[]; servers: ServerRow[] }>()
    const pluginEntry = (name: string) => plugins.get(name) ?? (plugins.set(name, { skills: [], servers: [] }).get(name) as { skills: SkillRow[]; servers: ServerRow[] })
    for (const s of allSkills) {
      const p = pluginOfSkill(s)
      if (p) pluginEntry(p).skills.push(s)
    }
    for (const s of pluginServers) pluginEntry(pluginOfServer(s.wire) as string).servers.push(s)
    const pluginList = [...plugins].map(([name, parts]) => ({ name, ...parts }))
    const ownPlugins = pluginList.filter(p => !isBuiltinPlugin(p.name))
    const builtinPlugins = pluginList.filter(p => isBuiltinPlugin(p.name))

    const skillKey = (s: SkillRow): string => `skill:${s.name}`
    const serverKey = (s: ServerRow): string => `mcp:${s.wire}`
    const pluginBusy = (p: { skills: SkillRow[]; servers: ServerRow[] }): boolean => p.skills.some(s => live[skillKey(s)]) || p.servers.some(s => live[serverKey(s)])
    const pluginUsed = (p: { skills: SkillRow[]; servers: ServerRow[] }): number => Math.max(0, ...p.skills.map(s => last[skillKey(s)] ?? 0), ...p.servers.map(s => last[serverKey(s)] ?? 0))

    // What is lit first, then what was used recently, then by name.
    const order = <T extends { name: string }>(list: T[], isOn: (x: T) => boolean, at: (x: T) => number): T[] =>
      [...list].sort((a, b) => Number(isOn(b)) - Number(isOn(a)) || at(b) - at(a) || a.name.localeCompare(b.name))
    const sortSkills = (list: SkillRow[]): SkillRow[] => order(list, s => !!live[skillKey(s)], s => last[skillKey(s)] ?? 0)
    const sortServers = (list: ServerRow[]): ServerRow[] => order(list, s => !!live[serverKey(s)], s => last[serverKey(s)] ?? 0)

    const toggle = (id: string, fallback: boolean): void => void update($, open, all => ({ ...all, [id]: !(all[id] ?? fallback) }))
    const opened = (id: string, fallback: boolean): boolean => isOpen[id] ?? fallback

    /** A header that collapses and expands: the arrow, the title, how many, and how many are in use. */
    const head = (id: string, title: string, count: number | null, active: number, fallback: boolean, drawer = false) => (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Button
          key={`toggle:${id}`}
          plain
          dimColor={drawer}
          label={`${opened(id, fallback) ? '▾' : '▸'} ${title}${count === null ? '' : ` · ${count}`}${active ? ` · ${active} in use` : ''}`}
          onPress={() => toggle(id, fallback)}
        />
      </Box>
    )

    /** A row: the dot (green while in use), the name, and the rest in small print. */
    const row = (key: string, name: string, extra: string, indent = '') => {
      const active = !!live[key]
      const when = active ? '' : ago(last[key], now)
      return (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color={active ? 'success' : undefined} dimColor={!active}>
            {`${indent}${active ? '●' : '○'}`}
          </Text>
          <Text bold={active} wrap="truncate-end">
            {name}
          </Text>
          {(extra || when || active) && (
            <Text dimColor wrap="truncate-end">
              {active ? 'in use' : [extra, when].filter(Boolean).join(' · ')}
            </Text>
          )}
        </Box>
      )
    }

    const skillRow = (s: SkillRow, indent = '') => row(skillKey(s), s.name, '', indent)
    const serverRow = (s: ServerRow, indent = '') => row(serverKey(s), s.name, s.tools ? `${s.tools} tools` : '', indent)

    /** A drawer inside a category (what comes built in), closed by default. */
    const drawer = <T,>(id: string, title: string, list: T[], draw: (x: T) => RenderChildren, active: number) =>
      list.length > 0 && (
        <Box flexDirection="column">
          {head(id, title, list.length, active, false, true)}
          {opened(id, false) && list.map(x => draw(x))}
        </Box>
      )

    /** A plugin: its row and, expanded, the skills and servers it brings. */
    const pluginBlock = (p: { name: string; skills: SkillRow[]; servers: ServerRow[] }, indent = '') => {
      const id = `plugin:${p.name}`
      const active = pluginBusy(p)
      const parts = [p.skills.length ? `${p.skills.length} skills` : '', p.servers.length ? `${p.servers.length} servers` : ''].filter(Boolean).join(' · ')
      return (
        <Box flexDirection="column">
          <Button
            key={`toggle:${id}`}
            plain
            label={`${indent}${opened(id, false) ? '▾' : '▸'} ${active ? '● ' : '○ '}${p.name}${parts ? `  ${parts}` : ''}${active ? ' · in use' : ''}`}
            onPress={() => toggle(id, false)}
          />
          {opened(id, false) && sortSkills(p.skills).map(s => skillRow(s, `${indent}    `))}
          {opened(id, false) && sortServers(p.servers).map(s => serverRow(s, `${indent}    `))}
        </Box>
      )
    }

    const activeOf = <T,>(list: T[], key: (x: T) => string): number => list.filter(x => live[key(x)]).length
    const checksOk = [proj.graphify, proj.github, proj.ponytail].filter(Boolean).length
    // The repository card's paragraph, with the facts in bold.
    const insightRuns: { text: string; bold?: boolean }[] = proj.github
      ? [
          { text: 'On ' },
          { text: proj.branch ?? 'the default branch', bold: true },
          { text: ' of ' },
          { text: proj.github, bold: true },
          { text: '. ' },
          ...(proj.graphify ? [{ text: 'The graph was ' }, { text: since(proj.graphify, now).replace(/^built /, 'built '), bold: true }] : [{ text: 'No graph yet: run ' }, { text: '/graphify', bold: true }]),
          { text: proj.ponytail ? ' and Ponytail is ' : ' and Ponytail is ' },
          { text: proj.ponytail ? 'on' : 'off', bold: true },
          { text: '.' },
        ]
      : [{ text: 'No GitHub repository yet. ' }, { text: proj.git === false ? 'Create one' : 'Publish this repo', bold: true }, { text: ' with the button below.' }]
    const runningScripts = Object.values(scriptRuns).filter(r => r.status === 'running').length

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          // One composition after Outcrowd's dashboard widget: usage across the top, the project score and the
          // repository insights below. Drawn at the pane's width (480) so the type keeps its real size.
          <Svg
            source={dashboard({
              bars: [
                ...(['five_hour', 'seven_day'] as const).map(kind => {
                  const l = lims.find(x => x.kind === kind)
                  return { label: LIMIT_NAMES[kind] ?? kind, sub: l ? until(l.resetsAt, now) : 'no reading yet', percent: l ? l.percentUsed : null, color: kind === 'five_hour' ? ('red' as const) : ('yellow' as const) }
                }),
                { label: 'Context', sub: ctx ? `${Math.round(ctx.tokens / 1000)}k of ${Math.round(ctx.window / 1000)}k` : 'no reading yet', percent: ctx ? ctx.percent : null, color: 'white' as const },
              ],
              pill: (() => {
                const session = lims.find(x => x.kind === 'five_hour')
                const text = session ? until(session.resetsAt, now) : ''
                return text ? text.replace(/^resets in/, 'Resets in') : 'This session'
              })(),
              score: { value: checksOk, of: 3, caption: checksOk === 3 ? 'All set up' : `${3 - checksOk} to set up` },
              insight: insightRuns,
              badges: [
                { name: 'graphify', ok: !!proj.graphify, mark: 'graph' },
                { name: 'GitHub', ok: !!proj.github, mark: 'github' },
                { name: 'Ponytail', ok: !!proj.ponytail, mark: 'ponytail' },
                { name: proj.pm, ok: Object.values(scriptRuns).some(r => r.status === 'running'), mark: 'npm' },
                { name: 'Claude', ok: true, mark: 'claude' },
              ],
            })}
            alt={`Usage: ${lims.map(l => `${LIMIT_NAMES[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%`).join(', ') || 'no reading yet'}. Project: ${checksOk} of 3 set up.`}
          />
        ) : (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text bold>Project</Text>
              {[
                { name: 'graphify', ok: !!proj.graphify, note: proj.graphify ? since(proj.graphify, now) : 'no graph (run /graphify)' },
                { name: 'GitHub', ok: !!proj.github, note: proj.github ? [proj.github, proj.branch].filter(Boolean).join(' · ') : 'no repository connected' },
                { name: 'Ponytail', ok: !!proj.ponytail, note: proj.ponytail ? `enabled (${proj.ponytail})` : 'not enabled (/plugin install ponytail@ponytail)' },
              ].map(c => (
                <Box flexDirection="row" gap={1}>
                  <Text color={c.ok ? 'success' : 'error'}>{c.ok ? '✓' : '✗'}</Text>
                  <Text>{c.name}</Text>
                  <Text dimColor wrap="truncate-end">
                    {c.note}
                  </Text>
                </Box>
              ))}
            </Box>
            <Box flexDirection="column">
              <Text bold>Usage limits</Text>
              {lims.length === 0 && <Text dimColor>No reading yet (it shows up after the first reply).</Text>}
              {lims.map(l => (
                <Box flexDirection="row" gap={1}>
                  <Text>{LIMIT_NAMES[l.kind] ?? l.kind}</Text>
                  <Text color={levelColor(l.percentUsed)}>{bar(l.percentUsed, barWidth)}</Text>
                  <Text bold color={levelColor(l.percentUsed)}>{`${Math.round(l.percentUsed)}%`}</Text>
                  <Text dimColor wrap="truncate-end">
                    {until(l.resetsAt, now)}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* The actions, one row: the project's scripts and the GitHub button. */}
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {proj.names.map(name => {
              const run = scriptRuns[name]
              const going = run?.status === 'running'
              return (
                <Button
                  key={`script:${name}`}
                  variant={going ? 'secondary' : 'primary'}
                  label={run?.status === 'stopping' ? `Stopping ${name}…` : going ? `Stop ${name}` : `${proj.pm} ${proj.pm === 'npm' && name === 'start' ? 'start' : `run ${name}`}`}
                  onPress={() => void (going ? stopScript($, name) : run?.status === 'stopping' ? undefined : runScript($, name))}
                />
              )
            })}
            {(gh.phase === 'idle' || gh.phase === 'done' || gh.phase === 'error') && (
              <Button
                key="github:start"
                variant="secondary"
                label={proj.git === false ? 'Create GitHub repo & push' : !proj.github ? 'Publish to GitHub & push' : 'Commit & push'}
                onPress={() => void prepareGithub($)}
              />
            )}
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
          {gh.phase === 'preparing' && <Text dimColor>Sonnet is writing the commit message…</Text>}
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

        <Box flexDirection="column">
          {head('skills', 'Skills', ownSkills.length + builtinSkills.length, activeOf([...ownSkills, ...builtinSkills], skillKey), true)}
          {opened('skills', true) && (
            <Box flexDirection="column">
              {ownSkills.length === 0 && <Text dimColor>No skills of your own.</Text>}
              {sortSkills(ownSkills).map(s => skillRow(s))}
              {drawer('skills:builtin', 'Built-in', sortSkills(builtinSkills), s => skillRow(s, '  '), activeOf(builtinSkills, skillKey))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          {head('mcp', 'MCP Servers', ownServers.length + desktopServers.length, activeOf([...ownServers, ...desktopServers], serverKey), true)}
          {opened('mcp', true) && (
            <Box flexDirection="column">
              {ownServers.length === 0 && <Text dimColor>No servers of your own.</Text>}
              {sortServers(ownServers).map(s => serverRow(s))}
              {drawer('mcp:builtin', 'Built-in (Claude Desktop)', sortServers(desktopServers), s => serverRow(s, '  '), activeOf(desktopServers, serverKey))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          {head('connectors', 'Connectors', connectors.length, activeOf(connectors, serverKey), true)}
          {opened('connectors', true) && (
            <Box flexDirection="column">
              {connectors.length === 0 && <Text dimColor>No Claude account connectors in this session.</Text>}
              {sortServers(connectors).map(s => serverRow(s))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          {head('plugins', 'Plugins', pluginList.length, pluginList.filter(pluginBusy).length, true)}
          {opened('plugins', true) && (
            <Box flexDirection="column">
              {ownPlugins.length === 0 && <Text dimColor>No plugins of your own.</Text>}
              {order(ownPlugins, pluginBusy, pluginUsed).map(p => pluginBlock(p))}
              {drawer('plugins:builtin', 'Built-in (Anthropic)', order(builtinPlugins, pluginBusy, pluginUsed), p => pluginBlock(p, '  '), builtinPlugins.filter(pluginBusy).length)}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
