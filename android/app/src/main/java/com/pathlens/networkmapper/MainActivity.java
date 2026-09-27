package com.pathlens.networkmapper;

import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private int systemBarDimension(String name) {
        int resourceId = getResources().getIdentifier(name, "dimen", "android");
        return resourceId == 0 ? 0 : getResources().getDimensionPixelSize(resourceId);
    }

    private void applyWebViewInsets(View webView, int left, int top, int right, int bottom) {
        ViewGroup.LayoutParams rawParams = webView.getLayoutParams();
        if (rawParams instanceof ViewGroup.MarginLayoutParams) {
            ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) rawParams;
            params.leftMargin = left;
            params.topMargin = top;
            params.rightMargin = right;
            params.bottomMargin = bottom;
            webView.setLayoutParams(params);
        }
        // Keep padding as a fallback for WebView containers that do not expose
        // margin layout params (for example, a custom Capacitor host view).
        webView.setPadding(0, 0, 0, 0);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NetworkDiagnosticsPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 15/16 enforces edge-to-edge for apps targeting recent SDKs.
        // Capacitor deliberately lets the WebView draw behind the system bars,
        // so apply the actual system-bar insets to the WebView itself. This
        // keeps the first row of the web UI (the top bar) below the status bar
        // on devices where CSS env(safe-area-inset-top) is zero.
        getWindow().setStatusBarColor(Color.rgb(7, 17, 30));
        getWindow().setNavigationBarColor(Color.rgb(7, 17, 30));
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setAppearanceLightNavigationBars(false);

        View webView = getBridge().getWebView();
        final int fallbackStatusBar = systemBarDimension("status_bar_height");
        final int fallbackNavigationBar = systemBarDimension("navigation_bar_height");

        // Android 16 can dispatch a zero top inset to an edge-to-edge WebView
        // even while the status bar is visible. Set the resource-derived value
        // first so the first frame is safe, then refine it from real insets.
        applyWebViewInsets(webView, 0, fallbackStatusBar, 0, fallbackNavigationBar);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets systemBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());

            int topInset = Math.max(systemBars.top, fallbackStatusBar);
            int bottomInset = Math.max(systemBars.bottom, fallbackNavigationBar);

            applyWebViewInsets(
                view,
                systemBars.left,
                topInset,
                systemBars.right,
                keyboardVisible ? 0 : bottomInset
            );
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
