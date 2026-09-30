import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const SECTIONS: Record<string, string[]> = {
  Gumroad: ['GUMROAD_STORE_URL'],
  AI: ['OLLAMA_BASE_URL', 'OLLAMA_MODEL'],
  Images: ['COMFYUI_URL', 'COMFYUI_WORKFLOW'],
  Pinterest: ['PINTEREST_CLIENT_ID', 'PINTEREST_REDIRECT_URI', 'PINTEREST_SCOPES'],
  Scheduler: ['APP_TIMEZONE', 'SCHEDULER_START_TIME', 'SCHEDULER_END_TIME', 'SCHEDULER_PINS_PER_DAY'],
  Brand: ['BRAND_NAME', 'BRAND_STORE_URL', 'BRAND_DEFAULT_CTA', 'BRAND_FOOTER'],
  'Publishing Safety': ['PUBLISHING_MODE', 'PINS_PER_DAY', 'MIN_INTERVAL_MINUTES'],
};

export function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState<Record<string, string>>({});
  const [models, setModels] = useState<string[]>([]);

  const load = async () => {
    const j = await api<{ settings: Record<string, string> }>('/api/settings');
    setSettings(j.settings);
    try {
      const m = await api<{ models: string[] }>('/api/ollama/models');
      setModels(m.models);
    } catch { /* ignore */ }
  };
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, []);

  const save = async () => {
    try {
      await api('/api/settings', { method: 'PATCH', body: JSON.stringify(settings) });
      setMsg('Settings saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const test = async (which: string) => {
    setStatus({ ...status, [which]: 'Testing…' });
    try {
      const j = await api<{ ok: boolean; detail?: string; error?: string }>(`/api/settings/test/${which}`, { method: 'POST' });
      setStatus({ ...status, [which]: j.ok ? `✅ Connected — ${j.detail || ''}` : `❌ ${j.error}` });
    } catch (e) {
      setStatus({ ...status, [which]: `❌ ${e instanceof Error ? e.message : 'failed'}` });
    }
  };

  const connectPinterest = async () => {
    try {
      const j = await api<{ ok: boolean; url?: string; error?: string }>('/api/pinterest/oauth/start');
      if (!j.ok || !j.url) { setMsg(j.error || 'Cannot start OAuth'); return; }
      window.location.href = j.url;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'OAuth failed');
    }
  };

  return (
    <div className="flex flex-col gap-4" id="setup">
      <h1 className="text-xl font-extrabold">Settings</h1>
      {msg && <div className="card text-sm">{msg}</div>}
      {Object.entries(SECTIONS).map(([section, keys]) => (
        <div key={section} className="card">
          <h2 className="font-bold">{section}</h2>
          <div className="mt-2 flex flex-col gap-2">
            {keys.map((k) => (
              <label key={k} className="text-sm">{k}
                {k === 'OLLAMA_MODEL' && models.length > 0 ? (
                  <select className="input mt-1" value={settings[k] || ''} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}>
                    <option value="">Select model…</option>
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : k === 'PUBLISHING_MODE' ? (
                  <select className="input mt-1" value={settings[k] || 'manual'} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}>
                    <option value="manual">Manual approval</option>
                    <option value="auto">Automatic publishing</option>
                  </select>
                ) : (
                  <input className="input mt-1" value={settings[k] || ''} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} />
                )}
              </label>
            ))}
          </div>
          {section === 'Gumroad' && <TestRow label="Gumroad" status={status.gumroad} onTest={() => test('gumroad')} />}
          {section === 'AI' && <TestRow label="Ollama" status={status.ollama} onTest={() => test('ollama')} />}
          {section === 'Images' && <TestRow label="ComfyUI" status={status.comfyui} onTest={() => test('comfyui')} />}
          {section === 'Pinterest' && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={connectPinterest}>Connect Pinterest</button>
              <button className="btn-ghost" onClick={() => test('pinterest')}>Test Pinterest</button>
              <button className="btn-ghost" onClick={() => api('/api/pinterest/disconnect', { method: 'POST' }).then(() => setMsg('Disconnected'))}>Disconnect</button>
              {status.pinterest && <span className="text-sm">{status.pinterest}</span>}
            </div>
          )}
        </div>
      ))}
      <button className="btn-accent w-fit" onClick={save}>Save settings</button>
      <div className="card text-sm text-neutral-500">
        Secrets live in <code>.env</code> / the local SQLite DB and are never sent to the browser except as masked values. Pinterest client secret is backend-only.
      </div>
    </div>
  );
}

function TestRow({ label, status, onTest }: { label: string; status?: string; onTest: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <button className="btn-ghost" onClick={onTest}>Test {label}</button>
      {status && <span className="text-sm">{status}</span>}
    </div>
  );
}
