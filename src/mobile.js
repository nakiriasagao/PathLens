import { Capacitor, registerPlugin } from '@capacitor/core'
import { Network } from '@capacitor/network'

const manualNative = typeof window.PathLensNative !== 'undefined'
export const isNativeApp = Capacitor.isNativePlatform() || manualNative
export const isStandaloneBrowser = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const configuredApi = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const NativeDiagnostics = registerPlugin('NetworkDiagnostics')

const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/

async function enrichRemoteHop(hop, signal, context = {}) {
  if (!hop.ip) return { ...hop, city: '未知节点', region: '—', country: '—', isp: '未响应', asn: '—', lat: null, lng: null }
  // Globalping's first hop is the probe's egress gateway. Its address is
  // often an infrastructure or CGNAT address whose public IP database entry
  // points to an unrelated country. Use the probe's verified city instead of
  // presenting that lookup as the phone's local gateway.
  if (context.isProbeGateway && context.probe?.latitude && context.probe?.longitude) {
    return {
      ...hop,
      city: context.probe.city || '远程探针',
      region: context.probe.region || context.probe.state || '—',
      country: context.probe.country || '—',
      isp: context.probe.network ? `远程探针 · ${context.probe.network}` : '远程探针网关',
      asn: context.probe.asn ? `AS${context.probe.asn}` : '—',
      lat: context.probe.latitude,
      lng: context.probe.longitude,
      locationSource: 'probe'
    }
  }
  if (privateAddress.test(hop.ip)) return { ...hop, city: '本地网络', region: 'Private', country: 'LAN', isp: 'Private network', asn: 'RFC1918', lat: null, lng: null, locationSource: 'private-network' }
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(hop.ip)}`, { signal })
    const data = await response.json()
    if (data.success === false) throw new Error('lookup failed')
    return { ...hop, city: data.city || '—', region: data.region || '—', country: data.country || '—', isp: data.connection?.org || data.connection?.isp || '—', asn: data.connection?.asn ? `AS${data.connection.asn}` : '—', lat: data.latitude ?? null, lng: data.longitude ?? null }
  } catch {
    return { ...hop, city: '未知节点', region: '—', country: '—', isp: 'Lookup unavailable', asn: '—', lat: null, lng: null }
  }
}

async function globalpingTrace(target, signal) {
  const createResponse = await fetch('https://api.globalping.io/v1/measurements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'traceroute', target, locations: [{ country: import.meta.env.VITE_GLOBALPING_COUNTRY || 'CN' }] }),
    signal
  })
  if (!createResponse.ok) throw new Error('Globalping unavailable')
  const created = await createResponse.json()
  if (!created.id) throw new Error('Globalping did not return a measurement id')
  let measurement
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 400 : 900))
    const response = await fetch(`https://api.globalping.io/v1/measurements/${encodeURIComponent(created.id)}`, { signal })
    if (!response.ok) throw new Error('Globalping measurement failed')
    measurement = await response.json()
    if (measurement.status === 'finished' || measurement.status === 'failed' || measurement.status === 'error') break
  }
  const remoteResult = measurement?.results?.[0]?.result
  if (measurement?.status !== 'finished' || remoteResult?.status !== 'finished' || !Array.isArray(remoteResult.hops) || !remoteResult.hops.length) throw new Error('Globalping returned no hops')
  const hops = remoteResult.hops.map((item, index) => {
    const timings = (item.timings || []).map((timing) => Number(timing.rtt)).filter(Number.isFinite)
    const ip = item.resolvedAddress || null
    return { hop: index + 1, ip, hostname: item.resolvedHostname || ip || 'Request timed out', latency: timings.length ? Math.round(timings.reduce((sum, value) => sum + value, 0) / timings.length) : null, status: ip ? 'ok' : 'timeout' }
  })
  const resolved = remoteResult.resolvedAddress || target
  const lastRespondingHop = [...hops].reverse().find((hop) => hop.ip)
  const probe = measurement.results[0]?.probe || null
  const enriched = await Promise.all(hops.map((hop, index) => enrichRemoteHop(hop, signal, { probe, isProbeGateway: index === 0 && Boolean(hop.ip) })))
  return { target, resolved, source: 'globalping-traceroute', provider: 'Globalping', probe, reachable: Boolean(lastRespondingHop && lastRespondingHop.ip === resolved), hops: enriched }
}

export async function requestApi(path, options) {
  const response = await fetch(`${configuredApi}${path}`, options)
  return response
}

export async function requestTrace(target, signal) {
  // The local/remote PathLens API gives enriched hops first. A short local
  // timeout keeps a standalone phone responsive when that server is offline.
  const localController = new AbortController()
  const localTimeout = setTimeout(() => localController.abort(), 2500)
  try {
    const response = await requestApi('/api/trace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }), signal: localController.signal })
    if (response.ok) {
      const data = await response.json()
      if (data?.hops?.length) return data
    }
  } catch { /* Use the direct public traceroute API below. */ }
  finally { clearTimeout(localTimeout) }
  return globalpingTrace(target, signal)
}

export async function getMobileNetworkStatus() {
  if (!isNativeApp) return { connected: navigator.onLine, connectionType: navigator.onLine ? 'unknown' : 'none' }
  return Network.getStatus()
}

export async function getPublicIpLocation() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch('https://ipwho.is/', { signal: controller.signal })
    if (!response.ok) throw new Error('location lookup failed')
    const data = await response.json()
    if (data?.success === false || !Number.isFinite(Number(data?.latitude)) || !Number.isFinite(Number(data?.longitude))) throw new Error('location unavailable')
    return {
      ip: data.ip || null,
      city: data.city || '—',
      region: data.region || '—',
      country: data.country || '—',
      lat: Number(data.latitude),
      lng: Number(data.longitude),
      isp: data.connection?.org || data.connection?.isp || '—',
      asn: data.connection?.asn ? `AS${data.connection.asn}` : '—',
      source: 'ipwho.is'
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function nativeTrace(target) {
  if (!isNativeApp) throw new Error('native diagnostics unavailable')
  if (manualNative) return JSON.parse(window.PathLensNative.trace(target))
  return NativeDiagnostics.trace({ target })
}

export async function nativeNetwork() {
  if (!isNativeApp) throw new Error('native diagnostics unavailable')
  if (manualNative) return JSON.parse(window.PathLensNative.network())
  return NativeDiagnostics.network()
}

export async function nativeNeighbors() {
  if (!isNativeApp) throw new Error('native diagnostics unavailable')
  if (manualNative) return JSON.parse(window.PathLensNative.neighbors())
  return NativeDiagnostics.neighbors()
}

export function registerOfflineShell() {
  if ('serviceWorker' in navigator && !isNativeApp) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined))
}
