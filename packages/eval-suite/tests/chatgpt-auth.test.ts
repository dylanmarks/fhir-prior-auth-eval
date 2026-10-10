import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ChatGptAuth, resolveChatGptProviders } from '../../evaluators/src/chatgpt/auth.js';

let directory: string;
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), 'openpa-auth-test-'));});
afterEach(async () => {vi.unstubAllGlobals(); await rm(directory, {recursive: true, force: true});});
const redirectUri = 'http://127.0.0.1:8787/auth/callback';
const permission = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
async function setup(options: {nonce?: string; issuer?: string; audience?: string; expired?: boolean; scope?: string; subject?: string} = {}) {
  const auth = new ChatGptAuth(directory);
  const authorization = new URL(await auth.begin(redirectUri));
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig'};
  const idToken = await new SignJWT({nonce: options.nonce ?? authorization.searchParams.get('nonce'), email: 'test@example.invalid'})
    .setProtectedHeader({alg: 'RS256', kid: 'test-key'}).setIssuer(options.issuer ?? 'https://auth.openai.com').setAudience(options.audience ?? 'oaiapp_test').setSubject(options.subject ?? 'subject-1').setIssuedAt().setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 60 : '1h').sign(privateKey);
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/.well-known/jwks.json')) return new Response(JSON.stringify({keys: [jwk]}), {headers: {'Content-Type': 'application/json'}});
    if (String(url).endsWith('/oauth/token')) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('client_id')).toBe('oaiapp_test'); expect(body.get('resource')).toBe('https://api.openai.com/v1');
      expect(body.get('client_secret')).toBeNull();
      if (body.get('grant_type') === 'authorization_code') {
        expect(body.get('redirect_uri')).toBe(redirectUri);
        expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'));
      }
      return new Response(JSON.stringify({access_token: body.get('grant_type') === 'refresh_token' ? 'renewed-access' : 'test-access', refresh_token: 'rotating-refresh', id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: options.scope ?? permission}));
    }
    throw new Error('Unexpected endpoint');
  });
  vi.stubGlobal('fetch', fetch);
  const callback = new URLSearchParams({state: authorization.searchParams.get('state')!, code: 'test-code', client_id: 'oaiapp_test'});
  return {auth, authorization, fetch, callback};
}
describe('ChatGPT OSS authentication', () => {
  it('persists a stable host and starts public-client PKCE with explicit plan scope', async () => {
    const auth = new ChatGptAuth(directory);
    const first = new URL(await auth.begin(redirectUri)); const second = new URL(await auth.begin(redirectUri));
    expect(first.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(first.searchParams.get('agent_name_hint')).toBe('OpenPA Eval');
    expect(first.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    expect(first.searchParams.get('ext_agent_host_id')).toBe(second.searchParams.get('ext_agent_host_id'));
    expect(first.searchParams.get('state')).not.toBe(second.searchParams.get('state'));
    expect(first.searchParams.get('nonce')).not.toBe(second.searchParams.get('nonce'));
    expect(first.searchParams.get('code_challenge_method')).toBe('S256');
    await expect(auth.begin('http://localhost:8787/auth/callback')).rejects.toThrow('loopback');
  });
  it('verifies signed identity, stores credentials privately, and never returns credentials to UI status', async () => {
    const {auth, callback} = await setup();
    await expect(auth.callback(callback)).resolves.toEqual({planEnabled: true});
    expect(await auth.accessToken()).toBe('test-access');
    const status = await auth.status(); expect(status).toMatchObject({connected: true, planEnabled: true, active: 'oaiapp_test', pending: false});
    expect(JSON.stringify(status)).not.toContain('test-access'); expect(JSON.stringify(status)).not.toContain('rotating-refresh');
    expect((await stat(join(directory, 'credentials.json'))).mode & 0o777).toBe(0o600); expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const next = new URL(await auth.begin(redirectUri, status.active!)); expect(next.searchParams.get('client_id')).toBe('oaiapp_test'); expect(next.searchParams.has('agent_name_hint')).toBe(false);
  });
  it('rejects mismatched state before contacting token endpoint and consumes callbacks once', async () => {
    const {auth, callback, fetch} = await setup();
    const wrong = new URLSearchParams(callback); wrong.set('state', 'wrong');
    await expect(auth.callback(wrong)).rejects.toThrow('state'); expect(fetch).not.toHaveBeenCalled();
    await auth.callback(callback); const count = fetch.mock.calls.length;
    await expect(auth.callback(callback)).rejects.toThrow('expired'); expect(fetch).toHaveBeenCalledTimes(count);
  });
  it.each([{nonce: 'wrong'}, {issuer: 'https://attacker.invalid'}, {audience: 'another-client'}, {expired: true}])('rejects invalid identity claims %j', async claims => {
    const {auth, callback} = await setup(claims);
    await expect(auth.callback(callback)).rejects.toThrow();
    expect((await auth.status()).connected).toBe(false);
  });
  it('keeps identity-only consent separate from permission to invoke models', async () => {
    const {auth, callback} = await setup({scope: 'openid profile email'});
    await expect(auth.callback(callback)).resolves.toEqual({planEnabled: false});
    expect((await auth.status()).connected).toBe(true);
    await expect(auth.accessToken()).rejects.toThrow('authorize plan usage');
  });
  it('retains a newly issued client ID even when the code exchange fails', async () => {
    const {auth, callback} = await setup(); vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 400})));
    await expect(auth.callback(callback)).rejects.toThrow('token exchange failed');
    const store = JSON.parse(await readFile(join(directory, 'credentials.json'), 'utf8'));
    expect(store.profiles[0].clientId).toBe('oaiapp_test'); expect(store.profiles[0].accessToken).toBeUndefined();
    const retry = new URL(await auth.begin(redirectUri)); expect(retry.searchParams.get('client_id')).toBe('oaiapp_test');
    const newAccount = new URL(await auth.begin(redirectUri, undefined, true)); expect(newAccount.searchParams.get('client_id')).toBe('dynamic_agent_client');
  });
  it('serializes token refreshes across runtime instances and saves the replacement token', async () => {
    const {auth, callback, fetch} = await setup(); await auth.callback(callback);
    const file = join(directory, 'credentials.json'); const store = JSON.parse(await readFile(file, 'utf8')); store.profiles[0].expiresAt = 0; await writeFile(file, JSON.stringify(store), {mode: 0o600});
    const other = new ChatGptAuth(directory);
    const results = await Promise.all([auth.accessToken(), other.accessToken()]);
    expect(results).toEqual(['renewed-access', 'renewed-access']);
    expect(fetch.mock.calls.filter(([, init]) => new URLSearchParams(String(init?.body)).get('grant_type') === 'refresh_token')).toHaveLength(1);
    expect(JSON.parse(await readFile(file, 'utf8')).profiles[0].refreshToken).toBe('rotating-refresh');
  });
  it('rejects a mismatched returned client during reauthorization before token exchange', async () => {
    const {auth, callback, fetch} = await setup(); await auth.callback(callback);
    const authorization = new URL(await auth.begin(redirectUri, 'oaiapp_test'));
    const count = fetch.mock.calls.length;
    await expect(auth.callback(new URLSearchParams({state: authorization.searchParams.get('state')!, code: 'test', client_id: 'oaiapp_other'}))).rejects.toThrow('registration');
    expect(fetch).toHaveBeenCalledTimes(count); expect((await auth.status()).active).toBe('oaiapp_test');
  });
  it('filters the current account model catalog and preserves saved selection without leaking tokens', async () => {
    const {auth, callback} = await setup(); await auth.callback(callback);
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {expect(init.headers.Authorization).toBe('Bearer test-access'); return new Response(JSON.stringify({models: [{slug: 'gpt-6-luna', display_name: 'Luna', visibility: 'list'}, {slug: 'hidden', display_name: 'Hidden', visibility: 'hidden'}]}));}));
    expect(await auth.models()).toEqual([{id: 'gpt-6-luna', name: 'Luna'}]);
    await auth.setFrontier({provider: 'chatgpt-plan', model: 'gpt-6-luna', reasoningEffort: 'low'});
    const {options, status} = await resolveChatGptProviders(auth, {});
    expect(status.frontier).toMatchObject({provider: 'chatgpt-plan', model: 'gpt-6-luna', reasoningEffort: 'low', configured: true});
    expect(JSON.stringify(options)).not.toContain('test-access');
    const env = await resolveChatGptProviders(auth, {}, false); expect(env.status.frontier.provider).toBe('openrouter');
  });
  it('clears local credentials and reports unconfirmed revocation while retaining the host/client registration', async () => {
    const {auth, callback} = await setup(); await auth.callback(callback);
    const before = JSON.parse(await readFile(join(directory, 'credentials.json'), 'utf8'));
    vi.stubGlobal('fetch', vi.fn(async () => {throw new Error('offline');}));
    expect(await auth.signOut()).toEqual({revoked: false});
    expect((await auth.status()).connected).toBe(false);
    const after = JSON.parse(await readFile(join(directory, 'credentials.json'), 'utf8'));
    expect(after.hostId).toBe(before.hostId); expect(after.profiles[0].clientId).toBe('oaiapp_test'); expect(after.profiles[0].refreshToken).toBeUndefined();
  });
});
