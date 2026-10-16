import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.ytrader.reader', appName: 'ytrader', webDir: 'dist',
  ios: { contentInset: 'automatic' },
  server: { iosScheme: 'capacitor', hostname: 'localhost' }
};
export default config;
