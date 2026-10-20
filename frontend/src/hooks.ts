import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import type { Envelope } from './types';

export function useApi<T>(path: string | null, pollMs = 0) {
  const [result, setResult] = useState<{ path: string; value: Envelope<T> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!path) { setLoading(false); setError(null); return; }
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    async function load() {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const value = await api<T>(path!, { signal: controller.signal });
        if (active) { setResult({ path: path!, value }); setError(null); }
      } catch (err) { if (active && !controller.signal.aborted) setError(errorMessage(err)); }
      finally { if (active) setLoading(false); inFlight = false; }
    }
    setError(null);
    void load();
    const timer = pollMs ? window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, pollMs) : undefined;
    return () => { active = false; controller.abort(); if (timer !== undefined) window.clearInterval(timer); };
  }, [path, revision, pollMs]);
  return { data: result?.path === path ? result.value.data : undefined, meta: result?.path === path ? result.value.meta : undefined, error, loading, reload };
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = useRef(false);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (err) { setError(errorMessage(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  return { busy, error, notice, setNotice, run };
}
