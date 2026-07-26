// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { sha256 } from './canonical.js';
import {
  EVAL_SPEC_VERSION,
  TASK_SOURCE_VERSION,
  type EvalSpec,
  type TaskSource,
} from './types.js';

const boundedText = z.string().trim().min(1).max(32_768);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const sourceSchema = z.strictObject({
  version: z.literal(TASK_SOURCE_VERSION),
  id: identifier,
  title: boundedText.max(256),
  goal: boundedText,
  success_criteria: z.array(boundedText.max(1_024)).min(1).max(100),
  prohibited_behaviors: z.array(boundedText.max(1_024)).max(100),
  repetitions: z.number().int().min(1).max(100),
  budget_usd: z.number().finite().min(0).max(100_000),
  max_latency_ms: z.number().int().min(1).max(3_600_000).optional(),
  cases: z.array(z.strictObject({
    id: identifier,
    input: boundedText,
    expected_fragments: z.array(boundedText.max(4_096)).max(100),
    forbidden_fragments: z.array(boundedText.max(4_096)).max(100),
    critical: z.boolean(),
    tags: z.array(identifier).max(50),
  })).min(1).max(10_000),
});

const assertionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('contains'), value: boundedText.max(4_096), case_sensitive: z.boolean() }),
  z.strictObject({ kind: z.literal('not_contains'), value: boundedText.max(4_096), case_sensitive: z.boolean() }),
  z.strictObject({ kind: z.literal('matches'), value: boundedText.max(4_096), flags: z.string().regex(/^[dgimsuvy]*$/) }),
]);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const evalSchema = z.strictObject({
  version: z.literal(EVAL_SPEC_VERSION), id: identifier, title: boundedText.max(256), goal: boundedText,
  success_criteria: z.array(boundedText.max(1_024)).min(1).max(100),
  prohibited_behaviors: z.array(boundedText.max(1_024)).max(100),
  repetitions: z.number().int().min(1).max(100), budget_usd: z.number().finite().min(0).max(100_000),
  max_latency_ms: z.number().int().min(1).max(3_600_000),
  cases: z.array(z.strictObject({ id: identifier, prompt: boundedText, assertions: z.array(assertionSchema).min(1).max(200), critical: z.boolean(), tags: z.array(identifier).max(50) })).min(1).max(10_000),
  scoring: z.strictObject({ method: z.literal('deterministic_assertions'), gates: z.tuple([z.literal('no_critical_failures'), z.literal('budget_not_exceeded')]) }),
  provenance: z.strictObject({ source_sha256: digest, compiled_at: z.null() }),
});

export function parseTaskSource(value: unknown): TaskSource {
  return sourceSchema.parse(value) as TaskSource;
}

export function parseEvalSpec(value: unknown): EvalSpec {
  const spec = evalSchema.parse(value) as EvalSpec;
  if (new Set(spec.cases.map((item) => item.id)).size !== spec.cases.length) {
    throw new TypeError('eval spec case ids must be unique');
  }
  return spec;
}

export function compileTask(value: unknown): EvalSpec {
  const source = parseTaskSource(value);
  const seen = new Set<string>();
  for (const item of source.cases) {
    if (seen.has(item.id)) throw new TypeError(`duplicate case id: ${item.id}`);
    seen.add(item.id);
    if (item.expected_fragments.length + item.forbidden_fragments.length === 0) {
      throw new TypeError(`case ${item.id} has no executable assertions`);
    }
  }
  return {
    version: EVAL_SPEC_VERSION,
    id: source.id,
    title: source.title,
    goal: source.goal,
    success_criteria: [...source.success_criteria],
    prohibited_behaviors: [...source.prohibited_behaviors],
    repetitions: source.repetitions,
    budget_usd: source.budget_usd,
    max_latency_ms: source.max_latency_ms ?? 120_000,
    cases: source.cases.map((item) => ({
      id: item.id,
      prompt: item.input,
      assertions: [
        ...item.expected_fragments.map((fragment) => ({
          kind: 'contains' as const, value: fragment, case_sensitive: false,
        })),
        ...item.forbidden_fragments.map((fragment) => ({
          kind: 'not_contains' as const, value: fragment, case_sensitive: false,
        })),
      ],
      critical: item.critical,
      tags: [...new Set(item.tags)].sort(),
    })),
    scoring: {
      method: 'deterministic_assertions',
      gates: ['no_critical_failures', 'budget_not_exceeded'],
    },
    provenance: { source_sha256: sha256(source), compiled_at: null },
  };
}
