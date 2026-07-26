// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHtmlReport } from '../src/report.js';
import type { EvaluationReport } from '../src/types.js';

test('HTML report is self-contained, escapes model output, and states the claim boundary', () => {
  const report: EvaluationReport = {
    version: 'AFB-REPORT-v1', task_id: 'x', task_title: 'Task <One>', started_at: '2026-07-26T12:00:00.000Z',
    completed_at: '2026-07-26T12:00:01.000Z', spec_sha256: `sha256:${'1'.repeat(64)}`,
    runs: [{ target_id: 'unsafe', case_id: 'c', repetition: 0, status: 'COMPLETED', passed: false,
      critical: true, assertion_results: [], output: '<script>alert(1)</script>', latency_ms: 1, cost_usd: 0 }],
    targets: [{ target_id: 'unsafe', eligible: false, pass_rate: 0, wilson_low: 0, wilson_high: 0.7935,
      stability: 1, critical_failures: 1, completed_runs: 1, total_runs: 1, latency_p50_ms: 1,
      latency_p95_ms: 1, cost_usd: 0, gate_failures: ['critical_failure'] }],
    report_sha256: `sha256:${'2'.repeat(64)}`,
    claim_boundary: 'Task-specific observed performance; not a universal intelligence score.',
  };
  const html = renderHtmlReport(report);
  assert.match(html, /Task-specific observed performance/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /unsafe/);
});
