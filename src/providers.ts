// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import type { AgentProvider, ProviderInvocation, ProviderResult } from './types.js';

const MAX_PROVIDER_BYTES = 4 * 1024 * 1024;

function finiteNonnegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseProviderEnvelope(text: string, latencyMs: number): ProviderResult {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) {
    throw new TypeError(`provider emitted invalid JSON: ${(error as Error).message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('provider response must be a JSON object');
  }
  const object = value as Record<string, unknown>;
  if (typeof object.output !== 'string' || object.output.length > MAX_PROVIDER_BYTES) {
    throw new TypeError('provider output must be a bounded string');
  }
  const usage = object.usage && typeof object.usage === 'object' && !Array.isArray(object.usage)
    ? object.usage as Record<string, unknown> : {};
  const result: ProviderResult = {
    output: object.output,
    latency_ms: latencyMs,
    cost_usd: finiteNonnegative(object.cost_usd),
  };
  if (Number.isSafeInteger(usage.input_tokens) && (usage.input_tokens as number) >= 0) {
    result.input_tokens = usage.input_tokens as number;
  }
  if (Number.isSafeInteger(usage.output_tokens) && (usage.output_tokens as number) >= 0) {
    result.output_tokens = usage.output_tokens as number;
  }
  if (typeof object.provider_request_id === 'string') result.provider_request_id = object.provider_request_id;
  return result;
}

export interface CommandProviderConfig {
  id: string;
  executable: string;
  args?: string[];
  timeout_ms?: number;
  max_output_bytes?: number;
  estimated_cost_usd?: number;
  /** Environment variables explicitly forwarded to the child. Ambient secrets are not inherited. */
  env_names?: string[];
}

export function createCommandProvider(config: CommandProviderConfig): AgentProvider {
  if (!config.id || !config.executable) throw new TypeError('command provider requires id and executable');
  const args = config.args ?? [];
  const timeoutMs = config.timeout_ms ?? 120_000;
  const maxBytes = config.max_output_bytes ?? MAX_PROVIDER_BYTES;
  const envNames = config.env_names ?? [];
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new TypeError('invalid command timeout');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PROVIDER_BYTES) throw new TypeError('invalid command output limit');
  if (!Array.isArray(envNames) || new Set(envNames).size !== envNames.length
      || envNames.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    throw new TypeError('env_names must contain unique environment-variable names');
  }
  const childEnv: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', ...envNames]) {
    if (process.env[name] !== undefined) childEnv[name] = process.env[name];
  }
  return {
    id: config.id,
    estimateCostUsd: () => finiteNonnegative(config.estimated_cost_usd),
    invoke(invocation) {
      return new Promise((resolve, reject) => {
        const started = performance.now();
        const child = spawn(config.executable, args, {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: childEnv,
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let bytes = 0;
        let settled = false;
        const finish = (error?: Error, result?: ProviderResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error); else resolve(result as ProviderResult);
        };
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish(new Error(`command provider timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const collect = (target: Buffer[]) => (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            child.kill('SIGKILL');
            finish(new Error(`command provider exceeded ${maxBytes} output bytes`));
            return;
          }
          target.push(chunk);
        };
        child.stdout.on('data', collect(stdout));
        child.stderr.on('data', collect(stderr));
        child.on('error', (error) => finish(error));
        child.on('close', (code) => {
          if (settled) return;
          if (code !== 0) {
            finish(new Error(`command provider exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(0, 2_000)}`));
            return;
          }
          try {
            finish(undefined, parseProviderEnvelope(Buffer.concat(stdout).toString('utf8'), performance.now() - started));
          } catch (error) { finish(error as Error); }
        });
        child.stdin.end(`${JSON.stringify(invocation)}\n`);
      });
    },
  };
}

export interface OpenAICompatibleProviderConfig {
  id: string;
  model: string;
  base_url: string;
  api_key_env: string;
  timeout_ms?: number;
  max_output_bytes?: number;
  input_usd_per_million?: number;
  output_usd_per_million?: number;
  max_output_tokens: number;
  system_prompt?: string;
}

function safeEndpoint(raw: string): URL {
  const url = new URL(raw.endsWith('/') ? raw : `${raw}/`);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('OpenAI-compatible base_url must use HTTPS or loopback HTTP');
  }
  if (url.username || url.password) throw new TypeError('base_url credentials are forbidden');
  return url;
}

export function createOpenAICompatibleProvider(config: OpenAICompatibleProviderConfig): AgentProvider {
  if (!config.id || !config.model || !config.api_key_env) {
    throw new TypeError('OpenAI-compatible provider requires id, model, and api_key_env');
  }
  const endpoint = new URL('chat/completions', safeEndpoint(config.base_url));
  const apiKey = process.env[config.api_key_env];
  if (!apiKey) throw new TypeError(`environment variable ${config.api_key_env} is required`);
  const timeoutMs = config.timeout_ms ?? 120_000;
  const maxBytes = config.max_output_bytes ?? MAX_PROVIDER_BYTES;
  const inputRate = finiteNonnegative(config.input_usd_per_million);
  const outputRate = finiteNonnegative(config.output_usd_per_million);
  if (!Number.isSafeInteger(config.max_output_tokens) || config.max_output_tokens < 1 || config.max_output_tokens > 1_000_000) {
    throw new TypeError('max_output_tokens must be a positive integer');
  }
  return {
    id: config.id,
    estimateCostUsd(invocation) {
      const inputBytes = Buffer.byteLength(`${config.system_prompt ?? ''}\n${invocation.prompt}`, 'utf8');
      const conservativeInputTokens = inputBytes + 1_024;
      return (conservativeInputTokens * inputRate + config.max_output_tokens * outputRate) / 1_000_000;
    },
    async invoke(invocation: ProviderInvocation): Promise<ProviderResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const started = performance.now();
      try {
        const messages = [];
        if (config.system_prompt) messages.push({ role: 'system', content: config.system_prompt });
        messages.push({ role: 'user', content: invocation.prompt });
        const response = await fetch(endpoint, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: config.model, messages, stream: false, max_tokens: config.max_output_tokens }),
        });
        const text = await response.text();
        if (text.length > maxBytes) throw new Error(`provider response exceeded ${maxBytes} bytes`);
        if (!response.ok) throw new Error(`provider HTTP ${response.status}: ${text.slice(0, 1_000)}`);
        const payload = JSON.parse(text) as Record<string, any>;
        const output = payload.choices?.[0]?.message?.content;
        if (typeof output !== 'string') throw new TypeError('provider response has no text content');
        const inputTokens = finiteNonnegative(payload.usage?.prompt_tokens);
        const outputTokens = finiteNonnegative(payload.usage?.completion_tokens);
        return {
          output, latency_ms: performance.now() - started,
          input_tokens: inputTokens, output_tokens: outputTokens,
          cost_usd: (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000,
          ...(typeof payload.id === 'string' ? { provider_request_id: payload.id } : {}),
        };
      } finally { clearTimeout(timeout); }
    },
  };
}
