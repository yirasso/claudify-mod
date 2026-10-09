/** A start command running (or that ran): its state, the command, its tree's PID, its last lines, its address, and a port it found taken. */
export type ScriptRun = {
  status: 'running' | 'stopping' | 'exited'
  code: number | null
  cmd?: string
  pid?: string
  tail: string[]
  url?: string
  busyPort?: number
}

/** What Start Project runs: a name for its run (`dev`, `cargo`, `python`…) and the command line. */
export type StartCommand = { name: string; cmd: string }

/**
 * The session's project: what Start Project runs (or null); the install command it needs (or null); when the graphify graph was built (graph.json's date,
 * or null without it) and whether commits or docs left out since make it out of date; the GitHub repository of the
 * `origin` remote (`owner/repo`, or null) and the current branch; the enabled Ponytail plugin's id, or null;
 * whether there is something to send to GitHub (changed files, unpushed commits, or a repo not on GitHub yet), and
 * how many commits GitHub has that the branch does not (as of the last fetch); how many files wait to be committed,
 * and when the last commit was made (ms), for the commit reminder.
 */
export type ProjectScripts = { start: StartCommand | null; install: string | null; graphify: number | null; graphStale: boolean; github: string | null; branch: string | null; ponytail: string | null; git: boolean; pending: boolean; behind: number; changed: number; lastCommit: number | null }

/** A rate-limit window: `five_hour` or `seven_day`, how much of it is used (0 to 100) and when it resets. */
export type UsageLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** What the GitHub button does: a new repo (no git yet), publish an existing repo, or commit and push. */
export type GithubPlan = 'create' | 'publish' | 'push'

/** The GitHub button's flow: preparing (Haiku writes the message), waiting to confirm, working, and the end. */
export type GithubFlow = {
  phase: 'idle' | 'preparing' | 'confirm' | 'working' | 'done' | 'error'
  plan: GithubPlan
  message?: string
  files?: number
  ahead?: number
  target?: string
  url?: string
  /** The commit the last Save Changes made, while Undo is offered. */
  undo?: string
  log: string[]
}

/** The graph being built or updated: the line the band shows, and whether it is a failure. */
export type GraphJob = { text: string; isError?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'claudify': {
      /** The project's scripts the band can run, and its checks. */
      project: ProjectScripts
      /** Each script whose button was pressed, by name. */
      runs: Record<string, ScriptRun>
      /** The GitHub button's flow. */
      github: GithubFlow
      /** The account's rate-limit windows, as the last response reported them. */
      limits: UsageLimit[]
      /** The weekly window as this session (or the week, if it reset since) first read it; null until then. */
      weekStart: UsageLimit | null
      /** The graph's update while it runs, or null. */
      graphJob: GraphJob | null
      /** Whether a long turn's end plays the done sound (mirrored in the plugin's store, across sessions). */
      notify: boolean
      /** Whether VS Code's `code` command is installed (the </> button shows only then). */
      vscode: boolean
    }
  }
}
