import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface Product { id: string; name: string; url: string; description?: string | null; thumbnailUrl?: string | null; priceCents?: number | null; _count?: { pins: number } }

export function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [csv, setCsv] = useState('');

  const load = async () => {
    const j = await api<{ products: Product[] }>(`/api/products?search=${encodeURIComponent(search)}`);
    setProducts(j.products);
  };
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, []);

  const sync = async () => {
    setBusy(true); setMsg('Syncing Gumroad…');
    try {
      const j = await api<{ ok: boolean; error?: string; summary?: { found: number; new: number; updated: number; unchanged: number } }>('/api/products/sync', { method: 'POST' });
      if (!j.ok) setMsg(`Sync failed: ${j.error}`);
      else setMsg(`Sync: ${j.summary?.found} found · ${j.summary?.new} new · ${j.summary?.updated} updated · ${j.summary?.unchanged} unchanged`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async () => {
    if (!csv.trim()) return;
    setBusy(true);
    try {
      const j = await api<{ added: number; skipped: number }>('/api/products/import', { method: 'POST', body: JSON.stringify({ csv }) });
      setMsg(`CSV import: ${j.added} added, ${j.skipped} skipped`);
      setCsv('');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">Products</h1>
        <input className="input max-w-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
        <button className="btn-accent" disabled={busy} onClick={sync}>🔄 Sync Gumroad</button>
        {msg && <span className="text-sm text-neutral-500">{msg}</span>}
      </div>
      {products.length === 0 && (
        <div className="card text-center">
          <p className="font-bold">No products yet</p>
          <p className="text-sm text-neutral-500">Click “Sync Gumroad” to discover https://zoubire.gumroad.com automatically, or paste a CSV below.</p>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <Link key={p.id} to={`/products/${p.id}`} className="card hover:shadow">
            {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" className="mb-2 aspect-video w-full rounded-xl object-cover" loading="lazy" />}
            <div className="font-bold leading-snug">{p.name}</div>
            <div className="mt-1 text-xs text-neutral-500">{p.priceCents != null ? `$${(p.priceCents / 100).toFixed(2)}` : ''} · {p._count?.pins ?? 0} pins · <span className="underline">{p.url.replace('https://', '').slice(0, 40)}</span></div>
          </Link>
        ))}
      </div>
      <details className="card">
        <summary className="cursor-pointer font-bold">Fallback: CSV / manual import</summary>
        <p className="mt-2 text-sm text-neutral-500">Header: <code>name,url,description,thumbnailUrl,priceCents,tags</code></p>
        <textarea className="input mt-2 h-24 font-mono" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'name,url\n"My Guide",https://zoubire.gumroad.com/l/my-guide'} />
        <button className="btn-primary mt-2" disabled={busy} onClick={importCsv}>Import CSV</button>
      </details>
    </div>
  );
}
