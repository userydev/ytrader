function exactOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value && value !== 'capacitor://localhost') throw new Error('Origins must be exact origins, without trailing slash');
  return value;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const devInsecure = env.DEV_INSECURE_LOCALHOST === 'true';
  const host = env.API_HOST ?? '127.0.0.1';
  const webOrigin = exactOrigin(env.WEB_ORIGIN ?? 'http://127.0.0.1:5173');
  const nativeOrigin = exactOrigin(env.NATIVE_ORIGIN ?? 'capacitor://localhost');
  if (devInsecure && (env.NODE_ENV === 'production' || !['127.0.0.1', '::1'].includes(host) || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(webOrigin).hostname))) {
    throw new Error('Insecure cookie mode is permitted only on explicit loopback development');
  }
  if (!devInsecure && !webOrigin.startsWith('https://')) throw new Error('WEB_ORIGIN must use HTTPS (or explicitly enable loopback dev mode)');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const ycoreUrl = env.YCORE_URL;
  if (ycoreUrl && !/^https?:\/\//.test(ycoreUrl)) throw new Error('Invalid YCORE_URL');
  if (ycoreUrl && new URL(ycoreUrl).protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(ycoreUrl).hostname)) throw new Error('ycore requires TLS outside loopback');
  return { databaseUrl: env.DATABASE_URL, host, port: Number(env.API_PORT ?? 3001), webOrigin, nativeOrigin,
    secureCookie: !devInsecure, ycoreUrl, ycoreToken: env.YCORE_TOKEN,
    modelEnabled: env.MODEL_ENABLED === 'true', modelPolicy: env.YCORE_MODEL_POLICY ?? 'gemini-2.5-flash' };
}
export type Config = ReturnType<typeof loadConfig>;
