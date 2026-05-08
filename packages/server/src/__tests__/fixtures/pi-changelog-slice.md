# Changelog

## [0.70.0] - 2026-04-23

### New Features

- Searchable auth provider login flow: the `/login` provider selector now supports fuzzy search/filtering, making it faster to find providers when many are configured. See [docs/providers.md](docs/providers.md). ([#3572](https://github.com/badlogic/pi-mono/pull/3572) by [@mitsuhiko](https://github.com/mitsuhiko))
- GPT-5.5 Codex support: `openai-codex/gpt-5.5` is available as a model option, including `xhigh` reasoning support and corrected priority-tier pricing.
- Terminal progress indicators are now opt-in: OSC 9;4 progress reporting during streaming/compaction is off by default and can be toggled via `terminal.showTerminalProgress` in `/settings` ([#3588](https://github.com/badlogic/pi-mono/issues/3588))
- `--no-builtin-tools` / `createAgentSession({ noTools: "builtin" })` now correctly disables only built-in tools while keeping extension tools active. See [docs/extensions.md](docs/extensions.md) and [README.md](README.md) ([#3592](https://github.com/badlogic/pi-mono/issues/3592))

### Breaking Changes

- Disabled OSC 9;4 terminal progress indicators by default. Set `terminal.showTerminalProgress` to `true` in `/settings` to re-enable ([#3588](https://github.com/badlogic/pi-mono/issues/3588))

### Added

- Added searchable auth provider login flow with fuzzy filtering in the provider selector ([#3572](https://github.com/badlogic/pi-mono/pull/3572) by [@mitsuhiko](https://github.com/mitsuhiko))
- Added GPT-5.5 Codex model
- Added auth source labels in `/login` so provider entries can show when auth comes from `--api-key`, an environment variable, or custom provider fallback without exposing secrets.

### Changed

- Updated default model selection across providers to current recommended models.
- Improved stale extension context errors after session replacement or reload to tell extension authors to avoid captured `pi`/command `ctx` and use `withSession` for post-replacement work.

### Fixed

- Fixed `/model` selector cancellation to request render instead of incorrectly triggering login selector.
- Changed login, OAuth, and extension selectors for more consistent styling.
- Added Amazon Bedrock setup guidance to `/login` and updated `/model` copy to refer to configured providers instead of only API keys.
- Improved no-model and missing-auth warnings to point users to `/login` for OAuth or API key setup.
- Fixed `/quit` shutdown ordering to stop the TUI before extension UI teardown can repaint, preserving the final rendered frame while still emitting `session_shutdown` before process exit.
- Fixed `SettingsManager.inMemory()` initial settings being lost after reloads triggered by SDK resource loading ([#3616](https://github.com/badlogic/pi-mono/issues/3616))
- Fixed `models.json` provider compatibility to accept `compat.supportsLongCacheRetention`, allowing proxies to opt out of long-retention cache fields when needed while long retention is enabled by default when requested ([#3543](https://github.com/badlogic/pi-mono/issues/3543))
- Fixed `--thinking xhigh` for `openai-codex` `gpt-5.5` so it is no longer downgraded to `high`.
- Fixed git package installs with custom `npmCommand` values such as `pnpm` by avoiding npm-specific production flags in that compatibility path ([#3604](https://github.com/badlogic/pi-mono/issues/3604))
- Fixed first user messages rendering without spacing after existing notices such as compaction summaries or status messages ([#3613](https://github.com/badlogic/pi-mono/issues/3613))
- Fixed the handoff extension example to use the replacement-session context after creating a new session, avoiding stale `ctx` errors when it installs the generated prompt ([#3606](https://github.com/badlogic/pi-mono/issues/3606))
- Fixed session replacement and `/quit` teardown ordering to run host-owned extension UI cleanup synchronously after `session_shutdown` handlers complete but before invalidating the old extension context, preventing stale extension UI from rendering against a disposed session ([#3597](https://github.com/badlogic/pi-mono/pull/3597) by [@vegarsti](https://github.com/vegarsti))
- Fixed crash on `/quit` when an extension registers a custom footer whose `render()` accesses `ctx`, by tearing down extension-provided UI before invalidating the extension runner during shutdown ([#3595](https://github.com/badlogic/pi-mono/issues/3595))
- Fixed auto-retry to treat Bedrock/Smithy HTTP/2 transport failures like `http2 request did not get a response` as transient errors, so the agent retries automatically instead of waiting for a manual nudge ([#3594](https://github.com/badlogic/pi-mono/issues/3594))
- Fixed the CLI/SDK tool-selection split so `--no-builtin-tools` and `createAgentSession({ noTools: "builtin" })` disable only built-in default tools while keeping extension/custom tools enabled, instead of falling through to the same "disable everything" path as `--no-tools` ([#3592](https://github.com/badlogic/pi-mono/issues/3592))
- Fixed remaining hardcoded `pi` / `.pi` branding to route through `APP_NAME` and `CONFIG_DIR_NAME` extension points, so SDK rebrands get consistent naming in `/quit` description, `process.title`, and the project-local extensions directory ([#3583](https://github.com/badlogic/pi-mono/pull/3583) by [@jlaneve](https://github.com/jlaneve))
- Fixed `pi-coding-agent` shipping `uuid@11`, which triggered `npm audit` moderate vulnerability reports for downstream installs; the package now depends on `uuid@14` ([#3577](https://github.com/badlogic/pi-mono/issues/3577))
- Fixed `openai-completions` streamed tool-call assembly to coalesce deltas by stable tool index when OpenAI-compatible gateways mutate tool call IDs mid-stream, preventing malformed Kimi K2.6/OpenCode tool streams from splitting one call into multiple bogus tool calls ([#3576](https://github.com/badlogic/pi-mono/issues/3576))
- Fixed `ctx.ui.setWorkingMessage()` to persist across loader recreation, matching the behavior of `ctx.ui.setWorkingIndicator()` ([#3566](https://github.com/badlogic/pi-mono/issues/3566))
- Fixed coding-agent `fs.watch` error handling for theme and git-footer watchers to retry after transient watcher failures such as `EMFILE`, avoiding startup crashes in large repos ([#3564](https://github.com/badlogic/pi-mono/issues/3564))
- Fixed built-in `kimi-coding` model generation to attach the expected `User-Agent` header so direct Kimi Coding requests use the provider's expected client identity ([#3586](https://github.com/badlogic/pi-mono/issues/3586))
- Fixed extension shortcut conflict diagnostics to display at startup instead of only on reload, so extension authors discover reserved keybinding conflicts immediately rather than discovering them later through user feedback ([#3617](https://github.com/badlogic/pi-mono/issues/3617))
- Fixed `models.json` Anthropic-compatible provider configuration to accept `compat.supportsEagerToolInputStreaming`, allowing proxies that reject per-tool `eager_input_streaming` to use the legacy fine-grained tool streaming beta header instead ([#3575](https://github.com/badlogic/pi-mono/issues/3575))
- Fixed startup banner extension labels to strip trailing `index.js`/`index.ts` suffixes ([#3596](https://github.com/badlogic/pi-mono/pull/3596) by [@aliou](https://github.com/aliou))
- Fixed OSC 9;4 terminal progress updates to stay alive in terminals such as Ghostty during long-running agent work ([#3610](https://github.com/badlogic/pi-mono/issues/3610))
- Fixed OpenAI-compatible completion usage parsing to avoid double-counting reasoning tokens already included in `completion_tokens` ([#3581](https://github.com/badlogic/pi-mono/issues/3581))
- Fixed `openai-responses` compatibility for strict OpenAI-compatible proxies by allowing `models.json` to disable the underscore-containing `session_id` header with `compat.sendSessionIdHeader: false` ([#3579](https://github.com/badlogic/pi-mono/issues/3579))
- Fixed GPT-5.5 Codex capability handling to clamp unsupported minimal reasoning to `low` and apply the model's 2.5x priority service-tier pricing multiplier ([#3618](https://github.com/badlogic/pi-mono/pull/3618) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.69.0] - 2026-04-22

### New Features

- TypeBox 1.x migration for extensions and SDK integrations, including TypeBox-native tool argument validation that now works in eval-restricted runtimes such as Cloudflare Workers. See [docs/extensions.md](docs/extensions.md) and [docs/sdk.md](docs/sdk.md).
- Stacked extension autocomplete providers via `ctx.ui.addAutocompleteProvider(...)`, allowing extensions to layer custom completion logic on top of built-in slash and path completion. See [docs/extensions.md#autocomplete-providers](docs/extensions.md#autocomplete-providers) and [examples/extensions/github-issue-autocomplete.ts](examples/extensions/github-issue-autocomplete.ts).
- Terminating tool results via `terminate: true`, allowing custom tools to end on a final tool call without paying for an automatic follow-up LLM turn. See [docs/extensions.md](docs/extensions.md) and [examples/extensions/structured-output.ts](examples/extensions/structured-output.ts).
- OSC 9;4 terminal progress indicators during agent streaming and compaction for supporting terminals.

### Breaking Changes

- Migrated first-party coding-agent code, SDK/examples/docs, and package metadata from `@sinclair/typebox` 0.34.x to `typebox` 1.x. New extensions, SDK integrations, and pi packages should depend on and import from `typebox`. Legacy extension loading still aliases the root `@sinclair/typebox` package, but `@sinclair/typebox/compiler` is no longer shimmed. This migration also picks up the new `@mariozechner/pi-ai` TypeBox-native validator path, so tool argument validation now works in eval-restricted runtimes such as Cloudflare Workers instead of being skipped ([#3112](https://github.com/badlogic/pi-mono/issues/3112))
- Session-replacement commands now invalidate captured pre-replacement session-bound extension objects after `ctx.newSession()`, `ctx.fork()`, and `ctx.switchSession()`. Old `pi` and command `ctx` references now throw instead of silently targeting the replaced session. Migration: if code needs to keep working in the replacement session after one of those calls, pass `withSession` to that same method and do the post-switch work there. In practice, move post-switch `pi.sendUserMessage()`, `pi.sendMessage()`, and command-ctx/session-manager access into `withSession`, and use only the `ReplacedSessionContext` passed to that callback for session-bound operations. Footguns: `withSession` runs after the old extension instance has already received `session_shutdown`, old cleanup may already have invalidated captured state, captured old `pi` / old command `ctx` are stale, and previously extracted raw objects such as `const sm = ctx.sessionManager` remain the caller's responsibility and must not be reused after the switch.

### Added

- Added support for terminating tool results via `terminate: true`, allowing custom tools to end the current tool batch without an automatic follow-up LLM call, plus a `structured-output.ts` extension example and extension docs showing the pattern ([#3525](https://github.com/badlogic/pi-mono/issues/3525))
- Added OSC 9;4 terminal progress indicators during agent streaming and compaction, so terminals like iTerm2, WezTerm, Windows Terminal, and Kitty show activity in their tab bar
- Added `ctx.ui.addAutocompleteProvider(...)` for stacking extension autocomplete providers on top of the built-in slash/path provider, plus a `github-issue-autocomplete.ts` example and extension docs ([#2983](https://github.com/badlogic/pi-mono/issues/2983))

### Fixed

- Fixed exported session HTML to sanitize markdown link URLs before rendering them into anchor tags, blocking `javascript:`-style payloads while preserving safe links in shared/exported sessions ([#3532](https://github.com/badlogic/pi-mono/issues/3532))
- Fixed `ctx.getSystemPrompt()` inside `before_agent_start` to reflect chained system-prompt changes made by earlier `before_agent_start` handlers, and clarified the extension docs around provider-payload rewrites and what `ctx.getSystemPrompt()` does and does not report ([#3539](https://github.com/badlogic/pi-mono/issues/3539))
- Fixed built-in `google-gemini-cli` model lists and selector entries to include `gemini-3.1-flash-lite-preview`, so Cloud Code Assist users no longer need manual `--model` fallback selection to use it ([#3545](https://github.com/badlogic/pi-mono/issues/3545))
- Fixed extension session-replacement flows so `ctx.newSession()`, `ctx.fork()`, `ctx.switchSession()`, and imported-session replacements fully rebind before post-switch work runs, added `withSession` replacement callbacks with fresh `ReplacedSessionContext` helpers, and make stale pre-replacement `pi` / `ctx` session-bound accesses throw instead of silently targeting the wrong session ([#2860](https://github.com/badlogic/pi-mono/issues/2860))
- Fixed `models.json` built-in provider overrides to accept `headers` without requiring `baseUrl`, so request-header-only overrides now load and apply correctly ([#3538](https://github.com/badlogic/pi-mono/issues/3538))

## [0.68.1] - 2026-04-22

### New Features

- Fireworks provider support with built-in models and `FIREWORKS_API_KEY` auth. See [README.md#providers--models](README.md#providers--models) and [docs/providers.md](docs/providers.md).
- Configurable inline tool image width via `terminal.imageWidthCells` in `/settings`. See [docs/settings.md#terminal--images](docs/settings.md#terminal--images).

### Added

- Added built-in Fireworks provider support, including `FIREWORKS_API_KEY` setup/docs and the default Fireworks model `accounts/fireworks/models/kimi-k2p6` ([#3519](https://github.com/badlogic/pi-mono/issues/3519))

### Fixed

- Fixed interactive inline tool images to honor configurable `terminal.imageWidthCells` via `/settings`, so tool-output images are no longer hard-capped to 60 terminal cells ([#3508](https://github.com/badlogic/pi-mono/issues/3508))
- Fixed `sessionDir` in `settings.json` to expand `~`, so portable session-directory settings no longer require a shell wrapper ([#3514](https://github.com/badlogic/pi-mono/issues/3514))
- Fixed parallel tool-call rows to leave the pending state as soon as each tool is finalized, while still appending persisted tool results in assistant source order ([#3503](https://github.com/badlogic/pi-mono/issues/3503))
- Fixed exported session markdown to render Markdown while showing HTML-like message content such as `<file name="...">...</file>` verbatim, so shared sessions match the TUI instead of letting the browser interpret message text ([#3484](https://github.com/badlogic/pi-mono/issues/3484))
- Fixed exported session HTML to render `grep` and `find` output through their existing TUI renderers and `ls` output through a native template renderer, avoiding missing formatting and spacing artifacts in shared sessions ([#3491](https://github.com/badlogic/pi-mono/pull/3491) by [@aliou](https://github.com/aliou))
- Fixed `@` autocomplete fuzzy search to follow symlinked directories and include symlinked paths in results ([#3507](https://github.com/badlogic/pi-mono/issues/3507))
- Fixed proxied agent streams to preserve the proxy-safe serializable subset of stream options, including session, transport, retry-delay, metadata, header, cache-retention, and thinking-budget settings ([#3512](https://github.com/badlogic/pi-mono/issues/3512))
- Hardened Anthropic streaming against malformed tool-call JSON by owning SSE parsing with defensive JSON repair, replacing the deprecated `fine-grained-tool-streaming` beta header with per-tool `eager_input_streaming`, and updating stale test model references ([#3175](https://github.com/badlogic/pi-mono/issues/3175))
- Fixed Bedrock runtime endpoint resolution to stop pinning built-in regional endpoints over `AWS_REGION` / `AWS_PROFILE`, restoring `us.*` and `eu.*` inference profile support after v0.68.0 while preserving custom VPC/proxy endpoint overrides ([#3481](https://github.com/badlogic/pi-mono/issues/3481), [#3485](https://github.com/badlogic/pi-mono/issues/3485), [#3486](https://github.com/badlogic/pi-mono/issues/3486), [#3487](https://github.com/badlogic/pi-mono/issues/3487), [#3488](https://github.com/badlogic/pi-mono/issues/3488))

## [0.68.0] - 2026-04-20

### New Features

- Configurable streaming working indicator for extensions via `ctx.ui.setWorkingIndicator()`, including animated, static, and hidden indicators. See [docs/tui.md#working-indicator](docs/tui.md#working-indicator), [docs/extensions.md](docs/extensions.md), and [examples/extensions/working-indicator.ts](examples/extensions/working-indicator.ts).
- `before_agent_start` now exposes `systemPromptOptions` (`BuildSystemPromptOptions`) so extensions can inspect the structured system-prompt inputs without re-discovering resources. See [docs/extensions.md#before_agent_start](docs/extensions.md#before_agent_start) and [examples/extensions/prompt-customizer.ts](examples/extensions/prompt-customizer.ts).
- Configurable keybindings for scoped model selector actions and session-tree filter actions. See [docs/keybindings.md](docs/keybindings.md).
- `/clone` duplicates the current active branch into a new session, while extensions can choose whether to fork `before` or `at` an entry via `ctx.fork(..., { position })`. See [README.md](README.md), [docs/extensions.md](docs/extensions.md), and [docs/session.md](docs/session.md).

### Breaking Changes

- Changed SDK and CLI tool selection from cwd-bound built-in tool instances to tool-name allowlists. `createAgentSession({ tools })` now expects `string[]` names such as `"read"` and `"bash"` instead of `Tool[]`, `--tools` now allowlists built-in, extension, and custom tools by name, and `--no-tools` now disables all tools by default rather than only built-ins. Migrate SDK code from `tools: [readTool, bashTool]` to `tools: ["read", "bash"]` ([#2835](https://github.com/badlogic/pi-mono/issues/2835), [#3452](https://github.com/badlogic/pi-mono/issues/3452))
- Removed prebuilt cwd-bound tool and tool-definition exports from `@mariozechner/pi-coding-agent`, including `readTool`, `bashTool`, `editTool`, `writeTool`, `grepTool`, `findTool`, `lsTool`, `readOnlyTools`, `codingTools`, and the corresponding `*ToolDefinition` values. Use the explicit factory exports instead, for example `createReadTool(cwd)`, `createBashTool(cwd)`, `createCodingTools(cwd)`, and `createReadToolDefinition(cwd)` ([#3452](https://github.com/badlogic/pi-mono/issues/3452))
- Removed ambient `process.cwd()` / default agent-dir fallback behavior from public resource helpers. `DefaultResourceLoader`, `loadProjectContextFiles()`, and `loadSkills()` now require explicit cwd/agent-dir style inputs, and exported system-prompt option types now require an explicit `cwd`. Pass the session or project cwd explicitly instead of relying on process-global defaults ([#3452](https://github.com/badlogic/pi-mono/issues/3452))

### Added

- Added extension support for customizing the interactive streaming working indicator via `ctx.ui.setWorkingIndicator()`, including custom animated frames, static indicators, hidden indicators, a new `working-indicator.ts` example extension, and updated extension/TUI/RPC docs ([#3413](https://github.com/badlogic/pi-mono/issues/3413))
- Added `systemPromptOptions` (`BuildSystemPromptOptions`) to `before_agent_start` extension events, so extensions can inspect the structured inputs used to build the current system prompt ([#3473](https://github.com/badlogic/pi-mono/pull/3473) by [@dljsjr](https://github.com/dljsjr))
- Added `/clone` to duplicate the current active branch into a new session, while keeping `/fork` focused on forking from a previous user message ([#2962](https://github.com/badlogic/pi-mono/issues/2962))
- Added `ctx.fork()` support for `position: "before" | "at"` so extensions and integrations can branch before a user message or duplicate the current point in the conversation; the interactive clone/fork UX builds on that runtime support ([#3431](https://github.com/badlogic/pi-mono/pull/3431) by [@mitsuhiko](https://github.com/mitsuhiko))
- Added configurable keybinding ids for scoped model selector actions and tree filter actions, so those interactive shortcuts can be remapped in `keybindings.json` ([#3343](https://github.com/badlogic/pi-mono/pull/3343) by [@mpazik](https://github.com/mpazik))
- Added `PI_OAUTH_CALLBACK_HOST` support for built-in OAuth login flows, allowing local callback servers used by `pi auth` to bind to a custom interface instead of hardcoded `127.0.0.1` ([#3409](https://github.com/badlogic/pi-mono/pull/3409) by [@Michaelliv](https://github.com/Michaelliv))
- Added `reason` and `targetSessionFile` metadata to `session_shutdown` extension events, so extensions can distinguish quit, reload, new-session, resume, and fork teardown paths ([#2863](https://github.com/badlogic/pi-mono/issues/2863))

### Changed

- Changed `pi update` to batch npm package updates per scope and run git package updates with bounded parallelism, reducing multi-package update time while preserving skip behavior for pinned and already-current packages ([#2980](https://github.com/badlogic/pi-mono/issues/2980))
- Changed Bedrock session requests to omit `maxTokens` when model token limits are unknown and to omit `temperature` when unset, letting Bedrock use provider defaults and avoid unnecessary TPM quota reservation ([#3400](https://github.com/badlogic/pi-mono/pull/3400) by [@wirjo](https://github.com/wirjo))

### Fixed

- Fixed `AgentSession` system-prompt option initialization to avoid constructing an invalid empty `BuildSystemPromptOptions`, so `npm run check` passes after `cwd` became mandatory.
- Fixed shell-path resolution to stop consulting ambient `process.cwd()` state during bash execution, so session/project-specific `shellPath` settings now follow the active coding-agent session cwd instead of the launcher cwd ([#3452](https://github.com/badlogic/pi-mono/issues/3452))
- Fixed `ctx.ui.setWorkingIndicator()` custom frames to render verbatim instead of forcing the theme accent color, so extensions now own working-indicator coloring when they customize it ([#3467](https://github.com/badlogic/pi-mono/issues/3467))
- Fixed `pi update` reinstalling npm packages that are already at the latest published version by checking the installed package version before running `npm install <pkg>@latest` ([#3000](https://github.com/badlogic/pi-mono/issues/3000))
- Fixed `@` autocomplete plain queries to stop matching against the full cwd/base path, so path fragments in worktree names no longer crowd out intended results such as `@plan` ([#2778](https://github.com/badlogic/pi-mono/issues/2778))
- Fixed built-in tool wrapping to use the same extension-runner context path as extension tools, so built-in tools receive execution context and `read` can warn when the current model does not support images ([#3429](https://github.com/badlogic/pi-mono/issues/3429))
- Fixed `openai-completions` assistant replay to preserve `compat.requiresThinkingAsText` text-part serialization, avoiding same-model follow-up crashes when previous assistant messages mix thinking and text ([#3387](https://github.com/badlogic/pi-mono/issues/3387))
- Fixed direct OpenAI Chat Completions sessions to map `sessionId` and `cacheRetention` to prompt caching fields, sending `prompt_cache_key` when caching is enabled and `prompt_cache_retention: "24h"` for direct `api.openai.com` requests with long retention ([#3426](https://github.com/badlogic/pi-mono/issues/3426))
- Fixed OpenAI-compatible Chat Completions sessions to optionally send aligned `session_id`, `x-client-request-id`, and `x-session-affinity` headers from `sessionId` via `compat.sendSessionAffinityHeaders`, improving cache-affinity routing for backends such as Fireworks ([#3430](https://github.com/badlogic/pi-mono/issues/3430))
- Fixed threaded `/resume` session relationships and current-session detection to canonicalize symlinked session paths during selector comparisons, so shared session directories no longer break parent-child matching or active-session delete protection ([#3364](https://github.com/badlogic/pi-mono/issues/3364))
- Fixed `/session`, Sessions docs, and CLI help to consistently document that session reuse supports both file paths and session IDs, and that `/session` shows the current session ID ([#3390](https://github.com/badlogic/pi-mono/issues/3390))
- Fixed Windows pnpm global install detection to recognize `\\.pnpm\\` store paths, so update notices now suggest `pnpm install -g @mariozechner/pi-coding-agent` instead of falling back to npm ([#3378](https://github.com/badlogic/pi-mono/issues/3378))
- Fixed missing `@sinclair/typebox` runtime dependency in `@mariozechner/pi-coding-agent`, so strict pnpm installs no longer fail with `ERR_MODULE_NOT_FOUND` when starting `pi` ([#3434](https://github.com/badlogic/pi-mono/issues/3434))
- Fixed xterm uppercase typing in the interactive editor by decoding printable `modifyOtherKeys` input and normalizing shifted letter matching, so `Shift+letter` no longer disappears in `pi` ([#3436](https://github.com/badlogic/pi-mono/issues/3436))
- Fixed `/compact` to reuse the session thinking level for compaction summaries instead of forcing `high`, avoiding invalid reasoning-effort errors on `github-copilot/claude-opus-4.7` sessions configured for `medium` thinking ([#3438](https://github.com/badlogic/pi-mono/issues/3438))
- Fixed shared/exported plain-text tool output to preserve indentation instead of collapsing leading whitespace in the web share page ([#3440](https://github.com/badlogic/pi-mono/issues/3440))
- Fixed exported share pages to use browser-safe `T` and `O` shortcuts with clickable header toggles for thinking and tool visibility instead of browser-reserved `Ctrl+T` / `Ctrl+O` bindings ([#3374](https://github.com/badlogic/pi-mono/pull/3374) by [@vekexasia](https://github.com/vekexasia))
- Fixed skill resolution to dedupe symlinked aliases by canonical path, so `pi config` no longer shows duplicate skill entries when `~/.pi/agent/skills` points to `~/.agents/skills` ([#3417](https://github.com/badlogic/pi-mono/pull/3417) by [@rwachtler](https://github.com/rwachtler))
- Fixed OpenRouter request attribution to include Pi app headers (`HTTP-Referer: https://pi.dev`, `X-OpenRouter-Title: pi`, `X-OpenRouter-Categories: cli-agent`) when sessions are created through the coding-agent SDK and install telemetry is enabled ([#3414](https://github.com/badlogic/pi-mono/issues/3414))
- Fixed custom-model `compat` schema/docs to support `cacheControlFormat: "anthropic"` for OpenAI-compatible providers that expose Anthropic-style prompt caching via `cache_control` markers ([#3392](https://github.com/badlogic/pi-mono/issues/3392))
- Fixed Cloud Code Assist tool schemas to strip JSON Schema meta-declaration keys before provider translation, avoiding validation failures for tool-enabled sessions that use `$schema`, `$defs`, and related metadata ([#3412](https://github.com/badlogic/pi-mono/pull/3412) by [@vladlearns](https://github.com/vladlearns))
- Fixed direct Bedrock sessions to honor `model.baseUrl` as the runtime client endpoint, restoring support for custom Bedrock VPC or proxy routes ([#3402](https://github.com/badlogic/pi-mono/pull/3402) by [@wirjo](https://github.com/wirjo))
- Fixed the `edit` tool to coerce stringified `edits` JSON before validation, so models that send the array payload as a JSON string no longer fall back to ad-hoc shell edits ([#3370](https://github.com/badlogic/pi-mono/pull/3370) by [@dannote](https://github.com/dannote))
- Fixed package manifest positive glob entries to expand before loading packaged resources, restoring manifest patterns such as `skills/**/*.md` ([#3350](https://github.com/badlogic/pi-mono/pull/3350) by [@neonspectra](https://github.com/neonspectra))

## [0.67.68] - 2026-04-17

## [0.67.67] - 2026-04-17

### New Features

- Bedrock sessions can now authenticate with `AWS_BEARER_TOKEN_BEDROCK`, enabling Converse API access without local SigV4 credentials. See [docs/providers.md#amazon-bedrock](docs/providers.md#amazon-bedrock).

### Added

- Added Bedrock bearer-token authentication support via `AWS_BEARER_TOKEN_BEDROCK`, enabling coding-agent sessions to use Bedrock Converse without local SigV4 credentials ([#3125](https://github.com/badlogic/pi-mono/pull/3125) by [@wirjo](https://github.com/wirjo))

### Fixed

- Fixed `/scoped-models` Alt+Up/Down to stay a no-op in the implicit `all enabled` state instead of materializing a full explicit enabled-model list and marking the selector dirty ([#3331](https://github.com/badlogic/pi-mono/issues/3331))
