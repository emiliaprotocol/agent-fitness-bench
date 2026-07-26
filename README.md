# Agent Fitness Bench

Choose the right AI agent for a real job by testing the exact behavior that job requires.

Agent Fitness Bench is a local-first, open-source benchmark compiler and runner. It turns a task definition into repeatable cases, runs one or more agent/model targets under an explicit spending ceiling, and produces a self-contained **TaskFit Report** covering:

- task correctness and critical failures;
- repeat-run stability;
- p50/p95 latency;
- token use and measured cost;
- deterministic pass/fail assertions; and
- hard eligibility gates for critical failures and budget overruns.

It does **not** assign a universal IQ, personality, safety, or deployment-readiness score. Results apply only to the exact task, cases, provider settings, and run environment recorded in the report.

## Try the zero-cost demo

```sh
npm install
npm run demo
open output/demo/taskfit-report.html
```

The demo compares a bounded agent with a reckless agent across valid authority, scope escalation, missing evidence, indeterminate outcomes, and prompt injection. It makes no network calls.

## Evaluate your own targets

1. Define a task source (`AFB-TASK-SOURCE-v1`) with expected and forbidden output fragments.
2. Compile it to a pinned evaluation specification.
3. Configure command-line or OpenAI-compatible targets.
4. Run repetitions under a per-target dollar ceiling.

```sh
npx agent-fitness compile examples/consequence-agent.task.json --output output/spec.json
npx agent-fitness run output/spec.json --targets examples/targets.example.json --output output/run
```

### Target adapters

`command` launches an exact executable and argument array with `shell: false`. It does not inherit ambient environment variables; list any required names explicitly in `env_names`. It sends `{prompt, case_id, repetition}` as JSON on standard input and expects:

```json
{
  "output": "REFUSE: missing authority",
  "usage": { "input_tokens": 20, "output_tokens": 5 },
  "cost_usd": 0.0001
}
```

`openai-compatible` calls `/chat/completions`. API key **values never belong in configuration**; name an environment variable instead. Remote endpoints must use HTTPS. Loopback HTTP is allowed for local inference. Configure `max_output_tokens` and current per-million-token rates so the runner can reserve a conservative upper bound before every paid call.

## Why task fitness, not “agent IQ”

Models vary by tool use, instruction hierarchy, uncertainty handling, cost, latency, context, and the exact work being done. Collapsing those dimensions into one human-style intelligence label creates false precision. This tool instead answers the commercial question:

> Which target performs this task reliably, within budget, without failing the cases I marked critical?

## Security posture

- local-first and BYO-key;
- no telemetry, hosted account, or key storage;
- strict spending ceilings before estimated paid calls;
- bounded provider output and timeouts;
- no shell execution for command adapters;
- HTTPS required for remote model endpoints;
- HTML-escaped model output; and
- canonical SHA-256 bindings over specifications and reports.

See [SECURITY.md](SECURITY.md) for reporting and deployment boundaries.

## License

Apache-2.0.
