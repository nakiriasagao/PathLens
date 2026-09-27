package com.pathlens.networkmapper;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.RouteInfo;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.InputStreamReader;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ConnectException;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "NetworkDiagnostics")
public class NetworkDiagnosticsPlugin extends Plugin {
    private static final Pattern LATENCY = Pattern.compile("time[=<]([0-9.]+)\\s*ms", Pattern.CASE_INSENSITIVE);
    private static final Pattern IPV4 = Pattern.compile("((?:\\d{1,3}\\.){3}\\d{1,3})");

    @PluginMethod
    public void trace(final PluginCall call) {
        final String target = call.getString("target", "").trim();
        if (target.isEmpty() || !target.matches("[a-zA-Z0-9.:-]+")) {
            call.reject("请输入有效的 IP 或域名");
            return;
        }
        new Thread(() -> {
            JSObject result = new JSObject();
            result.put("target", target);
            result.put("reachable", false);
            result.put("hops", new JSArray());
            try {
                Process process = new ProcessBuilder("/system/bin/ping", "-c", "1", "-W", "2", target).redirectErrorStream(true).start();
                String output = read(process);
                boolean reachable = process.waitFor(4, TimeUnit.SECONDS) && process.exitValue() == 0;
                result.put("reachable", reachable);
                Matcher latency = LATENCY.matcher(output);
                if (latency.find()) result.put("latency", Double.parseDouble(latency.group(1)));
                Matcher ip = IPV4.matcher(output);
                if (ip.find()) result.put("resolved", ip.group(1));
                result.put("method", "android-ping");
            } catch (Exception error) {
                result.put("error", error.getMessage() == null ? "native probe unavailable" : error.getMessage());
            }
            call.resolve(result);
        }).start();
    }

    @PluginMethod
    public void neighbors(PluginCall call) {
        // /proc/net/arp is a cache, so reading it without first touching the
        // local subnet misses otherwise active devices. Populate it with a
        // bounded parallel scan, then return only entries backed by a MAC.
        new Thread(() -> {
            JSArray neighbors = discoverNeighbors();
            JSObject result = new JSObject();
            result.put("neighbors", neighbors);
            result.put("source", "android-arp-scan");
            call.resolve(result);
        }).start();
    }

    @PluginMethod
    public void network(PluginCall call) {
        JSObject result = new JSObject();
        JSArray interfaces = new JSArray();
        try {
            ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network network = manager.getActiveNetwork();
            LinkProperties properties = manager.getLinkProperties(network);
            if (properties != null) {
                for (LinkAddress address : properties.getLinkAddresses()) {
                    JSObject item = new JSObject();
                    String value = address.getAddress().getHostAddress();
                    item.put("name", properties.getInterfaceName() == null ? "mobile" : properties.getInterfaceName());
                    item.put("address", value);
                    item.put("family", value.contains(":") ? "IPv6" : "IPv4");
                    item.put("netmask", address.getPrefixLength());
                    item.put("internal", false);
                    interfaces.put(item);
                }
                for (RouteInfo route : properties.getRoutes()) {
                    if (route.isDefaultRoute() && route.getGateway() != null) {
                        result.put("gateway", route.getGateway().getHostAddress());
                        break;
                    }
                }
            }
        } catch (Exception error) { result.put("error", error.getMessage()); }
        result.put("hostname", "手机本机");
        result.put("platform", "android");
        result.put("interfaces", interfaces);
        result.put("source", "android-connectivity");
        call.resolve(result);
    }

    private String read(Process process) throws Exception {
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) output.append(line).append('\n');
        }
        return output.toString();
    }

    private static class LocalSubnet {
        final long address;
        final int prefix;
        final String interfaceName;

        LocalSubnet(long address, int prefix, String interfaceName) {
            this.address = address;
            this.prefix = prefix;
            this.interfaceName = interfaceName;
        }
    }

    private LocalSubnet getLocalSubnet() {
        try {
            ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network network = manager.getActiveNetwork();
            LinkProperties properties = manager.getLinkProperties(network);
            if (properties == null) return null;
            for (LinkAddress address : properties.getLinkAddresses()) {
                if (!(address.getAddress() instanceof Inet4Address)) continue;
                long value = ipv4ToLong(address.getAddress().getHostAddress());
                if (value >= 0) return new LocalSubnet(value, address.getPrefixLength(), properties.getInterfaceName() == null ? "LAN" : properties.getInterfaceName());
            }
        } catch (Exception ignored) { }
        return null;
    }

    private JSArray discoverNeighbors() {
        LocalSubnet subnet = getLocalSubnet();
        Set<String> activeHosts = ConcurrentHashMap.newKeySet();
        if (subnet != null) scanSubnet(subnet, activeHosts);
        JSArray neighbors = readArpTable();
        Set<String> knownIps = new LinkedHashSet<>();
        for (int index = 0; index < neighbors.length(); index++) {
            try { knownIps.add(neighbors.getJSONObject(index).getString("ip")); } catch (Exception ignored) { }
        }
        for (String host : activeHosts) {
            if (knownIps.contains(host)) continue;
            JSObject item = new JSObject();
            item.put("ip", host);
            item.put("mac", "—");
            item.put("state", "reachable");
            item.put("interface", subnet == null ? "LAN" : subnet.interfaceName);
            item.put("source", "active-probe");
            neighbors.put(item);
        }
        return neighbors;
    }

    private void scanSubnet(LocalSubnet subnet, Set<String> activeHosts) {
        if (subnet.prefix >= 31) return;
        // A /16 scan is too expensive for a phone. Restrict larger networks to
        // the /24 containing the phone, which is the normal Wi-Fi segment.
        int prefix = Math.max(subnet.prefix, 24);
        long mask = (0xffffffffL << (32 - prefix)) & 0xffffffffL;
        long network = subnet.address & mask;
        long broadcast = network | (~mask & 0xffffffffL);
        List<String> hosts = new ArrayList<>();
        for (long value = network + 1; value < broadcast && hosts.size() < 512; value++) {
            if (value != subnet.address) hosts.add(longToIpv4(value));
        }
        if (hosts.isEmpty()) return;
        ExecutorService executor = Executors.newFixedThreadPool(Math.min(32, hosts.size()));
        for (String host : hosts) executor.submit(() -> touchHost(host, activeHosts));
        executor.shutdown();
        try {
            executor.awaitTermination(6, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } finally {
            executor.shutdownNow();
        }
    }

    private void touchHost(String host, Set<String> activeHosts) {
        try {
            if (InetAddress.getByName(host).isReachable(350)) {
                activeHosts.add(host);
                return;
            }
        } catch (Exception ignored) { }
        // ICMP can be filtered. A TCP connect both discovers hosts exposing a
        // service and covers the desktop PathLens API on port 8787.
        int[] ports = new int[]{8787, 80, 443, 445, 139, 3389, 22, 8080};
        for (int port : ports) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), 120);
                activeHosts.add(host);
                return;
            } catch (SocketTimeoutException ignored) {
                // Continue with the next port.
            } catch (ConnectException refused) {
                // An immediate refusal still proves that the host is present.
                activeHosts.add(host);
                return;
            } catch (Exception ignored) { }
        }
    }

    private JSArray readArpTable() {
        JSArray neighbors = new JSArray();
        try (BufferedReader reader = new BufferedReader(new FileReader("/proc/net/arp"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("IP address") || line.trim().isEmpty()) continue;
                String[] fields = line.trim().split("\\s+");
                if (fields.length < 6 || !fields[0].contains(".")) continue;
                String mac = fields[3].toUpperCase(Locale.ROOT);
                if (!mac.matches("[0-9A-F]{2}(:[0-9A-F]{2}){5}") || mac.matches("00(:00){5}")) continue;
                JSObject item = new JSObject();
                item.put("ip", fields[0]);
                item.put("mac", mac);
                item.put("state", fields[2].equalsIgnoreCase("0x2") ? "reachable" : "stale");
                item.put("interface", fields[5]);
                neighbors.put(item);
            }
        } catch (Exception ignored) { }
        return neighbors;
    }

    private long ipv4ToLong(String value) {
        String[] parts = value.split("\\.");
        if (parts.length != 4) return -1;
        long result = 0;
        try {
            for (String part : parts) {
                int octet = Integer.parseInt(part);
                if (octet < 0 || octet > 255) return -1;
                result = (result << 8) | octet;
            }
        } catch (NumberFormatException error) {
            return -1;
        }
        return result;
    }

    private String longToIpv4(long value) {
        return ((value >> 24) & 255) + "." + ((value >> 16) & 255) + "." + ((value >> 8) & 255) + "." + (value & 255);
    }
}
