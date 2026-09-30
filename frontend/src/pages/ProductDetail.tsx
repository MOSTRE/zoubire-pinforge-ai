import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { PinCard, PinItem } from '../components/PinCard';

export function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState<{ id: string; name: string; url: string; description?: string | null; thumbnailUrl?: string | null; priceCents?: number | null; analysis?: Record<string, unknown> | null } | null>(null);
  const [pins, setPins] = useState<PinItem[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const j = await api<{ product: typeof product & { pins: PinItem[] } }>(`/api/products/${id}`);
    setProduct(j.product);
    setPins((j.product as unknown as { pins: PinItem[] }).pins || []);
  };
  useEffect(() => { load().catch((e) => setMsg(e instanceof Error ? e.message : 'Failed')); }, [id]);

  const gen = async (count: number) => {
    setBusy(true); setMsg(`Generating ${count} pin(s)… (AI + image + design)`);
    try {
      await api('/api/pins/generate', { method: 'POST', body: JSON.stringify({ productId: id, count }) });
      setMsg('Done — see pins below');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  const analyze = async () => {
    setBusy(true); setMsg('Analyzing…');
    try {
      await api(`/api/products/${id}/analyze`, { method: 'POST' });
      await load();
      setMsg('Analysis ready');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Analyze failed');
    } finally {
      setBusy(false);
    }
  };

  if (!product) return <div className="card">{msg || 'Loading…'}</div>;
  const a = (product.analysis || {}) as Record<string, string>;
  const list = (k: string): string[] => { try { return JSON.parse(a[k] || '[]'); } catch { return []; } };

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-3 md:flex-row">
        {product.thumbnailUrl && <img src={product.thumbnailUrl} alt="" className="w-full max-w-xs rounded-xl object-cover" />}
        <div className="flex-1">
          <h1 className="text-xl font-extrabold">{product.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">{product.description?.slice(0, 400) || 'No description on file.'}</p>
          <p className="mt-1 text-xs text-neutral-500">🔗 <a className="underline" href={product.url} target="_blank" rel="noreferrer">{product.url}</a>{product.priceCents != null ? ` · $${(product.priceCents / 100).toFixed(2)}` : ''}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-ghost" disabled={busy} onClick={analyze}>🧠 Analyze</button>
            <button className="btn-primary" disabled={busy} onClick={() => gen(1)}>Generate 1 Pin</button>
            <button className="btn-primary" disabled={busy} onClick={() => gen(5)}>Generate 5 Pins</button>
            <button className="btn-ghost" disabled={busy} onClick={() => gen(10)}>Generate 10 Pins</button>
          </div>
          {msg && <p className="mt-2 text-sm text-neutral-500">{msg}</p>}
        </div>
      </div>
      {product.analysis && (
        <div className="card">
          <h2 className="font-bold">AI Analysis</h2>
          <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
            <div><b>Audience:</b> {String(a.targetAudience || '—')}</div>
            <div><b>Intent:</b> {String(a.searchIntent || '—')}</div>
            <div><b>Keywords:</b> {list('primaryKeywords').join(', ') || '—'}</div>
            <div><b>Boards:</b> {list('suggestedBoards').join(', ') || '—'}</div>
          </div>
          <div className="mt-2 text-sm"><b>Angles:</b> {list('contentAngles').join(' · ')}</div>
        </div>
      )}
      <h2 className="font-bold">Pins ({pins.length})</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pins.map((p) => <PinCard key={p.id} pin={p} onChange={load} />)}
      </div>
    </div>
  );
}
