import { useState } from 'react';
import { api, statusColor } from '../lib/api';

export interface PinItem {
  id: string;
  title: string;
  description: string;
  primaryKeyword: string;
  destinationUrl: string;
  boardName?: string | null;
  status: string;
  creativeAngle: string;
  scheduledAt?: string | null;
  product?: { id: string; name: string };
}

export function PinCard({ pin, onChange }: { pin: PinItem; onChange?: () => void }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const call = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setMsg('');
    try {
      await fn();
      setMsg('Done');
      onChange?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="card overflow-hidden !p-0">
      <img src={`/api/pins/${pin.id}/image`} alt={pin.title} className="aspect-[2/3] w-full bg-neutral-200 object-cover" loading="lazy" />
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span className={`badge ${statusColor(pin.status)}`}>{pin.status}</span>
          <span className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800">{pin.creativeAngle}</span>
        </div>
        <div className="font-bold leading-snug">{pin.title}</div>
        <div className="line-clamp-3 text-sm text-neutral-500">{pin.description}</div>
        <div className="text-xs text-neutral-500">🔑 {pin.primaryKeyword} · 📌 {pin.boardName || '—'} · 🔗 {pin.destinationUrl.replace('https://', '').slice(0, 40)}</div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button disabled={!!busy} className="btn-ghost !px-2" onClick={() => call('seo', () => api(`/api/pins/${pin.id}/regenerate-seo`, { method: 'POST' }))}>↻ SEO</button>
          <button disabled={!!busy} className="btn-ghost !px-2" onClick={() => call('img', () => api(`/api/pins/${pin.id}/regenerate-image`, { method: 'POST' }))}>🖼 Image</button>
          <button disabled={!!busy} className="btn-ghost !px-2" onClick={() => call('approve', () => api(`/api/pins/${pin.id}/approve`, { method: 'POST' }))}>✓ Approve</button>
          <button disabled={!!busy} className="btn-primary !px-2" onClick={() => call('publish', () => api(`/api/pinterest/publish/${pin.id}`, { method: 'POST', body: JSON.stringify({}) }))}>🚀 Publish</button>
        </div>
        {msg && <div className="text-xs text-neutral-500">{busy ? `${busy}…` : msg}</div>}
        {busy && <div className="text-xs">Working…</div>}
      </div>
    </div>
  );
}
