import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentConfigSchema, type Agent, type AgentConfig } from '@shared/agent'
import { appSettingsSchema, DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'

/**
 * Reads and writes agents under `~/.open-room/agents/<id>/`.
 *
 * Both files are plain and hand-editable on purpose, so this store treats the
 * filesystem as the source of truth: it validates on every read and reports
 * bad files rather than repairing them. Silently substituting defaults for a
 * config someone hand-edited would hide their mistake and discard their work.
 */

export const CONFIG_FILE = 'config.json'
export const CONTEXT_FILE = 'AGENT.md'
export const SETTINGS_FILE = 'settings.json'

/** A directory that exists but could not be loaded. Surfaced, never dropped. */
export type AgentLoadError = {
  id: string
  /** Human-readable reason, safe to show in the UI. */
  message: string
}

export type LoadedAgents = {
  agents: Agent[]
  errors: AgentLoadError[]
}

export class ConfigStore {
  readonly root: string
  private watcher: FSWatcher | null = null
  private debounce: NodeJS.Timeout | null = null

  constructor(root = join(homedir(), '.open-room')) {
    this.root = root
  }

  get agentsDir(): string {
    return join(this.root, 'agents')
  }

  agentDir(id: string): string {
    return join(this.agentsDir, id)
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.agentsDir, { recursive: true })
  }

  /**
   * Loads every agent. Directories that fail validation come back in `errors`
   * so the UI can show what is wrong and where, instead of the agent silently
   * vanishing from the sidebar.
   */
  async list(): Promise<LoadedAgents> {
    await this.ensureRoot()

    const entries = await readdir(this.agentsDir, { withFileTypes: true })
    const agents: Agent[] = []
    const errors: AgentLoadError[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      try {
        agents.push(await this.read(entry.name))
      } catch (error) {
        errors.push({
          id: entry.name,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }

    agents.sort((a, b) => a.config.name.localeCompare(b.config.name))
    return { agents, errors }
  }

  async read(id: string): Promise<Agent> {
    const dir = this.agentDir(id)

    let raw: string
    try {
      raw = await readFile(join(dir, CONFIG_FILE), 'utf8')
    } catch {
      throw new Error(`${CONFIG_FILE} is missing`)
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (error) {
      throw new Error(
        `${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    const parsed = agentConfigSchema.safeParse(json)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
        .join('; ')
      throw new Error(`${CONFIG_FILE} is invalid — ${detail}`)
    }

    // The directory name is authoritative: it is what the app resolved the
    // agent by. A mismatched `id` field means the directory was renamed by
    // hand, and trusting the file would produce two agents with one identity.
    if (parsed.data.id !== id) {
      throw new Error(`${CONFIG_FILE} declares id "${parsed.data.id}" but lives in "${id}"`)
    }

    let context = ''
    try {
      context = await readFile(join(dir, CONTEXT_FILE), 'utf8')
    } catch {
      // A missing AGENT.md is recoverable — the agent just has no extra
      // context yet. A missing config.json is not.
    }

    return { config: parsed.data, context }
  }

  async write(agent: Agent): Promise<void> {
    const parsed = agentConfigSchema.parse(agent.config)
    const dir = this.agentDir(parsed.id)

    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, CONFIG_FILE), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    await writeFile(join(dir, CONTEXT_FILE), agent.context, 'utf8')
  }

  /**
   * Reads app settings, falling back to defaults.
   *
   * Unlike agent configs, a malformed settings file falls back silently: it
   * is app-wide, so refusing to start over it would lock the user out of the
   * UI they would use to fix it.
   */
  async readSettings(): Promise<AppSettings> {
    try {
      const raw = await readFile(join(this.root, SETTINGS_FILE), 'utf8')
      const parsed = appSettingsSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  async writeSettings(settings: AppSettings): Promise<void> {
    const parsed = appSettingsSchema.parse(settings)
    await mkdir(this.root, { recursive: true })
    await writeFile(join(this.root, SETTINGS_FILE), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  }

  async exists(id: string): Promise<boolean> {
    const entries = await readdir(this.agentsDir, { withFileTypes: true }).catch(() => [])
    return entries.some((entry) => entry.isDirectory() && entry.name === id)
  }

  async delete(id: string): Promise<void> {
    await rm(this.agentDir(id), { recursive: true, force: true })
  }

  /**
   * Calls `onChange` when anything under the agents directory changes, so
   * edits made outside the app show up without a restart.
   *
   * `fs.watch` fires several times for one logical edit — a write is often
   * truncate-then-write — so changes are debounced. `recursive` is supported
   * on Windows and macOS, which are the platforms Open Room targets.
   */
  async startWatching(onChange: () => void, debounceMs = 150): Promise<void> {
    await this.ensureRoot()
    this.stopWatching()

    this.watcher = watch(this.agentsDir, { recursive: true }, () => {
      if (this.debounce) clearTimeout(this.debounce)
      this.debounce = setTimeout(onChange, debounceMs)
    })
  }

  stopWatching(): void {
    if (this.debounce) {
      clearTimeout(this.debounce)
      this.debounce = null
    }
    this.watcher?.close()
    this.watcher = null
  }
}

export type { AgentConfig }
