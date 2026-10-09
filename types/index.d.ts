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
 * `origin` remote (`owner/repo`, or null) and the current branch; the enabled Ponytail plugin's id, or null.
 */
export type ProjectScripts = { pm: string; names: string[]; graphify: number | null; github: string | null; branch: string | null; ponytail: string | null; git: boolean }

/** What the GitHub button does: a new repo (no git yet), publish an existing repo, or commit and push. */
export type GithubPlan = 'create' | 'publish' | 'push'

/** The GitHub button's flow: preparing (Sonnet writes the message), waiting to confirm, working, and the end. */
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
    }
  }
}
