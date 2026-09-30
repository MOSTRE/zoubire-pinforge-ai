import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

const links = [
  ['/', 'Dashboard'],
  ['/products', 'Products'],
  ['/studio', 'AI Studio'],
  ['/pins', 'Pins'],
  ['/queue', 'Queue'],
  ['/published', 'Published'],
  ['/boards', 'Boards'],
  ['/analytics', 'Analytics'],
  ['/settings', 'Settings'],
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(() => localStorage.getItem('pf-theme') === 'dark');
  const [setupDone, setSetupDone] = useState(() => localStorage.getItem('pf-setup') === 'done');
  const loc = useLocation();
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('pf-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <div className="min-h-screen">
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-neutral-200 p-4 dark:border-neutral-800 md:flex">
          <div className="mb-6 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 font-black text-white dark:bg-white dark:text-neutral-900">P</div>
            <div>
              <div className="font-extrabold leading-none">PinForge AI</div>
              <div className="text-xs text-neutral-500">Gumroad → Pinterest</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} className={({ isActive }) => `rounded-xl px-3 py-2 text-sm font-medium ${isActive ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-2">
            <button className="btn-ghost" onClick={() => setDark(!dark)}>{dark ? '☀ Light' : '🌙 Dark'}</button>
            <a className="btn-primary" href={loc.pathname === '/' ? '#generate' : '/'}>✨ Generate Pinterest Content</a>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="font-extrabold md:hidden">PinForge AI</span>
              <div className="ml-auto flex items-center gap-2">
                {!setupDone && <a href="/settings#setup" className="badge bg-amber-100 text-amber-800">First-run setup</a>}
                <button className="btn-ghost md:hidden" onClick={() => setDark(!dark)}>{dark ? '☀' : '🌙'}</button>
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
              {links.map(([to, label]) => (
                <NavLink key={to} to={to} className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${isActive ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'bg-neutral-100 dark:bg-neutral-800'}`}>{label}</NavLink>
              ))}
            </nav>
          </header>
          <main className="mx-auto max-w-6xl p-4">{children}</main>
        </div>
      </div>
      {!setupDone && <SetupWizard onDone={() => { setSetupDone(true); localStorage.setItem('pf-setup', 'done'); }} />}
    </div>
  );
}

function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const steps = ['Gumroad store', 'Ollama AI', 'Image generator', 'Pinterest', 'Publishing mode', 'Sync products'];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-lg">
        <h2 className="text-lg font-extrabold">Welcome to PinForge AI — setup ({step + 1}/6)</h2>
        <p className="mt-1 text-sm text-neutral-500">{steps[step]}</p>
        <div className="mt-4 text-sm">
          {step === 0 && <p>Store URL is pre-filled: <b>https://zoubire.gumroad.com</b>. Change it later in Settings → Gumroad.</p>}
          {step === 1 && <p>Install Ollama from ollama.com, pull a model (e.g. <code>ollama pull llama3.1</code>), then set it in Settings → AI. The app works with a built-in fallback if Ollama is offline.</p>}
          {step === 2 && <p>Images work out of the box (built-in renderer). Optionally install ComfyUI and set COMFYUI_URL for AI-generated scenes.</p>}
          {step === 3 && <p>Create a Pinterest developer app, set the redirect URI to <code>http://localhost:3000/api/pinterest/oauth/callback</code>, paste the ID/secret in Settings → Pinterest, then Connect.</p>}
          {step === 4 && <p>Default is <b>Manual approval</b> (safe). Switch to Automatic only when you trust the queue.</p>}
          {step === 5 && <p>Go to Products and click <b>Sync Gumroad</b> to discover your live catalog.</p>}
        </div>
        <div className="mt-4 flex justify-between">
          <button className="btn-ghost" onClick={onDone}>Skip</button>
          <div className="flex gap-2">
            {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
            {step < 5 ? <button className="btn-primary" onClick={() => setStep(step + 1)}>Next</button> : <button className="btn-accent" onClick={onDone}>Finish → Sync products</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
