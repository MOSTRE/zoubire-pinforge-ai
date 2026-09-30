import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function Studio() {
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [productId, setProductId] = useState('');
  const [angle, setAngle] = useState('educational');
  const [template, setTemplate] = useState('headline-hero');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Array<{ id: string; title: string }> | null>(null);

  useEffect(() => {
    api<{ products: Array<{ id: string; name: string }> }>('/api/products').then((j) => {
      setProducts(j.products);
      if (j.products[0]) setProductId(j.products[0].id);
    }).catch(() => null);
  }, []);

  const generate = async () => {
    if (!productId) { setMsg('Pick a product first'); return; }
    setBusy(true); setMsg('Generating complete Pin (SEO + image + design)…');
    try {
      const j = await api<{ pins: Array<{ id: string; title: string }> }>('/api/pins/generate', {
        method: 'POST', body: JSON.stringify({ productId, count: 1, creativeAngles: [angle], template }),
      });
      setResult(j.pins);
      setMsg('Saved to Drafts — see Pins page');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold">AI Studio</h1>
      <div className="card flex flex-col gap-3">
        <label className="text-sm">Product
          <select className="input mt-1" value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">Creative angle
            <select className="input mt-1" value={angle} onChange={(e) => setAngle(e.target.value)}>
              {['problem-solution', 'educational', 'checklist', 'comparison', 'productivity', 'beginner-guide', 'mistakes-to-avoid', 'benefits', 'use-case', 'product-focused'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="text-sm">Template
            <select className="input mt-1" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {['headline-hero', 'minimal-ad', 'checklist', 'problem-solution', 'tutorial', 'before-after', 'bold-type'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <button className="btn-accent" disabled={busy} onClick={generate}>Generate</button>
          <button className="btn-ghost" disabled={busy} onClick={generate}>Regenerate</button>
        </div>
        {msg && <p className="text-sm text-neutral-500">{msg}</p>}
        {result && result[0] && (
          <div className="flex gap-3">
            <img src={`/api/pins/${result[0].id}/image`} alt="" className="w-48 rounded-xl" />
            <div><b>Use This Version →</b> saved as draft: {result[0].title}</div>
          </div>
        )}
      </div>
    </div>
  );
}
