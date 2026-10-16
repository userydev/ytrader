import { CapacitorHttp } from '@capacitor/core';
import { clearToken, isIOS, restoreToken, saveToken } from './vault';
let nativeToken: string | null = null;
let csrf: string | null = null;
let authenticated = false;
export let storageWarning = '';
const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/,'');
// Opt-in simulator-only build: loopback cannot address a production service.
const loopbackPreview = import.meta.env.VITE_NATIVE_LOOPBACK_PREVIEW === 'true' && /^http:\/\/127\.0\.0\.1:\d+$/.test(base);
const nativeConfigError = isIOS && (!base || (!base.startsWith('https://') && !loopbackPreview));
export class RequestError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export async function initializeAuth() {
  if (isIOS) try { nativeToken = await restoreToken(); } catch { storageWarning = '安全存储暂不可用。登录后会话仅保留在本次运行的内存中，不会保存到网页存储。'; }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (nativeConfigError) throw new RequestError(503,'NOT_CONFIGURED','应用尚未配置安全服务地址，请完成原生接线后重试。');
  const headers: Record<string,string> = { 'Content-Type': 'application/json' };
  if (isIOS) { headers.Origin = 'capacitor://localhost'; if (nativeToken) headers.Authorization = `Bearer ${nativeToken}`; }
  else if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let status: number; let data: any;
  try {
    if (isIOS) {
      const result = await CapacitorHttp.request({ url: `${base}/api/v1${path}`, method, headers, data: body, connectTimeout: 15000, readTimeout: 20000, disableRedirects: true });
      status = result.status; data = result.data;
      if (typeof data === 'string' && data) data = JSON.parse(data);
    } else {
      const response = await fetch(`${base}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000), redirect: 'error' });
      status = response.status; data = response.status === 204 ? null : await response.json();
    }
  } catch { throw new RequestError(0,'OFFLINE','连接失败。请检查网络后重试；当前页面不会自动更新更正。'); }
  if (status === 401) {
    const hadSession = authenticated || Boolean(nativeToken);
    authenticated = false;
    nativeToken = null; csrf = null;
    try { await clearToken(); } catch { storageWarning = '无法清除本机安全存储，请重试退出；服务器会话需重新验证。'; }
    if (hadSession) window.dispatchEvent(new CustomEvent('auth-expired'));
  }
  if (status < 200 || status >= 300) throw new RequestError(status,data?.error?.code ?? 'UNAVAILABLE',data?.error?.message ?? '暂不可用，请重试');
  return data as T;
}
export async function session() {
  const result = await api<{ csrf_token?: string }>('/auth/session'); csrf = result.csrf_token ?? null; authenticated = true;
}
export async function devSession() {
  const result = await api<{ csrf_token?: string; session_token?: string }>('/auth/dev-session');
  csrf = result.csrf_token ?? null;
  authenticated = true;
  if (isIOS && result.session_token) {
    nativeToken = result.session_token;
  }
}
export async function login(password: string) {
  const result = await api<{ session_token?: string; csrf_token?: string }>('/auth/login','POST',{ password, client: isIOS ? 'ios' : 'web' });
  csrf = result.csrf_token ?? null; authenticated = true;
  if (isIOS && result.session_token) {
    nativeToken = result.session_token;
    try { await saveToken(nativeToken); } catch { storageWarning = '安全存储不可用：会话仅存在本次运行内存，关闭应用后需重新登录。'; }
  }
}
export async function logout() {
  // Do not claim successful logout on a network failure: the server session may still be live.
  await api('/auth/logout','POST');
  nativeToken = null; csrf = null; authenticated = false;
  try { await clearToken(); } catch { storageWarning = '服务端已退出，但本机安全存储清理失败；旧令牌已失效。'; }
}
