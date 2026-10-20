import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { useAction, useApi } from './hooks';
import { ErrorBox } from './components';

interface WatchState { symbols: string[]; ready: boolean; busy: boolean; error: string | null; toggle: (symbol: string) => void; reload: () => void }
const WatchContext = createContext<WatchState>({ symbols: [], ready: false, busy: false, error: null, toggle: () => {}, reload: () => {} });
export function WatchProvider({ children }: { children: ReactNode }) {
  const result = useApi<string[]>('/watchlist');
  const [symbols, setSymbols] = useState<string[]>([]);
  const action = useAction();
  useEffect(() => { if (result.data) setSymbols(result.data); }, [result.data]);
  function toggle(symbol: string) {
    if (!result.data) return;
    void action.run(async () => {
      const next = symbols.includes(symbol) ? symbols.filter(value => value !== symbol) : [...symbols, symbol];
      const response = await api<string[]>('/watchlist', { method: 'PUT', body: JSON.stringify({ symbols: next }) });
      setSymbols(response.data);
    });
  }
  return <WatchContext.Provider value={{ symbols, ready: result.data !== undefined, busy: action.busy, error: action.error || result.error, toggle, reload: result.reload }}>{children}</WatchContext.Provider>;
}
export function useWatchlist() { return useContext(WatchContext); }
export function WatchButton({ symbol }: { symbol: string }) {
  const watch = useWatchlist();
  const selected = watch.symbols.includes(symbol);
  return <button type="button" aria-pressed={selected} disabled={!watch.ready || watch.busy} onClick={() => watch.toggle(symbol)}>{!watch.ready ? '关注列表待加载' : watch.busy ? '正在保存…' : selected ? '取消关注' : '关注证券'}</button>;
}
export function WatchError() { const watch = useWatchlist(); return <ErrorBox message={watch.error} retry={watch.reload} />; }
