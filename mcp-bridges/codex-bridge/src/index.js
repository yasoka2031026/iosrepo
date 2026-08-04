#!/usr/bin/env node
// codex-bridge: MCP server that lets Claude Code delegate a subtask to the
// Codex CLI (ChatGPT's coding agent) and receive back only the compressed
// final result. The full Codex reasoning/tool-call transcript stays inside
// the Codex subprocess and never enters the calling model's context window.
import { spawn } from 'node:child_process';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const DEFAULT_TIMEOUT_MS = Number(process.env.CODEX_BRIDGE_TIMEOUT_MS || 15 * 60 * 1000);
const DEFAULT_SANDBOX = process.env.CODEX_BRIDGE_SANDBOX || 'workspace-write';

const ROLE_PREAMBLE = {
  executor:
    'You are acting as a delegated EXECUTOR sub-agent for another AI (Claude Code) that is ' +
    'running the primary session. Perform the task described below yourself, then reply with a ' +
    'concise final report only: what you changed/found, file paths touched, and anything the ' +
    'calling agent must know. Do not ask the user questions; make reasonable decisions and note ' +
    'any assumptions in the report.',
  reviewer:
    'You are acting as a delegated REVIEWER / MONITOR sub-agent for another AI (Claude Code) that ' +
    'is running the primary session. Do NOT make edits unless explicitly told to. Inspect what is ' +
    'described below and reply with a concise findings report only: issues found (ranked by ' +
    'severity), what looks correct, and concrete suggested fixes. If nothing is wrong, say so briefly.',
};

function buildArgs({ prompt, role, cwd, sandbox, model, extraArgs }) {
  const framedPrompt = `${ROLE_PREAMBLE[role]}\n\n---\n\n${prompt}`;
  const args = ['exec', '--json', '--sandbox', sandbox || DEFAULT_SANDBOX];
  if (cwd) args.push('--cd', cwd);
  if (model) args.push('--model', model);
  if (extraArgs) args.push(...extraArgs);
  args.push(framedPrompt);
  return args;
}

// `codex exec --json` streams JSONL events. We only care about the final
// agent message; everything else (reasoning, tool calls) is discarded here
// so the caller's context stays compressed to a single summary.
function extractFinalText(stdout) {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  let lastAgentMessage = null;
  for (const line of lines) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // not a JSON event line (e.g. stray log output)
    }
    const msg = evt?.msg ?? evt;
    const type = msg?.type;
    if (type === 'agent_message' && typeof msg.message === 'string') {
      lastAgentMessage = msg.message;
    } else if (type === 'task_complete' && typeof msg.last_agent_message === 'string') {
      lastAgentMessage = msg.last_agent_message;
    }
  }
  if (lastAgentMessage) return lastAgentMessage;
  // Fallback: --json not supported by this Codex CLI version, or no
  // structured agent_message event was found. Return raw stdout, trimmed.
  return stdout.trim() || '(codex produced no output)';
}

function runCodex({ prompt, role, cwd, sandbox, model, timeoutMs }) {
  return new Promise((resolve) => {
    const args = buildArgs({ prompt, role, cwd, sandbox, model });
    const child = spawn(CODEX_BIN, args, {
      cwd: cwd || process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs || DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `Failed to launch "${CODEX_BIN}": ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        resolve({
          ok: false,
          error: `codex exec exited with code ${code}.\n--- stderr ---\n${stderr.slice(-4000)}`,
        });
        return;
      }
      resolve({ ok: true, text: extractFinalText(stdout) });
    });
  });
}

const server = new McpServer({
  name: 'codex-bridge',
  version: '0.1.0',
});

server.registerTool(
  'delegate_to_codex',
  {
    title: 'Delegate to Codex CLI',
    description:
      'Hand off a self-contained subtask to the Codex CLI (ChatGPT/OpenAI coding agent) running ' +
      'non-interactively via `codex exec`, and get back only the compressed final report. Use this ' +
      'to offload work you want executed or reviewed by a second model without spending your own ' +
      'context window on its intermediate steps. Good for: independent second opinions/code review ' +
      '(role="reviewer"), or parallelizable implementation work (role="executor"). The prompt must ' +
      'be fully self-contained — the subprocess has no memory of this conversation.',
    inputSchema: {
      prompt: z.string().describe(
        'Full, self-contained instructions for Codex. Include all necessary context, file paths, ' +
        'and what kind of report to return.'
      ),
      role: z.enum(['executor', 'reviewer']).default('executor').describe(
        'executor: Codex may edit files/run commands and reports what it did. ' +
        'reviewer: Codex should only inspect and report findings, no edits.'
      ),
      cwd: z.string().optional().describe('Working directory for Codex (defaults to this server\'s cwd).'),
      sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional().describe(
        `Codex sandbox/approval mode (defaults to "${DEFAULT_SANDBOX}"; use "read-only" for role=reviewer).`
      ),
      model: z.string().optional().describe('Override the Codex model (defaults to the CLI\'s own default).'),
      timeoutSeconds: z.number().int().positive().optional().describe(
        `Max seconds to wait before killing the Codex subprocess (defaults to ${DEFAULT_TIMEOUT_MS / 1000}s).`
      ),
    },
  },
  async ({ prompt, role, cwd, sandbox, model, timeoutSeconds }) => {
    const effectiveSandbox = sandbox || (role === 'reviewer' ? 'read-only' : DEFAULT_SANDBOX);
    const result = await runCodex({
      prompt,
      role: role || 'executor',
      cwd,
      sandbox: effectiveSandbox,
      model,
      timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
    });

    if (!result.ok) {
      return { isError: true, content: [{ type: 'text', text: result.error }] };
    }
    return { content: [{ type: 'text', text: result.text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
