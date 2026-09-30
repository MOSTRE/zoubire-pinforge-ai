import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export function Dashboard() {
  const [data, setData] = useState<{ products: number; pinsGenerated: number; pinsQueued: number; pinsPublished: number; failedJobs: number; today: Array<{ id: string; title: string; scheduledAt: string }>; activity: Array<{ id: string; type: string; message: string; createdAt: string }> } | null>(null);
  const [err, setErr] = useState('');
  const load = async () => {
    try {
      setData(await api('/api/dashboard'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  };
  useEffect(() => { load(); }, []);
  if (err) return <div className="card">Error: {err}</div>;
  if (!data) return <div className="card">Loading…</div>;
  const cards: Array<[string, number, string]> = [
    ['Products', data.products, '/products'],
    ['Pins generated', data.pinsGenerated, '/pins'],
    ['Pins queued', data.pinsQueued, '/queue'],
    ['Pins published', data.pinsPublished, '/published'],
    ['Failed jobs', data.failedJobs, '/queue'],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-3 bg-gradient-to-r from-neutral-900 to-neutral-700 !text-white dark:from-white dark:to-neutral-300 dark:!text-neutral-900" id="generate">
        <div className="flex-1">
          <h1 className="text-xl font-extrabold">Turn Gumroad products into Pinterest traffic</h1>
          <p className="text-sm opacity-80">Sync → Analyze → Generate Pins → Approve → Publish. Safe by default.</p>
        </div>
        <Link to="/products" className="btn-accent">✨ Generate Pinterest Content</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(([label, n, to]) => (
          <Link key={label} to={to} className="card text-center hover:shadow">
            <div className="text-2xl font-extrabold">{n}</div>
            <div className="text-xs text-neutral-500">{label}</div>
          </Link>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card">
          <h2 className="font-bold">Today's schedule</h2>
          {data.today.length === 0 && <p className="mt-2 text-sm text-neutral-500">Nothing scheduled today. Approve pins in the Queue to fill the day.</p>}
          {data.today.map((t) => (
            <div key={t.id} className="mt-2 flex justify-between gap-2 text-sm">
              <span className="truncate">{t.title}</span>
              <span className="text-neutral-500">{new Date(t.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h2 className="font-bold">Activity</h2>
          {data.activity.map((a) => (
            <div key={a.id} className="mt-2 text-sm"><span className="mr-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">{a.type}</span>{a.message}</div>
          ))}
          {data.activity.length === 0 && <p className="mt-2 text-sm text-neutral-500">No activity yet — sync your Gumroad store first.</p>}
        </div>
      </div>
    </div>
  );
}
