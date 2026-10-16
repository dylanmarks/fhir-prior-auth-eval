import { useEffect, useState } from 'react';

interface Status {
  frontier: {provider: string; model: string | null; reasoningEffort: string | null; configured: boolean};
  chatgpt: {connected: boolean; planEnabled: boolean; active: string | null; pending: boolean; message: string; accounts: Array<{id: string; label: string; connected: boolean}>};
}
const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'minimal', 'none'];
const control = 'bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm';
async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-OpenPA-Request': '1'}, body: JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Provider request failed');
  return data;
}
export function ProviderPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState('openrouter');
  const [models, setModels] = useState<Array<{id: string; name: string}>>([]);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('low');
  const [message, setMessage] = useState('Connect the local evaluator to configure live frontier models.');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const refresh = async (syncSelection = true) => {
    const next: Status = await request('/api/status'); setStatus(next); setPending(next.chatgpt.pending);
    if (syncSelection) {setProvider(next.frontier.provider); setModel(next.frontier.model ?? ''); setEffort(next.frontier.reasoningEffort && next.frontier.reasoningEffort !== 'default' ? next.frontier.reasoningEffort : 'low');}
    if (next.chatgpt.message) setMessage(next.chatgpt.message);
    else if (!next.chatgpt.pending) setMessage('Local evaluator connected. Choose a provider and save your frontier configuration.');
    if (next.chatgpt.planEnabled) {
      const result = await request('/api/chatgpt/models'); setModels(result.models);
      if (!localStorage.getItem('openpa-chatgpt-plan-welcome')) setWelcome(true);
    } else setModels([]);
    return next;
  };
  useEffect(() => {void refresh().catch(() => {});}, []);
  useEffect(() => {
    if (!pending) return;
    const interval = setInterval(() => {void refresh(false).catch(() => {setPending(false); setMessage('The local evaluator is unavailable. Restart it and reconnect.');});}, 2000);
    return () => clearInterval(interval);
  }, [pending]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    try {await work();} catch (error) {setMessage(error instanceof Error ? error.message : 'Provider request failed');}
    finally {setBusy(false);}
  };
  const signIn = (profileId?: string, newProfile = false) => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    void action(async () => {
      try {
        const result = await request('/api/chatgpt/sign-in', profileId ? {profileId} : newProfile ? {newProfile: true} : {});
        if (popup) popup.location.href = result.url; else window.location.assign(result.url);
        setPending(true); setMessage('Finish sign-in in the browser, then return here.');
      } catch (error) {popup?.close(); throw error;}
    });
  };
  const [open, setOpen] = useState(true);

  return <section aria-label="Frontier provider settings" className="mx-6 mt-3 rounded-lg border border-slate-800 bg-slate-900/90 text-xs shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 cursor-pointer select-none hover:bg-slate-850/60 rounded-t-lg transition" onClick={() => setOpen(!open)}>
      <div className="flex items-center gap-2">
        <span className="text-slate-400 font-mono text-[10px]">{open ? '▼' : '▶'}</span>
        <h2 className="font-semibold text-slate-200">Frontier Model Provider</h2>
        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-300">
          {status?.frontier.configured ? `${status.frontier.provider} · ${status.frontier.model ?? 'configured'}` : 'Not configured'}
        </span>
      </div>
      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <button disabled={busy} className="bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 rounded px-2.5 py-1 text-xs transition" onClick={() => void action(async () => {await refresh(); setMessage('Provider status refreshed.');})}>Refresh</button>
        <button type="button" className="text-slate-400 hover:text-slate-200 text-xs px-2 py-1" onClick={() => setOpen(!open)}>{open ? 'Collapse' : 'Expand'}</button>
      </div>
    </div>
    {open && <div className="px-4 pb-3 pt-2 space-y-2.5 border-t border-slate-800/80">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs flex flex-col gap-1 text-slate-300">Provider<select className={control} value={provider} disabled={busy} onChange={e => {setProvider(e.target.value); setModel('');}}><option value="openrouter">OpenRouter · API billing</option><option value="chatgpt-plan">ChatGPT · use your plan</option></select></label>
        {provider === 'chatgpt-plan' && <>
          <button disabled={busy || pending} className="rounded bg-white text-slate-950 font-medium px-3 py-1.5 text-xs" onClick={() => signIn(status?.chatgpt.active ?? undefined)}>{status?.chatgpt.connected ? 'Reconnect with ChatGPT' : 'Continue with ChatGPT'}</button>
          {pending && <button className={control} disabled={busy} onClick={() => void action(async () => {await request('/api/chatgpt/cancel', {}); setPending(false); await refresh(false); setMessage('Sign-in cancelled.');})}>Cancel sign-in</button>}
          {status?.chatgpt.accounts.length ? <label className="text-xs flex flex-col gap-1 text-slate-300">ChatGPT account<select className={control} disabled={busy || pending} value={status.chatgpt.active ?? ''} onChange={e => void action(async () => {await request('/api/chatgpt/select', {profileId: e.target.value}); setModel(''); await refresh(false);})}>{status.chatgpt.accounts.map(a => <option key={a.id} value={a.id}>{a.label} · {a.id.slice(-6)}{a.connected ? '' : ' · signed out'}</option>)}</select></label> : null}
          {status?.chatgpt.connected && <><button className={control} disabled={busy || pending} onClick={() => signIn(undefined, true)}>Add account</button><button className={control} disabled={busy || pending} onClick={() => void action(async () => {await request('/api/chatgpt/sign-out', {}); await refresh();})}>Sign out</button></>}
        </>}
        {provider === 'chatgpt-plan' && status?.chatgpt.planEnabled && <>
          <label className="text-xs flex flex-col gap-1 text-slate-300">Model<select className={control} value={model} disabled={busy || pending} onChange={e => setModel(e.target.value)}><option value="">Choose an available model</option>{models.map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select></label>
          <label className="text-xs flex flex-col gap-1 text-slate-300">Reasoning effort<select className={control} value={effort} disabled={busy || pending} onChange={e => setEffort(e.target.value)}>{efforts.map(e => <option key={e} value={e}>{e === 'xhigh' ? 'Extra high' : e[0].toUpperCase() + e.slice(1)}</option>)}</select></label>
        </>}
        <button className="rounded bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs disabled:opacity-40 text-white font-medium transition" disabled={busy || !status || (provider === 'chatgpt-plan' && (pending || !status.chatgpt.planEnabled || !model))} onClick={() => void action(async () => {if (provider === 'openrouter' && pending) await request('/api/chatgpt/cancel', {}).catch(() => {}); await request('/api/frontier', provider === 'chatgpt-plan' ? {provider, model, reasoningEffort: effort} : {provider}); await refresh(); setMessage('Saved frontier provider. Choose Local evaluator and Frontier generative baseline in the evidence workbench to run it.');})}>Use for frontier</button>
      </div>
      <p role="status" className="text-xs text-slate-400">{message}</p>
      {status?.frontier.provider === 'chatgpt-plan' && <p className="text-xs text-indigo-300">{status.frontier.configured ? 'Using ChatGPT plan' : 'ChatGPT provider needs connection'} · {status.frontier.model} · {status.frontier.reasoningEffort} reasoning. <a className="underline" href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noreferrer">Manage usage</a></p>}
      {provider === 'chatgpt-plan' && <p className="text-[11px] text-slate-500">Eligible requests consume your ChatGPT plan allowance or credits. Model availability and supported reasoning efforts depend on your account and model. A failed request never switches to API billing.</p>}
    </div>}
    {welcome && <div role="dialog" aria-modal="true" aria-labelledby="plan-welcome" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"><div className="max-w-lg rounded-xl bg-slate-900 border border-slate-600 p-6 space-y-4"><h2 id="plan-welcome" className="text-xl font-semibold">You’re using your ChatGPT plan</h2><p>Eligible requests in this harness use your plan allowance or credits. You can manage this app’s usage and access in ChatGPT settings.</p><a className="underline" href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noreferrer">Manage usage</a><div><button autoFocus className="bg-indigo-600 rounded px-4 py-2" onClick={() => {localStorage.setItem('openpa-chatgpt-plan-welcome', '1'); setWelcome(false);}}>Got it</button></div></div></div>}
  </section>;
}
