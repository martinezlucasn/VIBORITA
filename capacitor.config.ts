import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.viborita.app',
  appName: 'Viborita',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
