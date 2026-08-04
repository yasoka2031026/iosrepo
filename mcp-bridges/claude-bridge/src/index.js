#!/usr/bin/env node
// claude-bridge: MCP server that lets Codex CLI (or any other MCP host)
// delegate a subtask to Claude Code and receive back only the compressed
// final result. The full Claude Code turn-by-turn transcript stays inside
// the `claude -p` subprocess and never enters the calling model's context.
import { spawn } from 'node:child_process';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const DEFAULT_TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS || 15 * 60 * 1000);
const DEFAULT_PERMISSION_MODE = process.env.CLAUDE_BRIDGE_PERMISSION_MODE || 'acceptEdits';

const ROLE_PREAMBLE = {
  executor:
    'You are acting as a delegated EXECUTOR sub-agent for another AI (Codex) that is running the ' +
    'primary session. Perform the task described below yourself, then reply with a concise final ' +
    'report only: what you changed/found, file paths touched, and anything the calling agent must ' +
    'know. Do not ask the user questions; make reasonable decisions and note any assumptions in the ' +
    'report.',
  reviewer:
    'You are acting as a delegated REVIEWER / MONITOR sub-agent for another AI (Codex) that is ' +
    'running the primary session. Do NOT make edits unless explicitly told to. Inspect what is ' +
    'described below and reply with a concise findings report only: issues found (ranked by ' +
    'severity), what looks correct, and concrete suggested fixes. If nothing is wrong, say so briefly.',
};

function buildArgs({ prompt, role, model, permissionMode }) {
  const framedPrompt = `${ROLE_PREAMBLE[role]}\n\n---\n\n${prompt}`;
  const args = ['-p', framedPrompt, '--output-format', 'json', '--permission-mode', permissionMode];
  if (model) args.push('--model', model);
  return args;
}

function runClaude({ prompt, role, cwd, model, permissionMode, timeoutMs }) {
  return new Promise((resolve) => {
    const args = buildArgs({ prompt, role, model, permissionMode });
    const child = spawn(CLAUDE_BIN, args, {
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
      resolve({ ok: false, error: `Failed to launch "${CLAUDE_BIN}": ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        resolve({
          ok: false,
          error: `claude -p exited with code ${code}.\n--- stderr ---\n${stderr.slice(-4000)}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) {
          resolve({ ok: false, error: `Claude reported an error: ${parsed.result ?? '(no message)'}` });
          return;
        }
        resolve({ ok: true, text: typeof parsed.result === 'string' ? parsed.result : stdout.trim() });
      } catch {
        // --output-format json not supported by this Claude Code version;
        // fall back to raw stdout (text mode).
        resolve({ ok: true, text: stdout.trim() || '(claude produced no output)' });
      }
    });
  });
}

const server = new McpServer({
  name: 'claude-bridge',
  version: '0.1.0',
});

server.registerTool(
  'delegate_to_claude',
  {
    title: 'Delegate to Claude Code',
    description:
      'Hand off a self-contained subtask to Claude Code running non-interactively via `claude -p`, ' +
      'and get back only the compressed final report. Use this to offload work you want executed or ' +
      'reviewed by a second model without spending your own context window on its intermediate ' +
      'steps. Good for: independent second opinions/code review (role="reviewer"), or parallelizable ' +
      'implementation work (role="executor"). The prompt must be fully self-contained — the ' +
      'subprocess has no memory of this conversation.',
    inputSchema: {
      prompt: z.string().describe(
        'Full, self-contained instructions for Claude. Include all necessary context, file paths, ' +
        'and what kind of report to return.'
      ),
      role: z.enum(['executor', 'reviewer']).default('executor').describe(
        'executor: Claude may edit files/run commands and reports what it did. ' +
        'reviewer: Claude should only inspect and report findings, no edits.'
      ),
      cwd: z.string().optional().describe('Working directory for Claude Code (defaults to this server\'s cwd).'),
      permissionMode: z.enum(['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']).optional()
        .describe(
          `Claude Code --permission-mode (defaults to "${DEFAULT_PERMISSION_MODE}"; use "plan" or ` +
          '"manual" for role=reviewer to guarantee no edits happen).'
        ),
      model: z.string().optional().describe('Override the Claude model (defaults to the CLI\'s own default).'),
      timeoutSeconds: z.number().int().positive().optional().describe(
        `Max seconds to wait before killing the Claude subprocess (defaults to ${DEFAULT_TIMEOUT_MS / 1000}s).`
      ),
    },
  },
  async ({ prompt, role, cwd, permissionMode, model, timeoutSeconds }) => {
    const effectivePermissionMode =
      permissionMode || (role === 'reviewer' ? 'plan' : DEFAULT_PERMISSION_MODE);
    const result = await runClaude({
      prompt,
      role: role || 'executor',
      cwd,
      model,
      permissionMode: effectivePermissionMode,
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
