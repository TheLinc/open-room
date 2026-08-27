/** The machine's Claude Code login, as `claude auth status` reports it. */
export type LoginStatus =
  | { state: 'signed-in'; email?: string; authMethod?: string; subscriptionType?: string }
  | { state: 'signed-out' }
  /** The check could not run or could not be read; agents may still work. */
  | { state: 'unknown' }
