import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PinCard, PinItem } from '../components/PinCard';

export function Pins({ statusFilter }: { statusFilter?: string }) {
  const [pins, setPins] = useState<PinItem[]>([]);
  const [status, setStatus] = useState(statusFilter || '');
  const load = async () => {
    const j = await api<{ pins: PinItem[] }>(`/api/pins${status ? `?status=${status}` : '?take=200'}`);
    setPins(j.pins);
  };
  useEffect(() => { setStatus(statusFilter || ''); }, [statusFilter]);
  useEffect(() => { load().catch(() => null); }, [status]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">{statusFilter === 'published' ? 'Published' : 'Pins'}</h1>
        {!statusFilter && (
          <select className="input max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['draft', 'approved', 'scheduled', 'published', 'failed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button className="btn-ghost" onClick={load}>Refresh</button>
      </div>
      {pins.length === 0 && <div className="card text-center text-sm text-neutral-500">No pins here yet. Generate some from a Product page or AI Studio.</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pins.map((p) => <PinCard key={p.id} pin={p} onChange={load} />)}
      </div>
    </div>
  );
}

export function Queue() {
  const [queue, setQueue] = useState<Array<PinItem & { scheduledAt?: string | null; product?: { name: string } }>>([]);
  const [filter, setFilter] = useState('');
  const load = async () => {
    const j = await api<{ queue: typeof queue }>(`/api/queue${filter ? `?status=${filter}` : ''}`);
    setQueue(j.queue);
  };
  useEffect(() => { load().catch(() => null); }, [filter]);

  const schedule = async (pinId: string) => {
    const when = prompt('Schedule ISO datetime (e.g. 2026-10-01T10:00:00):', new Date(Date.now() + 3600e3).toISOString());
    if (!when) return;
    await api('/api/queue/schedule', { method: 'POST', body: JSON.stringify({ pinId, scheduledAt: new Date(when).toISOString() }) });
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-extrabold">Queue</h1>
        <select className="input max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Needs action (draft/approved/scheduled/failed)</option>
          {['draft', 'approved', 'scheduled', 'published', 'failed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-ghost" onClick={load}>Refresh</button>
      </div>
      {queue.map((p) => (
        <div key={p.id} className="card flex flex-col gap-3 md:flex-row">
          <img src={`/api/pins/${p.id}/image`} alt="" className="w-32 rounded-xl object-cover" loading="lazy" />
          <div className="flex-1">
            <div className="font-bold">{p.title}</div>
            <div className="text-xs text-neutral-500">{p.product?.name} · {p.status} · {p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : 'unscheduled'}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-ghost !px-3" onClick={() => api(`/api/pins/${p.id}/approve`, { method: 'POST' }).then(load)}>Approve</button>
              <button className="btn-ghost !px-3" onClick={() => schedule(p.id)}>Reschedule</button>
              <button className="btn-primary !px-3" onClick={() => api(`/api/queue/publish-now/${p.id}`, { method: 'POST' }).then(load).catch((e) => alert(e.message))}>Publish</button>
              <button className="btn-ghost !px-3" onClick={() => api(`/api/pins/${p.id}`, { method: 'DELETE' }).then(load)}>Delete</button>
            </div>
          </div>
        </div>
      ))}
      {queue.length === 0 && <div className="card text-center text-sm text-neutral-500">Queue is empty.</div>}
    </div>
  );
}
