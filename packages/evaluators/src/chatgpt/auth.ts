import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { providerOptionsFromEnv, providerSummary } from '../provider-config.js';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const permission = 'chatgpt.tokens.use.direct';
interface Profile {
  clientId: string; subject?: string; email?: string; accessToken?: string; refreshToken?: string;
  expiresAt?: number; scopes?: string[];
}

/** Freeze account selection for the duration of a run; refresh credentials only in the local runtime. */
export async function resolveChatGptProviders(auth: ChatGptAuth, env: Record<string, string | undefined> = process.env, useSavedSelection = true) {
  const selection = useSavedSelection ? await auth.frontierSettings() : undefined;
  const account = await auth.status();
  const configuration = {...env};
  if (selection) {
    configuration.FRONTIER_LLM_PROVIDER = selection.provider;
    if (selection.provider === 'chatgpt-plan') {
      configuration.FRONTIER_LLM_MODEL = selection.model;
      configuration.FRONTIER_LLM_REASONING_EFFORT = selection.reasoningEffort;
    }
  }
  const options = providerOptionsFromEnv(configuration, {getAccessToken: () => auth.accessToken(account.active ?? undefined)});
  return {options, status: providerSummary(options, account.planEnabled), account};
}
interface Store {hostId: string; active?: string; profiles: Profile[]; frontier?: {provider: 'openrouter' | 'chatgpt-plan'; model?: string; reasoningEffort?: string}}
interface Pending {state: string; nonce: string; verifier: string; redirectUri: string; clientId?: string; expiresAt: number}
interface Tokens {access_token: string; refresh_token?: string; id_token?: string; expires_in: number; scope?: string; token_type: string}

/** Node runtime only. The browser receives account labels and authorization URLs, never credentials. */
export class ChatGptAuth {
  private readonly directory: string;
  private pending?: Pending;
  private jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  constructor(directory = process.env.CHATGPT_AUTH_DIR ?? resolve('.chatgpt')) { this.directory = resolve(directory); }

  private async load(): Promise<Store> {
    try { return JSON.parse(await readFile(join(this.directory, 'credentials.json'), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const store: Store = {hostId: `urn:uuid:${randomUUID()}`, profiles: []};
      await this.save(store); return store;
    }
  }
  private async save(store: Store) {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    await chmod(this.directory, 0o700);
    const path = join(this.directory, 'credentials.json');
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(store), {mode: 0o600, flag: 'wx'});
    await rename(temporary, path);
  }
  // Share the refresh lock across server/CLI processes: refresh tokens rotate on every renewal.
  private async locked<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const lock = join(this.directory, 'credentials.lock');
    let handle;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { handle = await open(lock, 'wx', 0o600); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    if (!handle) throw new Error('ChatGPT credentials are busy. If a process crashed, remove .chatgpt/credentials.lock after stopping other harness processes.');
    try { return await action(); } finally { await handle.close(); await unlink(lock); }
  }
  async status() {
    return this.locked(async () => {
      const store = await this.load(); const profile = store.profiles.find(p => p.clientId === store.active);
      return {
        connected: !!profile?.accessToken,
        planEnabled: !!profile?.accessToken && !!profile.scopes?.includes(permission),
        active: store.active ?? null,
        accounts: store.profiles.filter(p => p.subject).map(p => ({id: p.clientId, label: p.email ?? p.subject!, connected: !!p.accessToken})),
        pending: !!this.pending && this.pending.expiresAt > Date.now(),
      };
    });
  }
  async begin(redirectUri: string, profileId?: string, newProfile = false) {
    return this.locked(async () => {
      const callback = new URL(redirectUri);
      if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== '/auth/callback') throw new Error('A loopback /auth/callback URL is required');
      const store = await this.load();
      // Reuse a registration retained after an expired/failed first code exchange.
      const profile = profileId ? store.profiles.find(p => p.clientId === profileId) : newProfile ? undefined : [...store.profiles].reverse().find(p => !p.subject);
      if (profileId && !profile) throw new Error('Unknown ChatGPT account');
      const verifier = randomBytes(32).toString('base64url');
      const pending: Pending = {verifier, state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), redirectUri, clientId: profile?.clientId, expiresAt: Date.now() + 10 * 60_000};
      this.pending = pending;
      const url = new URL(`${issuer}/api/accounts/authorize`);
      const params: Record<string, string> = {
        client_id: profile?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: store.hostId,
        response_type: 'code', redirect_uri: redirectUri,
        scope: `openid profile email offline_access resource.invoke ${permission}`, resource,
        state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      };
      if (!profile) params.agent_name_hint = 'OpenPA Eval';
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
      return url.toString();
    });
  }
  private async exchange(params: Record<string, string>): Promise<Tokens> {
    const response = await fetch(tokenEndpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({...params, resource}), signal: AbortSignal.timeout(15_000)});
    if (!response.ok) throw new Error(`ChatGPT token exchange failed (HTTP ${response.status}). Reconnect your account; no alternative billing was used.`);
    const tokens = await response.json() as Tokens;
    if (!tokens.access_token || tokens.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('Invalid ChatGPT token response');
    return tokens;
  }
  async callback(params: URLSearchParams) {
    const pending = this.pending;
    if (!pending || pending.expiresAt < Date.now() || params.get('state') !== pending.state) throw new Error('Sign-in attempt expired or state did not match. Start sign-in again.');
    this.pending = undefined;
    if (params.has('error')) throw new Error('ChatGPT sign-in was declined. You can try again from provider settings.');
    const code = params.get('code');
    const clientId = params.get('client_id') ?? pending.clientId;
    if (!code || !clientId || clientId === 'dynamic_agent_client' || (pending.clientId && clientId !== pending.clientId)) throw new Error('Invalid ChatGPT registration callback');
    return this.locked(async () => {
      const store = await this.load();
      let profile = store.profiles.find(p => p.clientId === clientId);
      if (!profile) {profile = {clientId}; store.profiles.push(profile); await this.save(store);}
      const tokens = await this.exchange({grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri});
      if (!tokens.id_token) throw new Error('ChatGPT sign-in did not return an identity token');
      const {payload} = await jwtVerify(tokens.id_token, this.jwks, {issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], algorithms: ['RS256', 'ES256']});
      if (payload.nonce !== pending.nonce || !payload.sub || (profile.subject && profile.subject !== payload.sub)) throw new Error('ChatGPT identity did not match this sign-in attempt');
      Object.assign(profile, {subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, scopes: (tokens.scope ?? '').split(' ')});
      store.active = clientId; await this.save(store);
      return {planEnabled: profile.scopes!.includes(permission)};
    });
  }
  async select(profileId: string) {
    await this.locked(async () => { const store = await this.load(); if (!store.profiles.some(p => p.clientId === profileId && p.subject)) throw new Error('Unknown ChatGPT account'); store.active = profileId; await this.save(store); });
  }
  async frontierSettings() {return this.locked(async () => (await this.load()).frontier);}
  async setFrontier(frontier: NonNullable<Store['frontier']>) {await this.locked(async () => {const store = await this.load(); store.frontier = frontier; await this.save(store);});}
  async accessToken(profileId?: string) {
    return this.locked(async () => {
      const store = await this.load(); const profile = store.profiles.find(p => p.clientId === (profileId ?? store.active));
      if (!profile?.accessToken || !profile.scopes?.includes(permission)) throw new Error('Connect ChatGPT and authorize plan usage first');
      if ((profile.expiresAt ?? 0) < Date.now() + 60_000) {
        if (!profile.refreshToken) throw new Error('Reconnect ChatGPT: no renewable session is available');
        const tokens = await this.exchange({grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: profile.refreshToken});
        if (!tokens.refresh_token) throw new Error('ChatGPT did not return a replacement refresh token');
        Object.assign(profile, {accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, scopes: tokens.scope ? tokens.scope.split(' ') : profile.scopes});
        await this.save(store);
        if (!profile.scopes?.includes(permission)) throw new Error('ChatGPT plan usage is no longer authorized');
      }
      return profile.accessToken!;
    });
  }
  async models() {
    const response = await fetch(`${resource}/models`, {headers: {Authorization: `Bearer ${await this.accessToken()}`}, signal: AbortSignal.timeout(15_000)});
    if (!response.ok) throw new Error(`Could not list ChatGPT models (HTTP ${response.status})`);
    const data = await response.json() as {models?: Array<{slug: string; display_name: string; visibility: string}>};
    if (!Array.isArray(data.models)) throw new Error('Unexpected ChatGPT model catalog');
    return data.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string').map(m => ({id: m.slug, name: m.display_name ?? m.slug}));
  }
  async signOut() {
    return this.locked(async () => {
      const store = await this.load(); const profile = store.profiles.find(p => p.clientId === store.active);
      let revoked = !profile?.refreshToken;
      if (profile?.refreshToken) {
        try {
          const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, {signal: AbortSignal.timeout(10_000)});
          const {revocation_endpoint: endpoint} = await discovery.json() as {revocation_endpoint: string};
          if (!discovery.ok || new URL(endpoint).origin !== issuer) throw new Error('Invalid revocation endpoint');
          const result = await fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({token: profile.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId}), signal: AbortSignal.timeout(10_000)});
          revoked = result.status === 200;
        } catch { revoked = false; }
      }
      if (profile) {delete profile.accessToken; delete profile.refreshToken; delete profile.expiresAt; delete profile.scopes;}
      this.pending = undefined; await this.save(store);
      return {revoked};
    });
  }
}
