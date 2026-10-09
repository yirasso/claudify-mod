/** A project script running (or that ran): its state, its tree's PID, its last lines and its address. */
export type ScriptRun = {
  status: 'running' | 'stopping' | 'exited'
  code: number | null
  pid?: string
  tail: string[]
  url?: string
}

/**
 * The session's project: the scripts the pane can run (`dev`, `start`) and the package manager; when the
 * graphify graph was built (the graphify-out folder's date, or null without it); the GitHub repository of the
 * `origin` remote (`owner/repo`, or null) and the current branch; the enabled Ponytail plugin's id, or null;
 * whether there is something to send to GitHub (changed files, unpushed commits, or a repo not on GitHub yet).
 */
export type ProjectScripts = { pm: string; names: string[]; graphify: number | null; github: string | null; branch: string | null; ponytail: string | null; git: boolean; pending: boolean }

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
  log: string[]
}

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
    }
  }
}
