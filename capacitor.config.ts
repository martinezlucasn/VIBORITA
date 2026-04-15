import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.viborita.app',
  appName: 'Viborita',
  webDir: 'dist',
  server: {
    url: 'https://ais-pre-q3rghkaneiw6ol5cicebm3-79875930852.us-east1.run.app',
    cleartext: true
  }
};

export default config;
