# ChatGPT plan provider

OpenPA Eval can use an eligible ChatGPT account for the frontier generative model through OpenAI's documented Sign in with ChatGPT flow. The other providers remain optional and separate. Requests consume the user's ChatGPT plan allowance or credits; this is not unlimited or free API access.

## Connect locally

Build the packages, then start the evaluator and web app in separate terminals:

```bash
npm run build
```

```bash
npm run serve
```

```bash
npm run dev
```

Open the web app, select **ChatGPT · use your plan** under **Frontier model provider**, and click **Continue with ChatGPT**. Complete authorization in your browser. When you return, acknowledge plan usage, choose a model and reasoning effort, and click **Use for frontier**. The account-specific model list comes from OpenAI, rather than a hard-coded entitlement list. An unsupported reasoning effort produces a provider error; the harness never substitutes another model or effort.

In the Interactive Workbench select **Local evaluator — live providers** and **Frontier Generative Baseline**. This baseline needs only the selected frontier provider. The full cascade still needs Jev and a small-model provider configured separately.

The chosen provider/model/effort persist locally and are shared by the server and experiment CLI. Select **OpenRouter · API billing** and save to switch back to the environment-configured API provider. Signing in alone does not select a provider or send inference requests.

## Compare models and reasoning effort

After connecting and saving ChatGPT as the frontier provider, run a frontier-only paired experiment. These model IDs are examples: use IDs shown by your account's model selector.

```bash
npm run experiment -- --live --arms rules,llm --frontier-model gpt-6-luna --reasoning-effort low --max-calls 100 --max-tokens 1000000 --output results/luna-low.json
```

```bash
npm run experiment -- --live --arms rules,llm --frontier-model gpt-6.1-sol --reasoning-effort xhigh --max-calls 100 --max-tokens 1000000 --baseline results/luna-low.json --output results/sol-xhigh.json
```

The baseline comparison treats Luna low as the baseline and Sol extra high as the candidate. It reports safety/coverage regressions, not statistical equivalence. Repeat independent acquisitions before claiming comparable performance. Model and effort are saved in configuration, evaluator cache identities, and per-step traces. The report records the provider-returned model ID as well.

Use `--output results/experiment-report.json` to show a run using **Load latest experiment**. `--env-provider` ignores saved UI selection and uses `.env` instead. Environment configuration:

```dotenv
FRONTIER_LLM_PROVIDER=chatgpt-plan
FRONTIER_LLM_MODEL=gpt-6-luna
FRONTIER_LLM_REASONING_EFFORT=low
FRONTIER_LLM_MAX_INPUT_TOKENS=16000
FRONTIER_LLM_MAX_OUTPUT_TOKENS=8192
CASE_TIMEOUT_MS=120000
CHATGPT_AUTH_DIR=.chatgpt
```

## Usage and billing

The adapter uses `POST https://api.openai.com/v1/responses`, `store: false`, `stream: true`, developer instructions, and `reasoning.effort`. It accepts a judgment only after completed inference, valid token usage, schema validation, and the existing evidence checks. Interrupted/failed/incomplete streams cannot be accepted as decisions. There is no automatic fallback to API billing.

The current ChatGPT plan route does not support `max_output_tokens`. The configured output value is a local reservation and post-call check, not a guaranteed upstream cap. A timeout or local cancellation may still consume plan allowance. Call and token acquisition budgets bound dispatch; actual upstream usage can exceed a reservation and is rejected afterward.

Plan requests record tokens and latency. `costVerified: false` and `billingSource: chatgpt-plan` distinguish them from paid API costs; dollar totals and cost per safe resolution are unavailable for runs containing plan usage. Known API spend is retained separately for mixed-provider reports. Dollar budget flags constrain API spend, not plan credits. Manage account/app limits in [ChatGPT usage settings](https://chatgpt.com/#settings/Usage).

## Credentials and accounts

OAuth credentials live in the Git-ignored `.chatgpt/credentials.json`, with owner-only directory/file permissions on Unix. Keep this directory out of backups or artifacts you share. Custom `CHATGPT_AUTH_DIR` paths must also be excluded from source control. Credentials never enter browser storage or reports. Browser storage contains only the non-sensitive first-use acknowledgement.

The local runtime validates OAuth state, PKCE, JWT signature/issuer/audience/expiry, nonce, and granted plan permission. It retains separate registrations for different accounts/workspaces, preserves a stable host ID, writes credentials atomically, and locks refreshes across server/CLI processes. **Add account**, the account picker, **Reconnect with ChatGPT**, and **Sign out** manage these connections. Sign-out attempts remote refresh-token revocation and reports if it could only clear local credentials.

If a process crashes while holding `.chatgpt/credentials.lock`, stop other harness processes before removing the stale lock. This avoids racing rotating refresh tokens.

The evaluator binds to loopback, accepts only bundled synthetic cases, and requires the harness header and permitted Origin/Host on mutations. It is intended for local OSS use; publishing an internet-accessible service needs a separate deployment design and applicable OpenAI approval.

## Official references

- [OSS registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Account-specific models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Accounts, sessions, and credential protection](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Reasoning effort](https://developers.openai.com/api/docs/guides/reasoning)

Automated tests use synthetic credentials and mocked OpenAI responses. A real user must finish consent in their browser to verify account eligibility and a live model request.
