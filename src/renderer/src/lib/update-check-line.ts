import type { UpdateStatus } from '@shared/updates'

/**
 * One line under "Check now" in Settings: what the last check found, then
 * what is running.
 *
 * The finding leads and the running version follows in words. The first
 * version read "Running 0.3.0. 0.4.0 is available." on one line, and two
 * version numbers back to back, both opening a sentence, did not parse as two
 * facts. "You have 0.3.0." after the finding keeps a word between the numbers.
 */
export function describeCheck(status: UpdateStatus, version: string): string {
  const running = version ? `You have ${version}.` : ''
  switch (status.state) {
    case 'unchecked':
      return running
    case 'current':
      return version ? `Version ${version} is the latest release.` : 'This is the latest release.'
    case 'available':
      return `Version ${status.release.version} is available. ${running}`.trim()
    case 'failed':
      return `Could not check: ${status.message}. ${running}`.trim()
  }
}
