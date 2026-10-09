/** A usage-limit window (`five_hour`, `seven_day`, `spend_limit`). */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** A skill the session lists; `plugin` is the plugin that brings it. */
export type SkillRow = { name: string; source: string; plugin?: string }

/** An MCP server or connector: its name as /mcp lists it, its tools' prefix, and how many tools it has. */
export type ServerRow = { name: string; wire: string; tools: number }

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
      limits: Limit[]
      skills: SkillRow[]
      servers: ServerRow[]
      /** What is in use right now: `skill:<name>` or `mcp:<prefix>`, with how many calls are in flight. */
      busy: Record<string, number>
      /** When each was last used, in ms. */
      used: Record<string, number>
      /** Ticks every 30 s, so "resets in" and "x min ago" keep moving. */
      tick: number
      /** The project's scripts the pane can run, and its checks. */
      project: ProjectScripts
      /** Each script whose button was pressed, by name. */
      runs: Record<string, ScriptRun>
      /** What is expanded or collapsed in the pane (sections, drawers, plugins), by id. */
      open: Record<string, boolean>
      /** The GitHub button's flow. */
      github: GithubFlow
      /** The context window's fill: the percent, the tokens in it and its size; null before a reading. */
      context: { percent: number; tokens: number; window: number } | null
      /** Whether the pane is open, for the band's Show / Hide button. */
      paneOpen: boolean
    }
  }
}
