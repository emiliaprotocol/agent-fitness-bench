// SPDX-License-Identifier: Apache-2.0

export const TASK_SOURCE_VERSION = 'AFB-TASK-SOURCE-v1' as const;
export const EVAL_SPEC_VERSION = 'AFB-EVAL-SPEC-v1' as const;
export const REPORT_VERSION = 'AFB-REPORT-v1' as const;

export type Assertion =
  | { kind: 'contains'; value: string; case_sensitive: boolean }
  | { kind: 'not_contains'; value: string; case_sensitive: boolean }
  | { kind: 'matches'; value: string; flags: string };

export interface TaskSourceCase {
  id: string;
  input: string;
  expected_fragments: string[];
  forbidden_fragments: string[];
  critical: boolean;
  tags: string[];
}

export interface TaskSource {
  version: typeof TASK_SOURCE_VERSION;
  id: string;
  title: string;
  goal: string;
  success_criteria: string[];
  prohibited_behaviors: string[];
  repetitions: number;
  budget_usd: number;
  max_latency_ms?: number;
  cases: TaskSourceCase[];
}

export interface EvalCase {
  id: string;
  prompt: string;
  assertions: Assertion[];
  critical: boolean;
  tags: string[];
}

export interface EvalSpec {
  version: typeof EVAL_SPEC_VERSION;
  id: string;
  title: string;
  goal: string;
  success_criteria: string[];
  prohibited_behaviors: string[];
  repetitions: number;
  budget_usd: number;
  max_latency_ms: number;
  cases: EvalCase[];
  scoring: {
    method: 'deterministic_assertions';
    gates: ['no_critical_failures', 'budget_not_exceeded'];
  };
  provenance: {
    source_sha256: string;
    compiled_at: null;
  };
}

export interface ProviderInvocation {
  prompt: string;
  case_id: string;
  repetition: number;
}

export interface ProviderResult {
  output: string;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd: number;
  provider_request_id?: string;
}

export interface AgentProvider {
  readonly id: string;
  /** Conservative upper bound used before the call. Paid providers must not understate it. */
  estimateCostUsd(invocation: ProviderInvocation): number;
  invoke(invocation: ProviderInvocation): Promise<ProviderResult>;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  detail: string;
}

export interface RunRecord {
  target_id: string;
  case_id: string;
  repetition: number;
  status: 'COMPLETED' | 'ERROR' | 'BUDGET_REFUSED' | 'COST_BOUND_VIOLATION';
  passed: boolean;
  critical: boolean;
  assertion_results: AssertionResult[];
  output: string;
  latency_ms: number;
  cost_usd: number;
  input_tokens?: number;
  output_tokens?: number;
  error?: string;
}

export interface TargetSummary {
  target_id: string;
  eligible: boolean;
  pass_rate: number;
  wilson_low: number;
  wilson_high: number;
  stability: number;
  critical_failures: number;
  completed_runs: number;
  total_runs: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  cost_usd: number;
  gate_failures: string[];
}

export interface EvaluationReport {
  version: typeof REPORT_VERSION;
  task_id: string;
  task_title: string;
  started_at: string;
  completed_at: string;
  spec_sha256: string;
  runs: RunRecord[];
  targets: TargetSummary[];
  report_sha256: string;
  claim_boundary: string;
}
