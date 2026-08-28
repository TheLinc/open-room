# Contributing to Open Room

Thanks for looking. This file covers how to get a dev build running, how the code is laid out, and which decisions are settled versus open — so a contribution lands where it can be merged rather than where it has to be argued about.

## Dev setup

You need Node 22 and a Claude Code login. You do **not** need a global Claude Code install to run agents (the SDK bundles the binary), but the global CLI is how you sign in:

```bash
npm install -g @anthropic-ai/claude-code
claude                      # sign in, then exit
```

Then:

```bash
git clone https://github.com/TheLinc/open-room.git
cd open-room
npm install
npm run dev                 # main + preload + renderer with HMR
```

Every agent you run in dev bills your own Claude Code account, exactly as it would for a user.

Checks, all of which CI runs on Windows and macOS for every push:

```bash
npm run typecheck
npm run lint
npm test                    # vitest — pure logic, no audio, no subprocesses
npm run build
```

Audio-playing integration tests are separate and need a build first:

```bash
npm run build && npm run test:voice
```

If `npm run dev` fails with `Error: Electron uninstall`, Electron's postinstall skipped the binary download; `node node_modules/electron/install.js` fixes it.

### Running the app in isolation

Never test against your real `~/.open-room`. `OPEN_ROOM_HOME` relocates the root and `OPEN_ROOM_MODELS` the models directory; with `--user-data-dir` you get a second instance with its own single-instance lock. For driving the app programmatically, `npx electron-vite dev --remoteDebuggingPort 9433` exposes the renderer over the DevTools protocol and `window.openRoom` is the whole IPC surface. `CLAUDE.md` has the details, including the Windows-specific traps.

## Layout

```
src/shared/     pure logic every process may import — no window, mic or subprocess
src/main/       Electron main: AgentSupervisor, ConfigStore, SpeechBus, hotkeys, tray
src/preload/    the window.openRoom bridge
src/renderer/   React UI (shadcn/ui, Tailwind v4)
src/overlay/    the always-on-top listening pill / working HUD; owns the microphone
src/voice/      the plain-Node sidecar: Whisper, Silero VAD, TTS, playback, downloads
scripts/        verify-catalog and other maintenance scripts
```

The organising rule: **decisions are pure functions in `src/shared/` (or a pure module beside their executor), and executors are thin.** The capture reducer, the speech bus rules, the wake matcher, context-usage maths, session-override rules, slash-command filtering, `agentQueryOptions` — all of it is testable without a microphone, a window or the SDK. If you find yourself wanting to test something that needs one of those, extract the decision first.

`CLAUDE.md` is the long-form design record: every settled decision, the measurement behind it, and the gotchas that cost time. Read the section relevant to your change before making it. It is written for someone who has never seen the codebase.

## Tests

- **TDD the pure logic.** Write the failing test first. The high-value modules are listed in the Testing section of `CLAUDE.md`.
- **Prove a new guard can fail** before trusting it — reintroduce the bug deliberately and watch the test go red. Two tests in this repo passed for the wrong reason before that became the rule.
- **Don't read `process.platform` implicitly.** CI runs on macOS too. Anything platform-dependent takes the platform as a parameter and the tests pass `'win32'` or `'darwin'` explicitly.
- **Nothing counts as working until it has been seen working in a running app.** Several bugs here were invisible to the suite: hidden-window throttling killing the wake listener, the SDK resolving its binary inside the asar, `deviceId` being silently ignored. Drive the real thing for anything touching a window, audio or a subprocess.
- `voice-sink.test.ts` has one timing-sensitive case that fails perhaps one run in ten and passes on rerun. A single failure there on an otherwise green suite is that, not a regression.

## Pull requests

- One concern per PR. Commit messages follow the existing history: a Conventional Commits prefix, a short paragraph on what and why, past-tense bullets, and a verification line.
- Before opening, prove the branch tip on a clean checkout — `git worktree add <dir> HEAD`, then `npm ci`, typecheck, lint, test and build there. A green working tree once hid a tip that did not typecheck, because untracked files were being picked up. (Don't junction `node_modules` into the worktree; see `CLAUDE.md`.)
- If your change touches anything measured in `CLAUDE.md` — latency, CPU, token counts — re-measure and update the number rather than leaving a stale one.
- If you reverse a documented decision, say so in the PR and update `CLAUDE.md` in the same change.

## Settled decisions

These are the project's premise. A PR that reverses one will be closed with a pointer here rather than debated, so raise it as an issue first if you think one is wrong.

- **No `@anthropic-ai/sdk`, anywhere.** All model calls go through the Agent SDK so they bill the user's own login. That includes internal calls such as the speech condenser.
- **No API keys, no credentials, no proxying.** `ANTHROPIC_API_KEY` is stripped from every child environment.
- **No telemetry, no analytics, no phone-home.** No cloud TTS or STT.
- **Chat output is never altered.** Different channels (speech, notifications) get separately produced content.
- **No automatic conversation resets.**
- **`bypassPermissions` and `dontAsk` are never exposed in the UI.**
- **Voice input ships off; wake words are a second opt-in.**
- **`settingSources: []`** — an agent gets what its config says, not what the machine has.
- **No native modules in the Electron process.** They go in the sidecar.
- **Piper is out** (licensing). Kokoro is in.
- **Synthesis writes a WAV; playback is a separate process we own.** That is what makes interruption possible.
- **Every PowerShell script text is a constant.** Per-utterance values go through the environment (AMSI caches by content; see `CLAUDE.md`).

## Open questions and known gaps

Contributions here are actively wanted.

- **macOS has never run this.** The DMG target and entitlements are configured and CI builds on a macOS runner, but nobody has launched the result. A first report — even "it does not start" — is valuable.
- **Hold-to-talk.** Only toggle-to-talk exists; Electron's `globalShortcut` has no key-up. The design has it as a native key hook in the voice sidecar.
- **Moving the wake gate onto the `AudioWorklet`.** Most of the ~8% idle CPU is a 60 Hz render loop kept alive in a hidden window; the worklet is never throttled and would remove both the cost and the dependency on `backgroundThrottling: false`.
- **The CPU budget** is written against a 2020-era laptop and has only been measured on a desktop.
- **`ContextMeter` thresholds** are hand-picked (70/90%); the SDK's `autoCompactThreshold` from `getContextUsage()` is the honest anchor, and the detailed context card on that call is not built.
- **Code signing.** Builds are unsigned on both platforms.
- **Deferred by design**, not by difficulty: agent-to-agent delegation, cross-machine session resume, shared agent configs, speaker identification, hooks/plugin management UI, command authoring. See `plan.md`'s Deferred section if you have access to it, or open an issue to discuss.

## Reporting bugs

Use the issue template. The three facts behind most plausible bug reports are the OS, the Claude Code version (`claude --version`), and whether voice input is enabled — please include all three.
