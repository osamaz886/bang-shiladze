import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bang.shiladze',
  appName: 'Bang',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#060E24',
  },
};

export default config;
