# codex-bridge

MCP server that lets **Claude Code** delegate a subtask to the **Codex CLI**
(ChatGPT/OpenAI's coding agent) and get back only the compressed final
result. Codex's full reasoning/tool-call transcript stays inside the
subprocess — only the final report enters Claude's context window.

## Requirements

- A machine where the [Codex CLI](https://github.com/openai/codex) is
  installed and logged in (`codex` on `PATH`, or point `CODEX_BIN` at its
  binary). This means **local use only** — Claude Code Desktop app or
  terminal on your own machine. It will not work from Cowork / Claude Code
  on the web, since that runs in a cloud container with no access to your
  machine's Codex CLI login session — use
  [`openai-bridge`](../openai-bridge) there instead.
- Node.js >= 18

## Install

```bash
cd mcp-bridges/codex-bridge
npm install
```

## Register with Claude Code

This repo's root [`.mcp.json`](../../.mcp.json) already registers
`codex-bridge` as a project-scoped server. Claude Code reads the same
`.mcp.json` regardless of which surface opens the project — terminal,
**Desktop app**, or web — so nothing extra is needed for the Desktop app
specifically. The first time it's used in a session you'll get a one-time
approval prompt (project-scoped servers require explicit approval).

To register it in a different project, either add the same block to that
project's `.mcp.json`, or run this once from a terminal (it just edits the
JSON file for you — you don't need to keep using the terminal afterward):

```bash
claude mcp add codex-bridge -- node /absolute/path/to/mcp-bridges/codex-bridge/src/index.js
```

Once registered, Claude Code gains a `delegate_to_codex` tool. Ask Claude to
"delegate X to Codex" or "get a second opinion from Codex on this diff" and
it will call the tool itself — from the Desktop app UI this looks like any
other tool-call permission prompt.

## Tool: `delegate_to_codex`

| Arg | Description |
|---|---|
| `prompt` (required) | Self-contained task description. The subprocess has no memory of the calling conversation. |
| `role` | `executor` (default, may edit files) or `reviewer` (read-only, findings report only). |
| `cwd` | Working directory for Codex. |
| `sandbox` | `read-only` \| `workspace-write` \| `danger-full-access` (defaults to `read-only` for `reviewer`, `workspace-write` otherwise). |
| `model` | Override Codex model. |
| `timeoutSeconds` | Kill the subprocess after N seconds (default 900). |

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `CODEX_BIN` | `codex` | Path to the Codex CLI binary. |
| `CODEX_BRIDGE_SANDBOX` | `workspace-write` | Default `--sandbox` mode. |
| `CODEX_BRIDGE_TIMEOUT_MS` | `900000` | Default subprocess timeout. |

## How it works

The server runs `codex exec --json --sandbox <mode> [--cd <dir>] "<framed prompt>"`
and parses the JSONL event stream for the final `agent_message` /
`task_complete` event, discarding everything else. If your installed Codex
CLI version doesn't emit those events, it falls back to raw stdout.

> Codex CLI flags occasionally change between versions — if `codex exec
> --json` behaves differently for you, adjust `buildArgs`/`extractFinalText`
> in `src/index.js` accordingly.
