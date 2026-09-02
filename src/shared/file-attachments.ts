import { mentionFor } from './file-mentions'

/**
 * Files attached to a prompt as chips rather than typed `@` mentions.
 *
 * A chip is composer display only: what the agent receives is still the
 * `@path` reference, appended to the outgoing text exactly as if the user
 * had typed it — the agent has Read, and nothing about "`@file` is sent as
 * typed" changes. What this file owns is the list (dedupe, ordering) and
 * how the chips serialize into the prompt; which icon a kind gets is the
 * chip component's business.
 */

export type FileAttachment = {
  /** Absolute path, as the OS reported it. */
  path: string
}

/** The file name alone, for the chip label. */
export function baseName(path: string): string {
  const posix = path.replace(/\\/g, '/')
  return posix.slice(posix.lastIndexOf('/') + 1)
}

export type FileIconKind = 'react' | 'code' | 'data' | 'text' | 'image' | 'archive' | 'file'

const KINDS: Record<string, FileIconKind> = {
  tsx: 'react',
  jsx: 'react',
  ts: 'code',
  js: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  cs: 'code',
  sh: 'code',
  ps1: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  vue: 'code',
  svelte: 'code',
  sql: 'code',
  json: 'data',
  jsonc: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'data',
  csv: 'data',
  md: 'text',
  txt: 'text',
  rst: 'text',
  log: 'text',
  pdf: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  '7z': 'archive',
  rar: 'archive'
}

/** Which icon family the chip shows, from the file name's extension. */
export function fileIconKind(name: string): FileIconKind {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'file'
  return KINDS[name.slice(dot + 1).toLowerCase()] ?? 'file'
}

/**
 * The list with `path` added, unless it is already there. Case-insensitive
 * and separator-insensitive: this app attaches from Windows and WSL paths,
 * and `C:\a\b.ts` dropped twice must not become two chips because one came
 * through a dialog spelled with forward slashes.
 */
export function addFile(files: FileAttachment[], path: string): FileAttachment[] {
  const key = path.replace(/\\/g, '/').toLowerCase()
  if (files.some((f) => f.path.replace(/\\/g, '/').toLowerCase() === key)) return files
  return [...files, { path }]
}

/**
 * The outgoing prompt: the typed text with each attachment's `@` mention
 * appended, spelled the way a drop used to spell it into the draft —
 * relative inside the workspace, absolute outside, quoted when it holds a
 * space.
 */
export function appendMentions(
  text: string,
  files: FileAttachment[],
  workspacePath: string
): string {
  if (files.length === 0) return text
  const mentions = files.map((f) => mentionFor(f.path, workspacePath)).join(' ')
  if (!text) return mentions
  return (text.endsWith(' ') ? text : `${text} `) + mentions
}
