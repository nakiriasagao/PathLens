import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.pathlens.networkmapper',
  appName: 'PathLens 网络路径观测器',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SystemBars: {
      style: 'DARK',
      insetsHandling: 'native'
    }
  }
}

export default config
