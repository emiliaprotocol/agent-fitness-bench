// SPDX-License-Identifier: Apache-2.0
import { sha256 } from './canonical.js';
import { scoreOutput } from './scorer.js';
import {
  REPORT_VERSION,
  type AgentProvider,
  type EvalSpec,
  type EvaluationReport,
  type RunRecord,
  type TargetSummary,
} from './types.js';

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return round(sorted[index] ?? 0, 3);
}

function wilson(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 0];
  const z = 1.959963984540054;
  const phat = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (phat + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total) / denominator;
  return [round(Math.max(0, center - margin), 4), round(Math.min(1, center + margin), 4)];
}

function stability(records: RunRecord[]): number {
  const groups = new Map<string, boolean[]>();
  for (const record of records) {
    if (record.status !== 'COMPLETED') continue;
    const outcomes = groups.get(record.case_id) ?? [];
    outcomes.push(record.passed);
    groups.set(record.case_id, outcomes);
  }
  if (groups.size === 0) return 0;
  const scores = [...groups.values()].map((outcomes) => {
    const passes = outcomes.filter(Boolean).length;
    return Math.max(passes, outcomes.length - passes) / outcomes.length;
  });
  return round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 4);
}

function summarize(targetId: string, records: RunRecord[], budgetUsd: number): TargetSummary {
  const completed = records.filter((record) => record.status === 'COMPLETED');
  const passed = completed.filter((record) => record.passed).length;
  const criticalFailures = completed.filter((record) => record.critical && !record.passed).length;
  const costUsd = round(records.reduce((sum, record) => sum + record.cost_usd, 0));
  const gateFailures: string[] = [];
  if (criticalFailures > 0) gateFailures.push('critical_failure');
  if (records.some((record) => record.status === 'BUDGET_REFUSED') || costUsd > budgetUsd) {
    gateFailures.push('budget_exceeded');
  }
  if (records.some((record) => record.status === 'ERROR')) gateFailures.push('provider_error');
  if (records.some((record) => record.status === 'COST_BOUND_VIOLATION')) gateFailures.push('cost_bound_violation');
  const [wilsonLow, wilsonHigh] = wilson(passed, completed.length);
  return {
    target_id: targetId,
    eligible: gateFailures.length === 0,
    pass_rate: completed.length === 0 ? 0 : round(passed / completed.length, 4),
    wilson_low: wilsonLow,
    wilson_high: wilsonHigh,
    stability: stability(records),
    critical_failures: criticalFailures,
    completed_runs: completed.length,
    total_runs: records.length,
    latency_p50_ms: percentile(completed.map((record) => record.latency_ms), 0.5),
    latency_p95_ms: percentile(completed.map((record) => record.latency_ms), 0.95),
    cost_usd: costUsd,
    gate_failures: gateFailures,
  };
}

export interface RunEvaluationOptions {
  started_at?: string;
}

export async function runEvaluation(
  spec: EvalSpec,
  providers: readonly AgentProvider[],
  options: RunEvaluationOptions = {},
): Promise<EvaluationReport> {
  if (providers.length === 0) throw new TypeError('at least one provider is required');
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
    throw new TypeError('provider ids must be unique');
  }
  const startedAt = options.started_at ?? new Date().toISOString();
  const runs: RunRecord[] = [];
  for (const provider of providers) {
    let accrued = 0;
    for (const evalCase of spec.cases) {
      for (let repetition = 0; repetition < spec.repetitions; repetition += 1) {
        const invocation = { prompt: evalCase.prompt, case_id: evalCase.id, repetition };
        const estimate = provider.estimateCostUsd(invocation);
        if (!Number.isFinite(estimate) || estimate < 0) {
          throw new TypeError(`provider ${provider.id} returned an invalid cost upper bound`);
        }
        if (accrued + estimate > spec.budget_usd) {
          runs.push({
            target_id: provider.id, case_id: evalCase.id, repetition,
            status: 'BUDGET_REFUSED', passed: false, critical: evalCase.critical,
            assertion_results: [], output: '', latency_ms: 0, cost_usd: 0,
            error: `estimated call cost ${round(estimate)} would exceed target budget ${spec.budget_usd}`,
          });
          continue;
        }
        try {
          const result = await provider.invoke(invocation);
          if (!Number.isFinite(result.cost_usd) || result.cost_usd < 0) {
            throw new TypeError(`provider ${provider.id} returned an invalid measured cost`);
          }
          const assertionResults = scoreOutput(result.output, evalCase.assertions);
          const latencyPassed = result.latency_ms <= spec.max_latency_ms;
          const passed = assertionResults.every((assertion) => assertion.passed) && latencyPassed;
          accrued = round(accrued + result.cost_usd);
          const costBoundViolated = result.cost_usd > estimate + 0.000000001;
          runs.push({
            target_id: provider.id, case_id: evalCase.id, repetition,
            status: costBoundViolated ? 'COST_BOUND_VIOLATION' : 'COMPLETED',
            passed: costBoundViolated ? false : passed, critical: evalCase.critical,
            assertion_results: assertionResults,
            output: result.output,
            latency_ms: round(result.latency_ms, 3),
            cost_usd: round(result.cost_usd),
            ...(result.input_tokens === undefined ? {} : { input_tokens: result.input_tokens }),
            ...(result.output_tokens === undefined ? {} : { output_tokens: result.output_tokens }),
            ...(costBoundViolated ? { error: `measured cost ${round(result.cost_usd)} exceeded declared upper bound ${round(estimate)}` } : {}),
          });
        } catch (error) {
          runs.push({
            target_id: provider.id, case_id: evalCase.id, repetition,
            status: 'ERROR', passed: false, critical: evalCase.critical,
            assertion_results: [], output: '', latency_ms: 0, cost_usd: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
  const targets = providers.map((provider) => (
    summarize(provider.id, runs.filter((record) => record.target_id === provider.id), spec.budget_usd)
  )).sort((left, right) => (
    Number(right.eligible) - Number(left.eligible)
    || right.pass_rate - left.pass_rate
    || right.stability - left.stability
    || left.cost_usd - right.cost_usd
    || left.target_id.localeCompare(right.target_id)
  ));
  const unsigned = {
    version: REPORT_VERSION,
    task_id: spec.id,
    task_title: spec.title,
    started_at: startedAt,
    completed_at: options.started_at ?? new Date().toISOString(),
    spec_sha256: sha256(spec),
    runs,
    targets,
    claim_boundary: 'Task-specific observed performance under this exact suite and environment; not a universal intelligence, personality, safety, or deployment-readiness score.',
  };
  return { ...unsigned, report_sha256: sha256(unsigned) };
}
