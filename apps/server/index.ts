import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createEvaluationOrchestrator, createEvaluationStrategy, REASONING_EFFORTS } from '@openpa/evaluators';
import { ChatGptAuth, resolveChatGptProviders } from '@openpa/evaluators/chatgpt-auth';
import { CounterfactualMutator } from '@openpa/eval-suite';
import { loadDataset } from '../../packages/eval-suite/src/dataset.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const {cases, policies} = loadDataset(root);
const auth = new ChatGptAuth();
const requestSchema = z.object({caseId: z.string().min(1), strategy: z.enum(['rules', 'cheap', 'tiered', 'llm']), mutation: z.enum(['shorten_therapy_duration', 'diagnosis_non_indicated', 'temporal_expiry', 'clinical_negation', 'laterality_mismatch']).nullable().optional()}).strict();
const frontierSchema = z.object({provider: z.enum(['openrouter', 'chatgpt-plan']), model: z.string().min(1).max(200).optional(), reasoningEffort: z.enum(REASONING_EFFORTS).optional()}).strict();
let active = false;
let authMessage = '';
const permittedHost = /^(localhost|127\.0\.0\.1):(5173|4173|8787)$/;
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  const send = (code: number, value: unknown) => {res.statusCode = code; res.end(JSON.stringify(value));};
  const origin = req.headers.origin;
  if (!permittedHost.test(req.headers.host ?? '') || (origin && !/^http:\/\/(localhost|127\.0\.0\.1):(5173|4173|8787)$/.test(origin))) return send(403, {error: 'Origin or host is not permitted'});
  const url = new URL(req.url ?? '/', 'http://127.0.0.1:8787');
  try {
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      if (active) return send(409, {error: 'Wait for the active evaluation to finish, then reconnect'});
      active = true;
      try {
        const result = await auth.callback(url.searchParams);
        authMessage = result.planEnabled ? 'ChatGPT connected. Eligible requests use your plan or credits. Manage usage in ChatGPT settings.' : 'Signed in, but plan usage was not authorized. Reconnect to grant plan usage.';
      } catch {authMessage = 'ChatGPT sign-in did not complete. Return to provider settings and try again.';}
      finally {active = false;}
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenPA Eval · ChatGPT</title><body style="font:18px system-ui;max-width:640px;margin:80px auto;padding:24px"><h1>OpenPA Eval</h1><p>' + authMessage + '</p><p>You can close this tab and return to the harness.</p></body></html>');
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const {status, account} = await resolveChatGptProviders(auth);
      return send(200, {...status, chatgpt: {...account, message: authMessage}, syntheticOnly: true});
    }
    if (req.method === 'GET' && url.pathname === '/api/chatgpt/models') return send(200, {models: await auth.models()});
    if (req.method === 'GET' && url.pathname === '/api/experiment') {
      try {return send(200, JSON.parse(readFileSync(root + '/results/experiment-report.json', 'utf8')));} catch {return send(404, {error: 'Run npm run experiment to generate a report'});}
    }
    if (req.method !== 'POST') return send(404, {error: 'Unknown endpoint'});
    // A custom header plus Origin checks blocks form posts and cross-origin browser requests.
    if (req.headers['x-openpa-request'] !== '1') return send(403, {error: 'Local harness request header required'});
    if (active) return send(429, {error: 'An evaluation or settings change is running; try again when it finishes'});
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, {error: 'JSON required'});
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) {bytes += chunk.length; if (bytes > 4096) return send(413, {error: 'Request too large'}); chunks.push(chunk);}
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (active) return send(429, {error: 'Another request is running'});
    active = true;
    try {
      if (url.pathname === '/api/chatgpt/sign-in') {
        const {profileId, newProfile} = z.object({profileId: z.string().optional(), newProfile: z.boolean().optional()}).strict().parse(body);
        authMessage = '';
        return send(200, {url: await auth.begin('http://127.0.0.1:8787/auth/callback', profileId, newProfile)});
      }
      if (url.pathname === '/api/chatgpt/select') {const {profileId} = z.object({profileId: z.string()}).strict().parse(body); await auth.select(profileId); authMessage = ''; return send(200, {ok: true});}
      if (url.pathname === '/api/chatgpt/cancel') {z.object({}).strict().parse(body); auth.cancelPending(); authMessage = ''; return send(200, {ok: true});}
      if (url.pathname === '/api/chatgpt/sign-out') {z.object({}).strict().parse(body); const {revoked} = await auth.signOut(); authMessage = revoked ? 'Signed out of ChatGPT.' : 'Signed out locally. Remote revocation was not confirmed; disconnect this app in ChatGPT settings.'; return send(200, {revoked});}
      if (url.pathname === '/api/frontier') {
        const args = frontierSchema.parse(body);
        if (args.provider === 'chatgpt-plan') {
          const models = await auth.models();
          if (!models.some(m => m.id === args.model)) return send(400, {error: 'Choose a model available to the connected ChatGPT account'});
        }
        await auth.setFrontier(args);
        return send(200, {ok: true});
      }
      if (url.pathname !== '/api/evaluate') return send(404, {error: 'Unknown endpoint'});
      const args = requestSchema.parse(body);
      const {options, status} = await resolveChatGptProviders(auth);
      createEvaluationStrategy(args.strategy, options);
      const caseData = cases.find(c => c.caseData.id === args.caseId)?.caseData;
      if (!caseData) return send(404, {error: 'Unknown synthetic case'});
      const policy = policies.find(p => p.id === caseData.policyId)!;
      if (args.strategy === 'cheap' && !status.jev.configured) return send(409, {error: 'Configure Jev before running the live cheap tier'});
      if (args.strategy === 'tiered' && !(status.jev.configured && status.small.configured)) return send(409, {error: 'Configure Jev and a small generative model before running the live cascade'});
      if (args.strategy === 'llm' && !status.frontier.configured) return send(409, {error: 'Connect and configure a frontier provider before running this baseline'});
      const current = args.mutation ? CounterfactualMutator.applyMutation(caseData, args.mutation).mutatedCase : caseData;
      const controller = new AbortController();
      res.on('close', () => {if (!res.writableEnded) controller.abort();});
      const assessment = await createEvaluationOrchestrator(args.strategy, {...options, orchestratorOptions: {...options.orchestratorOptions, signal: controller.signal}}).evaluateCase(current, policy);
      return send(200, {assessment, providers: status});
    } finally {active = false;}
  } catch (error) {
    return send(400, {error: error instanceof z.ZodError ? 'Invalid request' : error instanceof SyntaxError ? 'Invalid JSON' : 'Request failed. Check provider configuration or reconnect ChatGPT; no billing fallback was used.'});
  }
});
server.listen(8787, '127.0.0.1', () => console.log('Synthetic evaluator listening at http://127.0.0.1:8787. Credentials stay on this server.'));
