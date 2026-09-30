import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function Boards() {
  const [boards, setBoards] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const load = async () => {
    try {
      const j = await api<{ boards: typeof boards }>('/api/pinterest/boards');
      setBoards(j.boards);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Connect Pinterest to list boards');
    }
  };
  useEffect(() => { load(); }, []);
  const create = async () => {
    if (!name.trim()) return;
    try {
      await api('/api/pinterest/boards', { method: 'POST', body: JSON.stringify({ name, description: desc }) });
      setName(''); setDesc('');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Create failed');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold">Boards</h1>
      {msg && <div className="card text-sm">{msg}</div>}
      <div className="card flex flex-col gap-2">
        <h2 className="font-bold">Create board</h2>
        <input className="input" placeholder="Board name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className="btn-primary w-fit" onClick={create}>Create</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {boards.map((b) => (
          <div key={b.id} className="card"><div className="font-bold">{b.name}</div><div className="text-xs text-neutral-500">{b.id} · {b.description || ''}</div></div>
        ))}
      </div>
      {boards.length === 0 && <div className="card text-sm text-neutral-500">No boards loaded. Connect Pinterest in Settings first.</div>}
    </div>
  );
}

export function Analytics() {
  const [data, setData] = useState<{ byStatus: Array<{ status: string; count: number }>; topProducts: Array<{ name: string; published: number }>; notice: string } | null>(null);
  useEffect(() => { api<{ byStatus: Array<{ status: string; count: number }>; topProducts: Array<{ name: string; published: number }>; notice: string }>('/api/analytics').then((d) => setData(d)).catch(() => null); }, []);
  if (!data) return <div className="card">Loading…</div>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold">Analytics</h1>
      <div className="card"><p className="text-sm">{data.notice}</p></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card">
          <h2 className="font-bold">Pins by status</h2>
          {data.byStatus.map((b) => <div key={b.status} className="mt-1 flex justify-between text-sm"><span>{b.status}</span><b>{b.count}</b></div>)}
        </div>
        <div className="card">
          <h2 className="font-bold">Top products (published)</h2>
          {data.topProducts.map((t) => <div key={t.name} className="mt-1 flex justify-between text-sm"><span className="truncate">{t.name}</span><b>{t.published}</b></div>)}
          {data.topProducts.length === 0 && <p className="text-sm text-neutral-500">Nothing published yet.</p>}
        </div>
      </div>
    </div>
  );
}
