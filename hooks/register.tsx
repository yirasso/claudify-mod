// The Claudify band above the prompt: the project's actions (Start/Stop Project, Save Changes, Setup Project),
// and on the right whether GitHub, graphify and Ponytail are on and the 5-hour and weekly limits, with the script
// output and the GitHub confirm flow under them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GithubFlow, GithubPlan, GraphJob, ProjectScripts, ScriptRun, StartCommand, UsageLimit } from '../types'

const project = atom({ plugin: 'claudify', key: 'project' } as const, { start: null, install: null, graphify: null, graphStale: false, github: null, branch: null, ponytail: null, git: true, pending: false, behind: 0, changed: 0, lastCommit: null })
const runs = atom({ plugin: 'claudify', key: 'runs' } as const, {})
const github = atom({ plugin: 'claudify', key: 'github' } as const, { phase: 'idle', plan: 'push', log: [] })
const limits = atom({ plugin: 'claudify', key: 'limits' } as const, [])
const weekStart = atom({ plugin: 'claudify', key: 'weekStart' } as const, null)
const graphJob = atom({ plugin: 'claudify', key: 'graphJob' } as const, null)
const notify = atom({ plugin: 'claudify', key: 'notify' } as const, true)
const vscode = atom({ plugin: 'claudify', key: 'vscode' } as const, false)
const menuOpen = atom({ plugin: 'claudify', key: 'menuOpen' } as const, false)

// ——— The project: what Start Project runs, and the checks ———

/** The package.json scripts Start Project runs, the first one there wins. */
const START_SCRIPTS = ['dev', 'start', 'serve', 'preview'] as const
/** Lines of a run's output kept (the band shows the last two; Send error to Claude sends them all). */
const TAIL = 40

/**
 * What Start Project runs in this folder: a package.json script (by its package manager's lockfile), Expo,
 * Cargo, Go, a Python entry point (through uv when it has a uv.lock) or a Godot project; null for none.
 */
async function startCommand($: EngineInterface, cwd: string): Promise<StartCommand | null> {
  const has = (file: string) => $.fs.exists(`${cwd}/${file}`).catch(() => false)
  type Pkg = { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
  let pkg: Pkg | null = null
  try {
    pkg = JSON.parse(await $.fs.read(`${cwd}/package.json`)) as Pkg
  } catch {
    // No package.json.
  }
  if (pkg) {
    let pm = 'npm'
    if (await has('pnpm-lock.yaml')) pm = 'pnpm'
    else if (await has('yarn.lock')) pm = 'yarn'
    else if ((await has('bun.lockb')) || (await has('bun.lock'))) pm = 'bun'
    const script = START_SCRIPTS.find(s => typeof pkg?.scripts?.[s] === 'string')
    if (script) return { name: script, cmd: `${pm} run ${script}` }
    if (pkg.dependencies?.expo || pkg.devDependencies?.expo) return { name: 'expo', cmd: 'npx expo start' }
  }
  if (await has('Cargo.toml')) return { name: 'cargo', cmd: 'cargo run' }
  if (await has('go.mod')) return { name: 'go', cmd: 'go run .' }
  const python = (await has('uv.lock')) ? 'uv run python' : 'python'
  if (await has('manage.py')) return { name: 'django', cmd: `${python} manage.py runserver` }
  for (const entry of ['main.py', 'app.py']) if (await has(entry)) return { name: 'python', cmd: `${python} ${entry}` }
  // shortcut: Godot runs as `godot` from PATH; point it at the editor's exe when a project needs another.
  if (await has('project.godot')) return { name: 'godot', cmd: 'godot --path .' }
  return null
}

/** The terminal's colour codes, which the pane does not draw. */
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g')

/** The model for what setting up needs a model for: the first commit's message and the graph's docs. */
const SETUP_MODEL = 'claude-sonnet-5-5'

/**
 * The Setup Project button, in code: Ponytail on for the project, the graph built, then the GitHub flow (which
 * waits for the person to confirm). A model runs only for the commit message and for docs the graph needs.
 */
async function setupProject($: EngineInterface): Promise<void> {
  const p = await read($, project)
  if (!p.ponytail) await enablePonytail($)
  if (p.graphify === null) await updateGraph($)
  if (!p.github) await prepareGithub($, SETUP_MODEL)
  await readProject($)
}

/** Turns Ponytail on in the project's own settings (.claude/settings.json), keeping what is there. */
async function enablePonytail($: EngineInterface): Promise<void> {
  const file = `${await $.session.cwd()}/.claude/settings.json`
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(await $.fs.read(file)) as Record<string, unknown>
  } catch {
    // No project settings yet.
  }
  const enabled = { ...((settings.enabledPlugins as Record<string, unknown> | undefined) ?? {}), 'ponytail@ponytail': true }
  await $.fs.write(file, JSON.stringify({ ...settings, enabledPlugins: enabled }, null, 2) + '\n')
  $.ui.toast('Ponytail is on for this project: /reload-plugins loads it.')
}

/** Files graphify reads with a model (docs); code it reads alone. */
// shortcut: PDFs, images and other media graphify also reads are left out; add them when a project needs them.
const DOC_FILE = /\.(md|mdx|txt|rst)$/i
/** How much of the docs goes to Sonnet in one request, and how much of one doc. */
const DOC_BATCH_CHARS = 80_000
const DOC_CHARS = 40_000

/** Where docs left out of the graph start (a time in ms; empty when none wait), so the dot stays yellow for them. */
const DOCS_SINCE = 'graphify-out/.claudify_docs_since'

/**
 * Builds or updates the graph: `graphify update` reads the code with no model (`code: false` when graphify's
 * own commit hook just did). Docs changed since `since` (by default the graph's date, or when docs were last left
 * out; every doc on a first build) go to Sonnet (`addDocs`), or with `docs: false` wait, the dot staying yellow.
 */
async function updateGraph($: EngineInterface, opts: { docs?: boolean; code?: boolean; since?: number } = {}): Promise<void> {
  const withDocs = opts.docs ?? true
  const cwd = await $.session.cwd()
  const { graphify } = await read($, project)
  const waiting = Number((await $.fs.read(`${cwd}/${DOCS_SINCE}`).catch(() => '')).trim()) || null
  const since = graphify === null ? null : Math.min(waiting ?? Infinity, opts.since ?? graphify)
  await update($, graphJob, (): GraphJob => ({ text: opts.code === false ? 'Adding the commit\'s docs to the graph…' : 'Updating the graph from the code…' }))
  if (since === null) await ignoreGraphOutput($)
  if (opts.code !== false) {
    const built = await sh($, ['graphify', 'update', '.'], undefined, 600_000)
    if (built.exitCode !== 0) return graphFailed($, `graphify update failed: ${lastLine(built.stderr)}`)
    if (since === null) await installGraphHook($)
  }
  const listed = since === null ? await sh($, ['git', 'ls-files']) : await sh($, ['git', 'log', `--since=@${Math.floor(since / 1000)}`, '--name-only', '--format='])
  const docs = [...new Set(listed.stdout.split('\n').map(f => f.trim()))].filter(f => DOC_FILE.test(f) && !f.startsWith('graphify-out/'))
  if (docs.length && withDocs && !(await addDocs($, docs))) return
  await $.fs.write(`${cwd}/${DOCS_SINCE}`, docs.length && !withDocs ? String(since ?? Date.now()) : '').catch(() => undefined)
  await update($, graphJob, () => null)
  await readProject($)
}

/**
 * The docs part, the only one that needs a model: Sonnet 5.5 (medium effort) reads the docs in batches with
 * the graphify skill's own extraction spec, and graph_docs.py merges what it wrote into the graph in code.
 */
async function addDocs($: EngineInterface, docs: string[]): Promise<boolean> {
  const cwd = await $.session.cwd()
  const specPath = `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude/skills/graphify/references/extraction-spec.md`
  const specText = await $.fs.read(specPath).catch(() => '')
  // The subagent prompt is the spec's fenced block; the band sends the files' text instead of paths to read.
  const spec = /```\n([\s\S]*?)\n```/.exec(specText)?.[1]
  if (!spec) return graphFailed($, `The graphify skill's extraction spec was not found (${specPath}).`).then(() => false)

  const texts: { path: string; text: string }[] = []
  for (const doc of docs) {
    const text = await $.fs.read(`${cwd}/${doc}`).catch(() => null)
    if (text !== null) texts.push({ path: `${cwd}/${doc}`, text: text.slice(0, DOC_CHARS) })
  }
  const batches: (typeof texts)[] = []
  for (const t of texts) {
    const last = batches[batches.length - 1]
    if (last && last.reduce((n, x) => n + x.text.length, 0) + t.text.length <= DOC_BATCH_CHARS) last.push(t)
    else batches.push([t])
  }
  for (const [i, batch] of batches.entries()) {
    await update($, graphJob, (): GraphJob => ({ text: `Code done; Sonnet is reading ${texts.length} doc${texts.length === 1 ? '' : 's'} for the graph (${i + 1}/${batches.length})…` }))
    const prompt = spec
      .replace('CHUNK_NUM', String(i + 1))
      .replace('TOTAL_CHUNKS', String(batches.length))
      .replace('FILE_LIST', batch.map(b => b.path).join('\n'))
      .replace(/DEEP_MODE \(if --mode deep was given\)/, 'DEEP_MODE (off for this run)')
    const reply = await $.model.complete({
      model: SETUP_MODEL,
      effort: 'medium',
      maxTokens: 16_000,
      system: 'You extract knowledge graph fragments for graphify. The files are given to you below, so do not try to read or write any file: reply with the JSON object only.',
      prompt: `${prompt}\n\nThe files' contents:\n\n${batch.map(b => `===== ${b.path} =====\n${b.text}`).join('\n\n')}`,
    })
    const json = reply.isAnswered ? /\{[\s\S]*\}/.exec(reply.text)?.[0] : undefined
    let parsed: { nodes?: unknown[] } | null = null
    try {
      parsed = json ? (JSON.parse(json) as { nodes?: unknown[] }) : null
    } catch {
      parsed = null
    }
    if (!parsed || !Array.isArray(parsed.nodes)) return graphFailed($, `Sonnet did not return the docs' graph (${reply.isAnswered ? 'no valid JSON' : reply.reason}).`).then(() => false)
    await $.fs.write(`${cwd}/graphify-out/.graphify_chunk_${String(i + 1).padStart(2, '0')}.json`, JSON.stringify(parsed))
  }

  await update($, graphJob, (): GraphJob => ({ text: 'Merging the docs into the graph…' }))
  const merged = await sh($, [await graphifyPython($, cwd), `${$.plugin.root}/scripts/graph_docs.py`, cwd, specPath], undefined, 600_000)
  if (merged.exitCode !== 0) return graphFailed($, `Merging the docs failed: ${lastLine(merged.stderr || merged.stdout)}`).then(() => false)
  return true
}

/** The Python graphify runs on: the one the skill saved, else uv's tool environment, else python. */
async function graphifyPython($: EngineInterface, cwd: string): Promise<string> {
  const saved = (await $.fs.read(`${cwd}/graphify-out/.graphify_python`).catch(() => '')).replace(/^﻿/, '').trim()
  if (saved && (await $.fs.exists(saved))) return saved
  const uvDir = (await sh($, ['uv', 'tool', 'dir'])).stdout.trim()
  const uvPython = `${uvDir}/graphifyy/Scripts/python.exe`
  return uvDir && (await $.fs.exists(uvPython)) ? uvPython : 'python'
}

/** The graph's line shows what went wrong (for two seconds, `collapseSoon`). */
async function graphFailed($: EngineInterface, text: string): Promise<void> {
  await update($, graphJob, (): GraphJob => ({ text: text.slice(0, 200), isError: true }))
  collapseSoon($)
}

/**
 * Two seconds after something finished, the band folds back: the GitHub flow's lines (a push, a pull, an error),
 * a graph failure and the runs that ended. A failed run stays while it has a button (Send error, Free port).
 */
function collapseSoon($: EngineInterface, ms = 2000): void {
  try {
    $.clock.after(ms, () => void collapse($).catch(() => undefined))
  } catch {
    // No clock (tests): the lines stay.
  }
}

async function collapse($: EngineInterface): Promise<void> {
  if (['done', 'error'].includes((await read($, github)).phase)) await update($, github, (): GithubFlow => ({ phase: 'idle', plan: 'push', log: [] }))
  if ((await read($, graphJob))?.isError) await update($, graphJob, () => null)
  const ended = Object.entries(await read($, runs)).filter(([name, r]) => r.status === 'exited' && !(r.code !== 0 && r.code !== null && name !== 'install'))
  if (ended.length) await update($, runs, all => Object.fromEntries(Object.entries(all).filter(([name]) => !ended.some(([n]) => n === name))))
}

const lastLine = (text: string): string => (text.trim().split('\n').pop() ?? '').slice(0, 160)

/** graphify's own git hooks: after each commit or checkout they rebuild the code graph (no model) in the background. */
async function installGraphHook($: EngineInterface): Promise<void> {
  if (!(await read($, project)).git) return
  if (!/post-commit: installed/.test((await sh($, ['graphify', 'hook', 'status'])).stdout)) await sh($, ['graphify', 'hook', 'install'])
  await keepGraphAttributesLocal($)
}

/**
 * The hook's merge driver line goes in .gitattributes, which would go to GitHub; it moves to .git/info/attributes
 * (this clone only), and a .gitattributes left with nothing else is removed (from git too, if it was committed).
 */
const MERGE_LINE = 'graphify-out/graph.json merge=graphify'
async function keepGraphAttributesLocal($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const shared = await $.fs.read(`${cwd}/.gitattributes`).catch(() => null)
  if (shared === null || !shared.split(/\r?\n/).some(l => l.trim() === MERGE_LINE)) return
  const local = (await sh($, ['git', 'rev-parse', '--git-path', 'info/attributes'])).stdout.trim()
  if (!local) return
  const localPath = /^([A-Za-z]:)?[\\/]/.test(local) ? local : `${cwd}/${local}`
  const had = await $.fs.read(localPath).catch(() => '')
  if (!had.split(/\r?\n/).some(l => l.trim() === MERGE_LINE)) await $.fs.write(localPath, `${had}${had && !had.endsWith('\n') ? '\n' : ''}${MERGE_LINE}\n`)
  const rest = shared.split(/\r?\n/).filter(l => l.trim() !== MERGE_LINE)
  if (rest.some(l => l.trim())) return void (await $.fs.write(`${cwd}/.gitattributes`, rest.join('\n')))
  const tracked = (await sh($, ['git', 'ls-files', '--error-unmatch', '.gitattributes'])).exitCode === 0
  if (tracked) await sh($, ['git', 'rm', '-q', '.gitattributes'])
  else if ((await $.env.get('OS')) === 'Windows_NT') await sh($, ['cmd', '/c', 'del', '/q', `${cwd}/.gitattributes`.replace(/\//g, '\\')])
  else await sh($, ['rm', '-f', `${cwd}/.gitattributes`])
}

/** The commit the band last saw, and the working tree's code changes it last put in the graph (this load only). */
let lastHead: string | null = null
let lastTree: string | null = null

/**
 * A new commit: graphify's hook rebuilds its code in the background; once graph.json is newer than the commit
 * (or after two minutes), the docs it changed go to Sonnet, with no button.
 */
async function followCommits($: EngineInterface): Promise<void> {
  const p = await read($, project)
  if (p.graphify === null || !p.git || (await read($, graphJob))) return
  const head = (await sh($, ['git', 'rev-parse', 'HEAD'])).stdout.trim()
  const before = lastHead
  lastHead = head || lastHead
  if (!head || before === null || before === head) return
  const sinceBefore = Number((await sh($, ['git', 'log', '-1', '--format=%ct', before])).stdout.trim()) * 1000 + 1000
  const committed = Number((await sh($, ['git', 'log', '-1', '--format=%ct', head])).stdout.trim()) * 1000
  const docs = (await sh($, ['git', 'diff', '--name-only', before, head])).stdout.split('\n').map(f => f.trim()).filter(f => DOC_FILE.test(f) && !f.startsWith('graphify-out/'))
  if (!docs.length) return
  const hooked = /post-commit: installed/.test((await sh($, ['graphify', 'hook', 'status'])).stdout)
  if (hooked) {
    await update($, graphJob, (): GraphJob => ({ text: "Waiting for graphify's hook to rebuild the code…" }))
    const cwd = await $.session.cwd()
    for (let i = 0; i < 40; i++) {
      const graph = await $.fs.stat(`${cwd}/graphify-out/graph.json`).catch(() => null)
      if (graph && graph.mtimeMs >= committed) break
      await $.clock.sleep(3000)
    }
  }
  await updateGraph($, { code: !hooked, since: Number.isFinite(sinceBefore) && sinceBefore > 1000 ? sinceBefore : undefined })
}

/** After a turn that changed code (committed or not), the code graph follows with no model; docs wait for the commit. */
async function followTurn($: EngineInterface): Promise<void> {
  const p = await read($, project)
  if (p.graphify === null || !p.git || (await read($, graphJob))) return
  const tree = (await sh($, ['git', 'status', '--porcelain'])).stdout
    .split('\n')
    .filter(l => l.trim() && !/graphify-out\//.test(l) && !DOC_FILE.test(l.trim()))
    .join('\n')
  const before = lastTree
  lastTree = tree
  if (!tree || tree === before) return
  await updateGraph($, { docs: false })
}

/** Adds graphify-out/ to .gitignore (creating it) unless it is there. */
async function ignoreGraphOutput($: EngineInterface): Promise<void> {
  const file = `${await $.session.cwd()}/.gitignore`
  const text = await $.fs.read(file).catch(() => '')
  if (/^\/?graphify-out\/?\s*$/m.test(text)) return
  await $.fs.write(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}graphify-out/\n`)
}

/**
 * The install a project needs: its manifest or lockfile is newer than what was installed (node_modules' own
 * record of the last install, or .venv for uv), or nothing is installed yet. Returns the command, or null.
 */
async function installCommand($: EngineInterface, cwd: string): Promise<string | null> {
  const mtime = async (file: string) => (await $.fs.stat(`${cwd}/${file}`).catch(() => null))?.mtimeMs ?? null
  if ((await mtime('package.json')) !== null) {
    const locks: [string, string, string][] = [
      ['pnpm-lock.yaml', 'pnpm install', 'node_modules/.modules.yaml'],
      ['yarn.lock', 'yarn install', 'node_modules/.yarn-integrity'],
      ['bun.lock', 'bun install', 'node_modules'],
      ['bun.lockb', 'bun install', 'node_modules'],
      ['package-lock.json', 'npm install', 'node_modules/.package-lock.json'],
    ]
    let found = locks[locks.length - 1] as [string, string, string]
    for (const l of locks) if ((await mtime(l[0])) !== null) { found = l; break }
    const [lock, cmd, record] = found
    const installed = (await mtime(record)) ?? (await mtime('node_modules'))
    const changed = Math.max((await mtime('package.json')) ?? 0, (await mtime(lock)) ?? 0)
    if (installed === null || changed > installed) return cmd
  }
  const uvLock = await mtime('uv.lock')
  if (uvLock !== null) {
    const venv = await mtime('.venv')
    if (venv === null || uvLock > venv) return 'uv sync'
  }
  return null
}

/**
 * The session folder's project: what Start Project runs, the graphify graph, the GitHub repository of the
 * `origin` remote and how the branch stands against it, and whether Ponytail is on.
 */
async function readProject($: EngineInterface): Promise<void> {
  // graphify: graphify-out/graph.json in the session folder (its date says when the graph was built).
  const cwd = await $.session.cwd().catch(() => '.')
  const start = await startCommand($, cwd)
  const install = await installCommand($, cwd)
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
  const branch = isRepo ? (await git('rev-parse', '--abbrev-ref', 'HEAD')) || null : null
  // Something to send to GitHub: a folder with no repo yet, a repo not on GitHub yet, changed files, or
  // commits the remote does not have (all of them, when the branch has no upstream).
  // Behind: commits the remote has and the branch does not (as of the last fetch).
  let pending: boolean
  let behind = 0
  // For the commit reminder: files waiting, and when the last commit was made.
  const status = isRepo ? await git('status', '--porcelain') : ''
  const changed = status ? status.split('\n').filter(Boolean).length : 0
  const lastCommit = isRepo ? Number(await git('log', '-1', '--format=%ct')) * 1000 || null : null
  if (!isRepo) pending = (await $.fs.list(cwd).catch(() => [])).some(x => !x.name.startsWith('.'))
  else if (!repo) pending = true
  else {
    const upstream = await git('rev-parse', '--abbrev-ref', '@{u}')
    const ahead = upstream ? Number(await git('rev-list', '--count', '@{u}..HEAD')) || 0 : (await git('rev-parse', 'HEAD')) ? 1 : 0
    behind = upstream ? Number(await git('rev-list', '--count', 'HEAD..@{u}')) || 0 : 0
    pending = status !== '' || ahead > 0
  }
  // Ponytail: the plugin enabled in the merged settings (user, project or local).
  const settings = (await $.settings.read().catch(() => ({}))) as { enabledPlugins?: Record<string, unknown> }
  const ponytail = Object.entries(settings.enabledPlugins ?? {}).find(([id, on]) => id.startsWith('ponytail@') && on === true)?.[0] ?? null
  // An empty graph.json is a build that failed: it does not count.
  const graphify = graph && graph.size > 0 ? graph.mtimeMs : null
  // The graph is out of date once a commit after it touched more than the graph and .gitignore.
  // shortcut: a commit made right after building the graph counts too, until a file-level check is worth it.
  // Docs the code-only refresh left out keep it out of date too.
  const codeStale = graphify !== null && isRepo && (await git('log', `--since=@${Math.floor(graphify / 1000)}`, '--format=%H', '--', '.', ':(exclude)graphify-out', ':(exclude).gitignore')) !== ''
  const docsWaiting = graphify !== null && Number((await $.fs.read(`${cwd}/${DOCS_SINCE}`).catch(() => '')).trim()) > 0
  const graphStale = codeStale || docsWaiting
  await update($, project, () => ({ start, install, graphify, graphStale, github: repo, branch, ponytail, git: isRepo, pending, behind, changed, lastCommit }))
}

/** Keeps the rate-limit windows the band draws. */
async function setLimits($: EngineInterface, rateLimits: readonly UsageLimit[]): Promise<void> {
  await update($, limits, () => rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) })))
  // The weekly reading this session started from: taken on the first reading, and again when the week resets.
  const week = rateLimits.find(l => l.kind === 'seven_day')
  if (week) await update($, weekStart, base => (!base || week.percentUsed < base.percentUsed || Date.parse(week.resetsAt ?? '') - Date.parse(base.resetsAt ?? '') > 3_600_000 ? { kind: week.kind, percentUsed: week.percentUsed, ...(week.resetsAt ? { resetsAt: week.resetsAt } : {}) } : base))
}

/** Ends a script's whole process tree (on Windows, killing only the parent leaves Vite and Electron alive). */
async function killTree($: EngineInterface, pid: string): Promise<void> {
  if ((await $.env.get('OS')) === 'Windows_NT') await $.process.run(['taskkill', '/PID', pid, '/T', '/F']).catch(() => undefined)
  else await $.process.run(['kill', '-TERM', pid]).catch(() => undefined)
}

/** A port another process holds, as the usual servers say it (Node, Vite with strictPort, Python). */
const BUSY_PORT = /(?:EADDRINUSE[^\d]*|port\s+|address already in use[^\d]*)(\d{2,5})(?:\s+is\s+(?:already\s+)?in use)?/i

/** Runs a start command in the session folder, keeping its state, its last lines, its address and a busy port. */
async function runScript($: EngineInterface, name: string, cmd: string): Promise<void> {
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  // A wrapper that prints its PID first, so "Stop" can end the whole tree.
  const argv = windows
    ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `Write-Output "__PID__=$PID"; ${cmd}; exit $LASTEXITCODE`]
    : ['sh', '-c', `echo "__PID__=$$"; exec ${cmd}`]
  const started: ScriptRun = { status: 'running', code: null, cmd, tail: [`> ${cmd}`] }
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
        collapseSoon($)
        return
      }
      rest += piece.value.text.replace(ANSI, '')
      const lines = rest.split(/\r?\n/)
      rest = lines.pop() ?? ''
      if (!lines.length) continue
      const pid = lines.map(l => /^__PID__=(\d+)/.exec(l)?.[1]).find(Boolean)
      const url = lines.map(l => /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?[^\s]*/.exec(l)?.[0]).find(Boolean)
      const shown = lines.filter(l => l.trim() && !l.startsWith('__PID__='))
      // A busy port only matters if the run then fails (Vite moves to the next port and goes on).
      const busy = shown.map(l => (/in use|EADDRINUSE/i.test(l) ? BUSY_PORT.exec(l)?.[1] : undefined)).find(Boolean)
      await update($, runs, all => {
        const was: ScriptRun = all[name] ?? { status: 'running', code: null, cmd, tail: [] }
        const now: ScriptRun = { ...was, ...(pid ? { pid } : {}), ...(url && !was.url ? { url } : {}), ...(busy ? { busyPort: Number(busy) } : {}), tail: [...was.tail, ...shown].slice(-TAIL) }
        return { ...all, [name]: now }
      })
    }
  } catch (err) {
    await update($, runs, all => {
      const failed: ScriptRun = { status: 'exited', code: null, cmd, tail: [...(all[name]?.tail ?? []), `Could not start: ${String(err)}`].slice(-TAIL) }
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

/** Ends whatever listens on `port` (the process a failed start ran into), then starts the run again. */
async function freePortAndStart($: EngineInterface, name: string, port: number): Promise<void> {
  const run = (await read($, runs))[name]
  if (!run?.cmd) return
  if ((await $.env.get('OS')) === 'Windows_NT') {
    // netstat's LISTENING rows end in the PID, IPv4 and IPv6 (Node listens on :::port): "TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  1234".
    const rows = (await sh($, ['netstat', '-ano'])).stdout.split('\n')
    const pids = new Set(rows.filter(r => /LISTENING/i.test(r) && new RegExp(`:${port}\\s`).test(r)).map(r => r.trim().split(/\s+/).pop() ?? '').filter(pid => /^\d+$/.test(pid) && pid !== '0' && pid !== '4'))
    for (const pid of pids) await killTree($, pid)
  } else {
    for (const pid of (await sh($, ['lsof', '-ti', `tcp:${port}`, '-sTCP:LISTEN'])).stdout.split('\n').filter(Boolean)) await killTree($, pid.trim())
  }
  await runScript($, name, run.cmd)
}

/** Sends a failed run's command, exit code and last lines to Claude, asking for the cause and a fix. */
async function sendError($: EngineInterface, name: string): Promise<void> {
  const run = (await read($, runs))[name]
  if (!run) return
  const output = run.tail.filter(l => !l.startsWith('> ')).join('\n')
  const fence = '```'
  await $.prompt.submit({ text: `Start Project ran \`${run.cmd ?? name}\` and it failed with exit code ${run.code}. Its last output:\n\n${fence}\n${output}\n${fence}\n\nFind the cause and fix it.` })
}

/**
 * The done sound (sounds/done.wav, a short rising chime made for the band). On Windows through PowerShell's
 * SoundPlayer, since the engine has no player there; elsewhere through the engine.
 */
async function playDone($: EngineInterface): Promise<void> {
  if ((await $.env.get('OS')) === 'Windows_NT') {
    const file = `${$.plugin.root}/sounds/done.wav`.replace(/\//g, '\\').replace(/'/g, "''")
    await sh($, ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer '${file}').PlaySync()`])
  } else await $.audio.play({ asset: 'sounds/done.wav' })
}

/** Turns the done sound on or off, for every session (kept in the plugin's store). */
async function toggleNotify($: EngineInterface): Promise<void> {
  const on = !(await read($, notify))
  await update($, notify, () => on)
  await $.store.set('notify', on).catch(() => undefined)
}

// ——— 10: the project's folder and editor ———

/** Opens the session folder in the file manager. */
async function openFolder($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  // explorer.exe launched from the engine does not come up; PowerShell's Invoke-Item opens it reliably.
  if ((await $.env.get('OS')) === 'Windows_NT') await sh($, ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `Invoke-Item -LiteralPath '${cwd.replace(/\//g, '\\').replace(/'/g, "''")}'`])
  else if ((await sh($, ['open', cwd])).exitCode !== 0) await sh($, ['xdg-open', cwd])
}

/** Whether VS Code's `code` command is installed (looked up once per load, for the </> button). */
async function findVscode($: EngineInterface): Promise<void> {
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const found = (await sh($, windows ? ['cmd', '/c', 'where', 'code'] : ['sh', '-c', 'command -v code'])).exitCode === 0
  await update($, vscode, () => found)
}

/** Opens the session folder in VS Code (`code` is a .cmd on Windows, so through cmd). */
async function openEditor($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  if ((await $.env.get('OS')) === 'Windows_NT') await sh($, ['cmd', '/c', 'code', cwd])
  else await sh($, ['code', cwd])
}

/** Opens a dev server's address in the default browser. */
async function openUrl($: EngineInterface, url: string): Promise<void> {
  if ((await $.env.get('OS')) === 'Windows_NT') await sh($, ['rundll32', 'url.dll,FileProtocolHandler', url])
  else if ((await sh($, ['open', url])).exitCode !== 0) await sh($, ['xdg-open', url])
}

// ——— The GitHub button: create the repo, publish it, or just commit and push ———

/** The branches the band does not call out. */
const MAIN_BRANCHES = ['main', 'master']

/** The model that writes the commit message for Save Changes (Haiku 5.5 at medium effort; Setup Project uses Sonnet). */
const COMMIT_MODEL = 'claude-haiku-5-5'
const DIFF_CHARS = 24_000

/** Runs git or gh in the session folder; resolves the result, or a failed one when it cannot start. */
async function sh($: EngineInterface, argv: string[], stdin?: string, timeoutMs = 120_000) {
  return $.process.run(argv, { timeoutMs, ...(stdin !== undefined ? { stdin } : {}) }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
}

/** A safe GitHub repository name from the session folder's name. */
async function repoName($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd().catch(() => 'project')
  const base = cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

/**
 * Step 1 of the button: works out what it will do (create, publish or push), gathers what changed and has
 * the model (Haiku, or Sonnet when setting up) write the commit message, then waits for the person to confirm.
 */
async function prepareGithub($: EngineInterface, model = COMMIT_MODEL): Promise<void> {
  await update($, github, (): GithubFlow => ({ phase: 'preparing', plan: 'push', log: [] }))
  const isRepo = (await sh($, ['git', 'rev-parse', '--is-inside-work-tree'])).stdout.trim() === 'true'
  const remotes = isRepo ? (await sh($, ['git', 'remote', '-v'])).stdout : ''
  const onGithub = /github\.com[:/]/.test(remotes)
  const plan: GithubPlan = !isRepo ? 'create' : onGithub ? 'push' : 'publish'
  const proj = await read($, project)
  const target = plan === 'push' ? `${proj.github ?? 'origin'}${proj.branch && !MAIN_BRANCHES.includes(proj.branch) ? ` ⎇ ${proj.branch}` : ''}` : `${await repoName($)} (private, new)`

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
    collapseSoon($)
    return
  }

  let message = ''
  if (files) {
    const reply = await $.model.complete({
      model,
      effort: 'medium',
      maxTokens: 400,
      system:
        'You write git commit messages. Reply with the message only: a subject line in the imperative mood, at most 72 characters, then a blank line and a short body of a few lines saying what changed and why when it helps. No markdown, no code fences, no quotes.',
      prompt: `${plan === 'create' ? 'This is the first commit of a new repository.\n\n' : ''}Files (git status --porcelain):\n${status.slice(0, 4000)}\n\nDiff:\n${diff.slice(0, DIFF_CHARS)}`
    })
    message = reply.isAnswered ? reply.text.trim().replace(/^```\w*\n?|```$/g, '').trim() : ''
    if (!message) {
      await update($, github, (): GithubFlow => ({ phase: 'error', plan, log: [`The model did not write a message (${reply.isAnswered ? 'empty reply' : reply.reason}).`] }))
      collapseSoon($)
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
      collapseSoon($)
      return false
    }
    await update($, github, (all): GithubFlow => ({ ...all, log: [...log] }))
    return true
  }
  if (flow.plan === 'create' && !(await step('git init', ['git', 'init']))) return
  let undo: string | undefined
  if (flow.files) {
    if (!(await step('git add -A', ['git', 'add', '-A']))) return
    if (!(await step('git commit', ['git', 'commit', '-F', '-'], flow.message ?? ''))) return
    undo = (await sh($, ['git', 'rev-parse', 'HEAD'])).stdout.trim() || undefined
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
  await update($, github, (all): GithubFlow => ({ ...all, phase: 'done', log: [...log], ...(url ? { url } : {}), ...(undo ? { undo } : {}) }))
  // With an Undo to offer, the lines stay ten seconds instead of two.
  collapseSoon($, undo ? 10_000 : 2000)
  await refreshCodeGraph($)
}

/** The code part of the graph follows a push or a pull by itself (no model); changed docs wait for the button. */
async function refreshCodeGraph($: EngineInterface): Promise<void> {
  await readProject($)
  if ((await read($, project)).graphify !== null) await updateGraph($, { docs: false })
}

/** Undo for the last Save Changes: it was pushed, so a revert commit undoes it, pushed in turn. */
async function undoSave($: EngineInterface): Promise<void> {
  const sha = (await read($, github)).undo
  if (!sha) return
  const log = [`> git revert ${sha.slice(0, 7)}`]
  await update($, github, (): GithubFlow => ({ phase: 'working', plan: 'push', log: [...log] }))
  const reverted = await sh($, ['git', 'revert', '--no-edit', sha])
  log.push(...`${reverted.stdout}\n${reverted.stderr}`.trim().split('\n').filter(Boolean).slice(-2))
  const pushed = reverted.exitCode === 0 ? await sh($, ['git', 'push']) : null
  if (pushed) log.push('> git push', ...`${pushed.stdout}\n${pushed.stderr}`.trim().split('\n').filter(Boolean).slice(-2))
  await update($, github, (): GithubFlow => ({ phase: pushed?.exitCode === 0 ? 'done' : 'error', plan: 'push', log }))
  collapseSoon($)
  await refreshCodeGraph($)
}

/** The Pull button: fast-forwards the branch to what GitHub has, reporting in the GitHub flow's lines. */
async function pullChanges($: EngineInterface): Promise<void> {
  await update($, github, (): GithubFlow => ({ phase: 'working', plan: 'push', log: ['> git pull --ff-only'] }))
  const r = await sh($, ['git', 'pull', '--ff-only'])
  const log = ['> git pull --ff-only', ...`${r.stdout}\n${r.stderr}`.trim().split('\n').filter(Boolean).slice(-3)]
  await update($, github, (): GithubFlow => ({ phase: r.exitCode === 0 ? 'done' : 'error', plan: 'push', log }))
  collapseSoon($)
  if (r.exitCode === 0) await refreshCodeGraph($)
  else await readProject($)
}

/** Asks GitHub what it has (quietly), so the Pull button knows; then reads the project again. */
async function fetchRemote($: EngineInterface): Promise<void> {
  if (!(await read($, project)).github) return
  await sh($, ['git', 'fetch', '--quiet'], undefined, 60_000)
  await readProject($)
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

/** The rate-limit windows that get a bar, in order, and the bar's width in cells. */
const LIMITS = [
  ['five_hour', '5h'],
  ['seven_day', 'Week'],
] as const
const BAR = 8

/** A time left, short: 40m, 2h10m, 3d4h. */
function untilReset(ms: number): string {
  const m = Math.ceil(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${m % 60 ? `${m % 60}m` : ''}`
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ''}`
}

/**
 * The band above the prompt: on the left the actions as real buttons with a symbol in front of the label
 * (Start/Stop Project; Save Changes while something waits to go to GitHub; Setup Project while a check is
 * off); on the right a dot for each check (GitHub, graphify, Ponytail) and the 5-hour and weekly limit
 * bars; then what the scripts and the GitHub flow report.
 */
function actionBar($: EngineInterface, ui: Ui, proj: ProjectScripts, scriptRuns: Record<string, ScriptRun>, gh: GithubFlow, usage: UsageLimit[], base: UsageLimit | null, job: GraphJob | null, notifyOn: boolean, hasVscode: boolean, menu: boolean) {
  const { Box, Button, Text } = ui
  // Start Project runs what this kind of project runs (startCommand).
  const start = proj.start
  const mainRun = start ? scriptRuns[start.name] : undefined
  const startButton = start ? (
    <Button
      key={`script:${start.name}`}
      variant={mainRun?.status === 'running' ? 'secondary' : 'primary'}
      label={mainRun?.status === 'stopping' ? '■ Stopping…' : mainRun?.status === 'running' ? '■ Stop Project' : '▶ Start Project'}
      onPress={() => void (mainRun?.status === 'running' ? stopScript($, start.name) : mainRun?.status === 'stopping' ? undefined : runScript($, start.name, start.cmd))}
    />
  ) : (
    <Text dimColor>▶ Start Project</Text>
  )
  // Save Changes is there only while something is waiting to go to GitHub, and not while its flow runs.
  // Many files waiting, or changes two hours after the last commit: Save Changes stands out, with the count.
  const nudge = proj.changed > 15 || (proj.changed > 0 && proj.lastCommit !== null && Date.now() - proj.lastCommit > 2 * 3_600_000)
  const saveButton = proj.pending && (gh.phase === 'idle' || gh.phase === 'done' || gh.phase === 'error') && (
    <Button key="github:start" variant={nudge ? 'primary' : 'secondary'} label={`↑ Save Changes${proj.changed ? ` (${proj.changed})` : ''}`} onPress={() => void prepareGithub($)} />
  )
  // Setup Project leaves once GitHub, graphify and Ponytail are all on.
  const setupButton = (!proj.github || !proj.graphify || !proj.ponytail) && (
    <Button key="project:setup" variant="secondary" label="⚙ Setup Project" onPress={() => void setupProject($)} />
  )
  // Update Graph is there while commits newer than the graph wait to go into it.
  const graphButton = proj.graphStale && (!job || job.isError) && (
    <Button key="graphify:update" variant="secondary" label="↻ Update Graph" onPress={() => void updateGraph($)} />
  )
  // Install deps is there while the manifest or lockfile is newer than the last install (a pull brought new ones).
  const installCmd = proj.install
  const installButton = installCmd && scriptRuns.install?.status !== 'running' && scriptRuns.install?.status !== 'stopping' && (
    <Button key="script:install" variant="secondary" label="⬇ Install deps" onPress={() => void runScript($, 'install', installCmd).then(() => readProject($))} />
  )
  // Pull is there while GitHub has commits the branch does not, and not while the GitHub flow runs.
  const pullButton = proj.behind > 0 && (gh.phase === 'idle' || gh.phase === 'done' || gh.phase === 'error') && (
    <Button key="github:pull" variant="secondary" label={`↓ Pull (${proj.behind})`} onPress={() => void pullChanges($)} />
  )
  // The checks: a filled green dot when it is on, a hollow dim one when it is not, a yellow one when out of date.
  const checks = [
    { label: 'GitHub', on: !!proj.github, stale: false },
    { label: 'graphify', on: proj.graphify !== null, stale: proj.graphStale },
    { label: 'Ponytail', on: !!proj.ponytail, stale: false },
  ]
  // The 5-hour and weekly limits as bars; a window past its reset reads empty until the next response.
  const now = Date.now()
  const bars = LIMITS.flatMap(([kind, label]) => {
    const l = usage.find(x => x.kind === kind)
    if (!l) return []
    const used = l.resetsAt && Date.parse(l.resetsAt) <= now ? 0 : Math.max(0, Math.min(100, l.percentUsed))
    const full = Math.round((used / 100) * BAR)
    // From 70% on, how long until the window resets.
    const left = used >= 70 && l.resetsAt ? Date.parse(l.resetsAt) - now : 0
    return [{ label, used, bar: '█'.repeat(full) + '░'.repeat(BAR - full), resets: left > 0 ? ` · ${untilReset(left)}` : '' }]
  })
  // How much of the week this session has used: the weekly reading less the one it started from.
  const week = usage.find(x => x.kind === 'seven_day')
  const session = week && base && !(week.resetsAt && Date.parse(week.resetsAt) <= now) ? Math.max(0, week.percentUsed - base.percentUsed) : null
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={1} flexWrap="wrap">
        <Box flexDirection="row" gap={1}>
          {startButton}
          {installButton}
          {pullButton}
          {saveButton}
          {setupButton}
          {graphButton}
        </Box>
        <Box flexDirection="row" gap={2}>
          {proj.branch && !MAIN_BRANCHES.includes(proj.branch) && <Text color="warning">{`⎇ ${proj.branch}`}</Text>}
          {checks.map(c => (
            <Text color={c.stale ? 'warning' : c.on ? 'success' : undefined} dimColor={!c.on}>
              {`${c.on ? '●' : '○'} ${c.label}`}
            </Text>
          ))}
          {bars.map(b => (
            <Text color={b.used >= 90 ? 'error' : b.used >= 70 ? 'warning' : undefined}>
              {`${b.label} ${b.bar} ${Math.round(b.used)}%${b.resets}`}
            </Text>
          ))}
          {session !== null && <Text dimColor>{`Session +${Number(session.toFixed(1))}%`}</Text>}
          <Button key="band:menu" variant="secondary" label={menu ? '×' : '⋯'} onPress={() => void update($, menuOpen, open => !open)} />
        </Box>
      </Box>
      {menu && (
        // The ⋯ menu: the rarely used actions, out of the band's row; a choice closes it.
        <Box flexDirection="row" gap={1} justifyContent="flex-end">
          <Button key="project:folder" variant="secondary" label="📁 Open folder" onPress={() => void update($, menuOpen, () => false).then(() => openFolder($))} />
          {hasVscode && <Button key="project:editor" variant="secondary" label="</> Open in VS Code" onPress={() => void update($, menuOpen, () => false).then(() => openEditor($))} />}
          <Button key="notify:toggle" variant="secondary" label={notifyOn ? '🔔 Sound on' : '🔕 Sound off'} onPress={() => void toggleNotify($)} />
        </Box>
      )}
    {Object.entries(scriptRuns).map(([name, run]) => {
      const state = run.status === 'running' ? 'running' : run.status === 'stopping' ? 'stopping' : run.code === 0 ? 'finished' : run.code === null ? 'stopped' : `exited with code ${run.code}`
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={run.status === 'running' ? 'success' : run.code ? 'error' : undefined} dimColor={run.status !== 'running'}>
              {`${name} ${state}`}
            </Text>
            {run.url && run.status === 'running' && <Text color="suggestion">{run.url}</Text>}
            {run.url && run.status === 'running' && <Button key={`script:open:${name}`} variant="secondary" label="↗ Open" onPress={() => void openUrl($, run.url ?? '')} />}
            {run.status === 'exited' && run.code !== 0 && run.code !== null && !run.busyPort && name !== 'install' && (
              <Button key={`script:send:${name}`} variant="secondary" label="✦ Send error to Claude" onPress={() => void sendError($, name)} />
            )}
            {run.status === 'exited' && run.code !== 0 && run.code !== null && run.busyPort && (
              <Button key={`script:free:${name}`} variant="secondary" label={`✕ Free port ${run.busyPort} and start`} onPress={() => void freePortAndStart($, name, run.busyPort ?? 0)} />
            )}
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
    {job && (
      <Text dimColor={!job.isError} color={job.isError ? 'error' : undefined} wrap="truncate-end">
        {job.text}
      </Text>
    )}
    {gh.phase === 'preparing' && <Text dimColor>Writing the commit message…</Text>}
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
    {gh.phase === 'done' && gh.undo && <Button key="github:undo" variant="secondary" label="↶ Undo" onPress={() => void undoSave($)} />}
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
    // Nothing of the graph runs across a reload: a line left from before (a failure) goes, and what had finished folds back.
    await update($, graphJob, () => null)
    await collapse($)
    const notifyOn = await $.store.get('notify').catch(() => undefined)
    if (typeof notifyOn === 'boolean') await update($, notify, () => notifyOn)
    void findVscode($).catch(() => undefined)
    await readProject($)
    const usage = await $.session.usage().catch(() => null)
    if (usage) await setLimits($, usage.rateLimits)
    // The project's checks stay current: a new graph, a plugin enabled or a new remote shows within 10 s.
    $.clock.every(10_000, () => void readProject($).then(() => followCommits($)).catch(() => undefined))
    if ((await read($, project)).graphify !== null) void installGraphHook($).catch(() => undefined)
    // What GitHub has: now and every 5 minutes, for the Pull button.
    void fetchRemote($).catch(() => undefined)
    $.clock.every(300_000, () => void fetchRemote($).catch(() => undefined))
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
    const base = await read($, weekStart)
    const job = await read($, graphJob)
    const notifyOn = await read($, notify)
    const hasVscode = await read($, vscode)
    const menu = await read($, menuOpen)
    return <Box flexDirection="column">{actionBar($, $.ui.resolve(e), proj, scriptRuns, gh, usage, base, job, notifyOn, hasVscode, menu)}</Box>
  })

  // The limit bars follow the windows as the engine measures them.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await setLimits($, e.rateLimits)
    return next(e)
  })

  // When the session ends, whatever the buttons left running is ended too.
  on('session.end', async ($, e, next) => {
    for (const run of Object.values(await read($, runs))) if (run.status !== 'exited' && run.pid) await killTree($, run.pid)
    // A /clear starts the session's weekly count over: the next reading is its new start.
    if (e.reason === 'clear') await update($, weekStart, () => null)
    return next(e)
  })

  // When the turn ends, the project is read again (a graph built, a plugin installed).
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await readProject($)
    // The main thread's turn only: the code it changed goes into the graph, and a commit it made brings its docs.
    if (e.agentId === undefined) void followCommits($).then(() => followTurn($)).catch(() => undefined)
    // A turn over a minute long ends with the done sound, so the person can do something else meanwhile.
    if (e.agentId === undefined && e.durationMs > 60_000 && (await read($, notify))) void playDone($).catch(() => undefined)
    return done
  })
}
