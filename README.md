# PathLens · 网络路径观测器

一个移动端优先的网络诊断 PWA / Capacitor App。输入 IP 或域名后，服务端会调用操作系统的 `tracert` / `traceroute`，并用 IP 地理信息补充每一跳；前端使用高德地图 JS API 展示世界范围的路径，同时提供本机网卡、默认网关、拓扑关系和 ARP 邻居设备视图。

## 启动

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。生产预览可先运行 `npm run build`，再运行 `npm start` 并访问 `http://localhost:8787`。

## 安装到手机

项目已经加入 Capacitor Android 工程，手机端不需要 Node.js 即可运行打包后的界面。

1. 安装 Android Studio、Android SDK 和 JDK 17。
2. 在项目目录执行：

   ```bash
   npm install
   npm run build
   npx cap copy android
   npx cap open android
   ```

   `mobile:android` 会打开 Android Studio；连接手机并开启 USB 调试后，可以直接运行，或在 Android Studio 的 `Build > Build APK(s)` 生成 APK。
3. 也可以使用命令行构建 Debug APK：

   ```bash
   cd android
   # 当前工程使用 JDK 20 运行 Gradle（源码按 Java 17 兼容性编译）
   $env:JAVA_HOME = 'C:\Program Files\Java\jdk-20'
   $env:Path = "$env:JAVA_HOME\bin;$env:Path"
   .\gradlew.bat assembleDebug
   ```

   APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

手机独立模式下无需 Node.js：应用会直接调用 Globalping 远程 traceroute API，并在手机端通过原生 ping 校正目标连通性；高德地图只显示在线地图，加载期间会显示进度条。局域网拓扑和邻居设备由 Android 原生网络模块读取并扫描。若需要优先使用自建探测服务，可在构建前设置 `VITE_API_BASE_URL`，例如 `http://192.168.1.10:8787`，让手机访问局域网中的 PathLens API。

macOS 上可以执行 `npx cap add ios` 后，用 Xcode 打开 `ios/App/App.xcworkspace` 进行签名和安装。

当前目录已生成可直接安装的 Debug APK：`PathLens-debug.apk`。如需重新生成，可执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-standalone-apk.ps1
```

## 说明

- 高德地图 Key 已配置在 `src/WorldMap.jsx` 的 `AMAP_KEY` 常量中，也可通过 `VITE_AMAP_KEY` 覆盖。
- Windows 使用 `tracert`、`route` 和 `arp`；Linux/macOS 使用 `traceroute`、`ip route` 和 `arp`。
- 高德地图加载失败时会明确显示错误和重试按钮，不会伪造离线地图。
- 邻居设备来自 Android 原生 ARP / 活跃探测；桌面端服务则使用系统 ARP 表并主动刷新局域网缓存。
