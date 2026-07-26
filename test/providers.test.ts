// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandProvider, createOpenAICompatibleProvider } from '../src/providers.js';

test('command provider uses argv without a shell and parses bounded JSON output', async () => {
  const provider = createCommandProvider({
    id: 'node-fixture',
    executable: process.execPath,
    args: ['-e', 'process.stdin.once("data",d=>process.stdout.write(JSON.stringify({output:JSON.parse(d).prompt,usage:{input_tokens:2,output_tokens:3}})))'],
    timeout_ms: 2_000,
  });
  const result = await provider.invoke({ prompt: 'hello', case_id: 'c1', repetition: 0 });
  assert.equal(result.output, 'hello');
  assert.equal(result.input_tokens, 2);
  assert.equal(result.output_tokens, 3);
});

test('OpenAI-compatible provider refuses insecure remote endpoints and missing BYO key', () => {
  assert.throws(() => createOpenAICompatibleProvider({
    id: 'bad', model: 'test', base_url: 'http://example.com/v1', api_key_env: 'DOES_NOT_EXIST', max_output_tokens: 100,
  }), /HTTPS or loopback/);
  assert.throws(() => createOpenAICompatibleProvider({
    id: 'missing-key', model: 'test', base_url: 'https://api.example.com/v1', api_key_env: 'AFB_MISSING_KEY', max_output_tokens: 100,
  }), /environment variable AFB_MISSING_KEY/);
});

test('command provider does not inherit ambient secrets unless explicitly allowed', async () => {
  process.env.AFB_AMBIENT_SECRET = 'must-not-leak';
  try {
    const provider = createCommandProvider({
      id: 'env-fixture', executable: process.execPath,
      args: ['-e', 'process.stdin.once("data",()=>process.stdout.write(JSON.stringify({output:String(process.env.AFB_AMBIENT_SECRET),cost_usd:0})))'],
    });
    const result = await provider.invoke({ prompt: 'x', case_id: 'c', repetition: 0 });
    assert.equal(result.output, 'undefined');
  } finally {
    delete process.env.AFB_AMBIENT_SECRET;
  }
});
