import { Capacitor } from '@capacitor/core';
export const isIOS = Capacitor.getPlatform() === 'ios';
type StorageHandle = { plugin: typeof import('@aparajita/capacitor-secure-storage').SecureStorage };
let ready: Promise<StorageHandle> | undefined;
const storageTimeoutMs = 10000;
function withTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Keychain operation timed out')), storageTimeoutMs);
    operation.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
async function storage(): Promise<StorageHandle> {
  if (!isIOS) throw new Error('Keychain is iOS-only; web storage is forbidden');
  ready ??= withTimeout(import('@aparajita/capacitor-secure-storage').then(async ({ SecureStorage }) => {
    await SecureStorage.setKeyPrefix('ytrader_');
    await SecureStorage.setSynchronize(false);
    // Never resolve with the Capacitor proxy: its dynamic `then` method makes it a thenable.
    return { plugin: SecureStorage };
  })).catch(error => {
    ready = undefined; // A failed or timed-out initialization may be retried.
    throw error;
  });
  return ready;
}
export async function restoreToken(): Promise<string | null> {
  if (!isIOS) return null; // NEVER invoke the plugin's unencrypted web implementation.
  const { plugin } = await storage();
  const value = await withTimeout(plugin.get('session',false,false));
  if (value === null) return null;
  if (typeof value !== 'string') { await clearToken(); throw new Error('Invalid Keychain session type'); }
  return value;
}
export async function saveToken(token: string) {
  if (!isIOS) throw new Error('Cannot store web session tokens');
  const { plugin } = await storage();
  await withTimeout(plugin.set('session',token,false,false));
}
export async function clearToken() {
  if (isIOS) {
    const { plugin } = await storage();
    await withTimeout(plugin.remove('session',false));
  }
}
