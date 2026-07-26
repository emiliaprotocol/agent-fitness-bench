# Security policy

Report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include live API keys, model outputs containing personal data, or proprietary evaluation cases in an issue.

Agent Fitness Bench is a local evaluation tool, not a sandbox. A configured command target is executable code chosen by the operator and runs with the operator's OS permissions. Ambient environment variables are not inherited; only `env_names` are forwarded. Run untrusted targets inside a container or VM with explicit network, filesystem, process, and spending limits.

The OpenAI-compatible adapter sends prompts to the exact endpoint configured by the operator and reads the API key from the named environment variable. Review that endpoint before supplying credentials.

Pre-call spending controls rely on each adapter's declared conservative upper bound. The built-in OpenAI-compatible adapter derives that bound from configured maximum output tokens and price rates. The report gates any provider whose measured cost exceeds its declared bound, but it cannot reverse a charge already imposed by a dishonest or misconfigured third-party adapter.
