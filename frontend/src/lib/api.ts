export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) };
  if (opts.body !== undefined && opts.body !== null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON from ${path}`);
  }
  if (!res.ok) {
    const msg = (json as { error?: string })?.error || `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number; duplicate?: unknown };
    err.status = res.status;
    err.duplicate = (json as { duplicate?: unknown })?.duplicate;
    throw err;
  }
  return json as T;
}

export function imgUrl(pinId: string): string {
  return `/api/pins/${pinId}/image?t=${Date.now()}`;
}

export function statusColor(s: string): string {
  switch (s) {
    case 'published': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'scheduled': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'approved': return 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200';
    case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'publishing': return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
    default: return 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200';
  }
}
