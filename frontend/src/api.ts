import type { Envelope } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}
export function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  const result = params.toString();
  return result ? `?${result}` : '';
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 20000);
  try {
    const response = await fetch(`/api/v1${path}`, {
      ...init, signal: controller.signal, credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
    let body: unknown;
    try { body = await response.json(); } catch { throw new ApiError(response.status, '服务未返回有效数据，请重试。'); }
    if (!response.ok) {
      const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
      throw new ApiError(response.status, typeof detail === 'string' ? detail : `请求失败（HTTP ${response.status}）。`);
    }
    if (!body || typeof body !== 'object' || !('data' in body) || !('meta' in body) || !body.meta || typeof body.meta !== 'object' || !('version' in body.meta) || body.meta.version !== '1') throw new ApiError(response.status, '数据格式不符，未回退本地资料。');
    return body as Envelope<T>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, controller.signal.aborted ? '读取超时，请重试。' : '暂时无法连接数据服务，请重试。');
  } finally { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort); }
}
export function post<T>(path: string, body?: unknown): Promise<Envelope<T>> {
  return api<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
export function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : undefined; } catch { return undefined; }
}
export function dateTime(value: string | null | undefined): string {
  if (!value) return '时间未提供';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间无效' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(date);
}
