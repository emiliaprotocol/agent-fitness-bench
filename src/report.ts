// SPDX-License-Identifier: Apache-2.0
import type { EvaluationReport } from './types.js';

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }

export function renderHtmlReport(report: EvaluationReport): string {
  const targetRows = report.targets.map((target, index) => `
    <tr>
      <td><span class="rank">${index + 1}</span> ${escapeHtml(target.target_id)}</td>
      <td><span class="pill ${target.eligible ? 'pass' : 'fail'}">${target.eligible ? 'ELIGIBLE' : 'GATED'}</span></td>
      <td>${pct(target.pass_rate)} <small>${pct(target.wilson_low)}–${pct(target.wilson_high)}</small></td>
      <td>${pct(target.stability)}</td><td>${target.critical_failures}</td>
      <td>${target.latency_p50_ms.toFixed(1)} / ${target.latency_p95_ms.toFixed(1)} ms</td>
      <td>$${target.cost_usd.toFixed(4)}</td>
      <td>${escapeHtml(target.gate_failures.join(', ') || 'none')}</td>
    </tr>`).join('');
  const failureCards = report.runs.filter((run) => !run.passed).slice(0, 100).map((run) => `
    <article><header>${escapeHtml(run.target_id)} · ${escapeHtml(run.case_id)} · run ${run.repetition + 1}</header>
      <div class="meta">${escapeHtml(run.status)}${run.critical ? ' · CRITICAL' : ''}</div>
      <pre>${escapeHtml(run.error || run.output || '(no output)')}</pre>
    </article>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.task_title)} · Agent Fitness Bench</title>
<style>
:root{color-scheme:dark;--bg:#07100e;--panel:#0d1916;--line:#20342e;--ink:#effff9;--muted:#9db4ac;--green:#4af0ad;--red:#ff7c8d;--cyan:#57dff5}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#123126 0,transparent 35%),var(--bg);color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui;padding:40px}
main{max-width:1200px;margin:auto}.eyebrow{color:var(--green);font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(34px,6vw,68px);line-height:1;margin:.25em 0}.boundary{max-width:850px;color:var(--muted);font-size:17px}.hash{word-break:break-all;font:12px ui-monospace;color:#78958b}
.card,article{background:linear-gradient(145deg,#10201b,#0a1411);border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 60px #0005}section{margin-top:34px}.card{overflow:auto}table{width:100%;border-collapse:collapse;min-width:930px}th,td{padding:16px;text-align:left;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}small{display:block;color:var(--muted)}.rank{display:inline-grid;place-items:center;width:28px;height:28px;border:1px solid var(--line);border-radius:50%;margin-right:8px}.pill{font-size:11px;font-weight:900;padding:5px 8px;border-radius:99px}.pass{color:#04120d;background:var(--green)}.fail{color:#21050a;background:var(--red)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}article{padding:18px;min-width:0}article header{font-weight:800}.meta{color:var(--red);font-size:12px;margin:6px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#cce5dc;background:#050a08;padding:12px;border-radius:10px;max-height:240px;overflow:auto}@media(max-width:600px){body{padding:22px 14px}}
</style></head><body><main>
<div class="eyebrow">Agent Fitness Bench · TaskFit Report</div><h1>${escapeHtml(report.task_title)}</h1>
<p class="boundary">${escapeHtml(report.claim_boundary)}</p>
<p class="hash">Task ${escapeHtml(report.task_id)} · ${escapeHtml(report.started_at)} · ${escapeHtml(report.report_sha256)}</p>
<section><h2>Task-specific ranking</h2><div class="card"><table><thead><tr><th>Target</th><th>Gate</th><th>Pass rate (95% CI)</th><th>Stability</th><th>Critical</th><th>p50 / p95</th><th>Cost</th><th>Gate failures</th></tr></thead><tbody>${targetRows}</tbody></table></div></section>
<section><h2>Failures and refusals</h2><div class="grid">${failureCards || '<article>No failures recorded.</article>'}</div></section>
</main></body></html>`;
}
