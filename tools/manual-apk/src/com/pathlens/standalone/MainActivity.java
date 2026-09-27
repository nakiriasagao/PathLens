package com.pathlens.standalone;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.ConsoleMessage;
import android.content.Context;
import android.graphics.Color;
import android.util.Log;
import android.os.Build;
import android.view.Window;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.RouteInfo;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileReader;
import java.io.InputStream;
import java.net.InetAddress;
import java.util.Locale;

public final class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(7, 17, 30));
        window.setNavigationBarColor(Color.rgb(7, 17, 30));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true);
        WebView webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(true);
        webView.setBackgroundColor(Color.rgb(7, 17, 30));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.setWebViewClient(new AssetWebViewClient(getAssets()));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.e("PathLensWeb", message.message() + " @" + message.sourceId() + ":" + message.lineNumber());
                return true;
            }
        });
        webView.addJavascriptInterface(new NativeBridge(this), "PathLensNative");
        try {
            InputStream index = getAssets().open("index.html");
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int count;
            while ((count = index.read(chunk)) != -1) buffer.write(chunk, 0, count);
            index.close();
            webView.loadDataWithBaseURL("https://appassets.androidplatform.net/assets/", buffer.toString("UTF-8"), "text/html", "UTF-8", "https://appassets.androidplatform.net/assets/index.html");
        } catch (Exception error) {
            Log.e("PathLensWeb", "index load failed", error);
            webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        }
        setContentView(webView);
    }

    @Override
    public void onBackPressed() {
        WebView webView = (WebView) findViewById(android.R.id.content).getRootView().findFocus();
        if (webView instanceof WebView && ((WebView) webView).canGoBack()) ((WebView) webView).goBack();
        else super.onBackPressed();
    }

    private static final class AssetWebViewClient extends WebViewClient {
        private final android.content.res.AssetManager assets;

        AssetWebViewClient(android.content.res.AssetManager assets) {
            this.assets = assets;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            Log.e("PathLensWeb", "page started: " + url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            Log.e("PathLensWeb", "page finished: " + url);
        }

        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            Log.e("PathLensWeb", "page error " + errorCode + ": " + description + " " + failingUrl);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String host = request.getUrl().getHost();
            String path = request.getUrl().getPath();
            if (!"appassets.androidplatform.net".equals(host) || path == null || !path.startsWith("/assets/")) {
                return super.shouldInterceptRequest(view, request);
            }
            String assetPath = path.substring("/assets/".length());
            try {
                InputStream stream = assets.open(assetPath);
                String mime = mimeType(assetPath);
                return new WebResourceResponse(mime, "UTF-8", stream);
            } catch (Exception ignored) {
                Log.e("PathLensWeb", "asset missing: " + assetPath);
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
            }
        }

        private static String mimeType(String path) {
            if (path.endsWith(".js")) return "application/javascript";
            if (path.endsWith(".css")) return "text/css";
            if (path.endsWith(".html")) return "text/html";
            if (path.endsWith(".webmanifest")) return "application/manifest+json";
            if (path.endsWith(".json")) return "application/json";
            return "application/octet-stream";
        }
    }

    public static final class NativeBridge {
        private final Context context;

        NativeBridge(Context context) { this.context = context; }

        @JavascriptInterface
        public String trace(String target) {
            try {
                long started = System.nanoTime();
                InetAddress address = InetAddress.getByName(target);
                boolean reachable = address.isReachable(3000);
                double latency = (System.nanoTime() - started) / 1_000_000.0;
                return "{\"method\":\"android-webview\",\"target\":" + quote(target) + ",\"resolved\":" + quote(address.getHostAddress()) + ",\"reachable\":" + reachable + ",\"latency\":" + String.format(Locale.US, "%.1f", latency) + "}";
            } catch (Exception error) {
                return "{\"method\":\"android-webview\",\"target\":" + quote(target) + ",\"reachable\":false,\"error\":" + quote(error.getMessage()) + "}";
            }
        }

        @JavascriptInterface
        public String network() {
            StringBuilder result = new StringBuilder("{\"hostname\":\"手机本机\",\"platform\":\"android\",\"gateway\":\"\",\"interfaces\":[");
            try {
                ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
                Network active = manager.getActiveNetwork();
                LinkProperties properties = manager.getLinkProperties(active);
                boolean first = true;
                if (properties != null) {
                    for (LinkAddress link : properties.getLinkAddresses()) {
                        String address = link.getAddress().getHostAddress();
                        if (!first) result.append(',');
                        result.append("{\"name\":").append(quote(properties.getInterfaceName() == null ? "mobile" : properties.getInterfaceName()))
                            .append(",\"address\":").append(quote(address)).append(",\"family\":").append(quote(address.contains(":") ? "IPv6" : "IPv4"))
                            .append(",\"netmask\":").append(link.getPrefixLength()).append(",\"internal\":false}");
                        first = false;
                    }
                    for (RouteInfo route : properties.getRoutes()) {
                        if (route.isDefaultRoute() && route.getGateway() != null) {
                            result.append("],\"gateway\":").append(quote(route.getGateway().getHostAddress())).append('}');
                            return result.toString();
                        }
                    }
                }
            } catch (Exception ignored) { }
            return result.append("],\"gateway\":\"\"}").toString();
        }

        @JavascriptInterface
        public String neighbors() {
            StringBuilder result = new StringBuilder("{\"source\":\"android-arp\",\"neighbors\":[");
            boolean first = true;
            try (BufferedReader reader = new BufferedReader(new FileReader("/proc/net/arp"))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.startsWith("IP address") || line.trim().isEmpty()) continue;
                    String[] fields = line.trim().split("\\s+");
                    if (fields.length < 6 || !fields[0].contains(".")) continue;
                    if (!first) result.append(',');
                    result.append("{\"ip\":").append(quote(fields[0])).append(",\"mac\":").append(quote(fields[3].toUpperCase(Locale.ROOT)))
                        .append(",\"state\":").append(quote(fields[2].equalsIgnoreCase("0x2") ? "reachable" : "stale"))
                        .append(",\"interface\":").append(quote(fields[5])).append('}');
                    first = false;
                }
            } catch (Exception ignored) { }
            return result.append("]}").toString();
        }

        private static String quote(String value) {
            if (value == null) return "\"\"";
            return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\"";
        }
    }
}
