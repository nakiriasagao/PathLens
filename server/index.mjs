import express from 'express'
import os from 'node:os'
import dns from 'node:dns/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const app = express()
const PORT = Number(process.env.PORT || 8787)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use(express.json())
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

const demoHops = [
  { ip: '192.168.1.1', hostname: 'home-gateway', latency: 2, status: 'ok', city: '本地网络', region: 'Local', country: 'LAN', isp: 'Local gateway', asn: 'AS-LAN', lat: 22.3193, lng: 114.1694 },
  { ip: '10.24.0.1', hostname: 'edge-01', latency: 8, status: 'ok', city: '香港', region: 'Hong Kong', country: '中国香港', isp: 'Edge Network', asn: 'AS6453', lat: 22.3193, lng: 114.1694 },
  { ip: '203.0.113.17', hostname: 'hk-core-01', latency: 19, status: 'ok', city: '新加坡', region: 'Singapore', country: 'Singapore', isp: 'Transit Asia', asn: 'AS2914', lat: 1.3521, lng: 103.8198 },
  { ip: '203.0.113.65', hostname: 'sea-backbone', latency: 41, status: 'ok', city: '东京', region: 'Tokyo', country: 'Japan', isp: 'Global Transit', asn: 'AS3356', lat: 35.6762, lng: 139.6503 },
  { ip: '198.51.100.12', hostname: 'us-west-edge', latency: 76, status: 'ok', city: '旧金山', region: 'California', country: 'United States', isp: 'Cloud Backbone', asn: 'AS7018', lat: 37.7749, lng: -122.4194 },
  { ip: '8.8.8.8', hostname: 'dns.google', latency: 81, status: 'ok', city: '山景城', region: 'California', country: 'United States', isp: 'Google LLC', asn: 'AS15169', lat: 37.4056, lng: -122.0775 }
]

function runCommand(command, args, timeout = 23000) {
  return execFileAsync(command, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 3 })
}

function parseTrace(output) {
  const hops = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    if (!match) continue
    const hop = Number(match[1])
    if (hop > 32) continue
    const body = match[2]
    const ip = (body.match(/(?:\[)?((?:\d{1,3}\.){3}\d{1,3})(?:\])?/) || [])[1] || null
    const values = [...body.matchAll(/(<\s*1|\d+)\s*ms/gi)].map((m) => m[1].replace(/\s/g, '') === '<1' ? 1 : Number(m[1]))
    const timeout = /timed out|超时|\*/i.test(body)
    hops.push({ hop, ip, hostname: ip || 'Request timed out', latency: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null, status: timeout && !ip ? 'timeout' : 'ok' })
  }
  return hops
}

function isIpv4(value) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(value || ''))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function probeReachability(target) {
  const command = process.platform === 'win32' ? 'ping' : 'ping'
  const args = process.platform === 'win32' ? ['-n', '1', '-w', '2500', target] : ['-c', '1', '-W', '2', target]
  try {
    const result = await runCommand(command, args, 5000)
    return /ttl[=<>]|bytes from|time[=<]/i.test(`${result.stdout}\n${result.stderr}`)
  } catch (error) {
    return /ttl[=<>]|bytes from|time[=<]/i.test(`${error.stdout || ''}\n${error.stderr || ''}`)
  }
}

async function enrichHop(hop, context = {}) {
  if (!hop.ip) return { ...hop, city: '未知节点', region: '—', country: '—', isp: '未响应', asn: '—', lat: null, lng: null }
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
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(hop.ip)) {
    return { ...hop, city: '本地网络', region: 'Private', country: 'LAN', isp: 'Private network', asn: 'RFC1918', lat: null, lng: null, locationSource: 'private-network' }
  }
  try {
    const response = await fetch(`https://ipwho.is/${hop.ip}`)
    const data = await response.json()
    if (data.success === false) throw new Error('lookup failed')
    return { ...hop, city: data.city || '—', region: data.region || '—', country: data.country || '—', isp: data.connection?.org || data.connection?.isp || '—', asn: data.connection?.asn ? `AS${data.connection.asn}` : '—', lat: data.latitude ?? null, lng: data.longitude ?? null }
  } catch {
    const demo = demoHops.find((item) => item.ip === hop.ip)
    return { ...hop, ...(demo || { city: '未知节点', region: '—', country: '—', isp: 'Lookup unavailable', asn: '—', lat: null, lng: null }) }
  }
}

async function globalpingTrace(target, resolved) {
  const country = String(process.env.GLOBALPING_COUNTRY || 'CN').toUpperCase()
  try {
    const createResponse = await fetch('https://api.globalping.io/v1/measurements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'traceroute', target, locations: [{ country }] })
    })
    if (!createResponse.ok) return null
    const created = await createResponse.json()
    if (!created.id) return null

    let measurement = null
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await sleep(attempt === 0 ? 400 : 900)
      const response = await fetch(`https://api.globalping.io/v1/measurements/${encodeURIComponent(created.id)}`)
      if (!response.ok) return null
      measurement = await response.json()
      if (measurement.status === 'finished' || measurement.status === 'failed' || measurement.status === 'error') break
    }
    const remoteResult = measurement?.results?.[0]?.result
    if (measurement?.status !== 'finished' || remoteResult?.status !== 'finished' || !Array.isArray(remoteResult.hops) || !remoteResult.hops.length) return null

    const hops = remoteResult.hops.map((item, index) => {
      const timings = (item.timings || []).map((timing) => Number(timing.rtt)).filter(Number.isFinite)
      const ip = item.resolvedAddress || null
      return {
        hop: index + 1,
        ip,
        hostname: item.resolvedHostname || ip || 'Request timed out',
        latency: timings.length ? Math.round(timings.reduce((sum, value) => sum + value, 0) / timings.length) : null,
        status: ip ? 'ok' : 'timeout'
      }
    })
    const remoteResolved = remoteResult.resolvedAddress || resolved
    const lastRespondingHop = [...hops].reverse().find((hop) => hop.ip)
    const reachable = Boolean(lastRespondingHop && remoteResolved && lastRespondingHop.ip === remoteResolved)
    const probe = measurement.results[0]?.probe || null
    const enriched = await Promise.all(hops.map((hop, index) => enrichHop(hop, { probe, isProbeGateway: index === 0 && Boolean(hop.ip) })))
    return {
      target,
      resolved: remoteResolved,
      source: 'globalping-traceroute',
      provider: 'Globalping',
      probe,
      reachable,
      hops: enriched
    }
  } catch {
    return null
  }
}

async function traceTarget(target) {
  let resolved = target
  try {
    const records = await dns.lookup(target)
    resolved = records.address
  } catch {
    // Keep the original target so the traceroute command can resolve it.
  }
  const remoteTrace = await globalpingTrace(target, resolved)
  if (remoteTrace) return remoteTrace

  let parsed = []
  try {
    const command = process.platform === 'win32' ? 'tracert' : 'traceroute'
    const args = process.platform === 'win32' ? ['-d', '-h', '12', '-w', '800', target] : ['-n', '-m', '12', '-w', '1', target]
    const result = await runCommand(command, args)
    parsed = parseTrace(`${result.stdout}\n${result.stderr}`)
  } catch (error) {
    parsed = parseTrace(`${error.stdout || ''}\n${error.stderr || ''}`)
  }
  if (!parsed.length) {
    // Keep an explicit timeout row for an unreachable destination. Replacing it
    // with the demo route made the UI report a connection that was never tested.
    const timeoutHop = { hop: 1, ip: isIpv4(resolved) ? resolved : null, hostname: target, latency: null, status: 'timeout' }
    return { target, resolved, source: 'system-traceroute', reachable: false, hops: [await enrichHop(timeoutHop)] }
  }
  const hops = await Promise.all(parsed.map((hop) => enrichHop(hop)))
  const lastHop = hops[hops.length - 1]
  const routeReached = Boolean(lastHop && lastHop.status === 'ok' && (!isIpv4(resolved) || lastHop.ip === resolved))
  const reachable = (await probeReachability(target)) || routeReached
  return { target, resolved, source: 'system-traceroute', reachable, hops }
}

function interfaces() {
  const result = []
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const item of entries || []) result.push({ name, address: item.address, netmask: item.netmask, mac: item.mac, family: item.family, internal: item.internal })
  }
  return result
}

async function getGateway() {
  try {
    const command = process.platform === 'win32' ? 'route' : 'ip'
    const args = process.platform === 'win32' ? ['print', '-4', '0.0.0.0'] : ['route', 'show', 'default']
    const { stdout } = await runCommand(command, args, 5000)
    const match = process.platform === 'win32' ? stdout.match(/0\.0\.0\.0\s+0\.0\.0\.0\s+((?:\d{1,3}\.){3}\d{1,3})/) : stdout.match(/default via ((?:\d{1,3}\.){3}\d{1,3})/)
    return match?.[1] || '—'
  } catch { return '—' }
}

function ipv4ToNumber(value) {
  const parts = String(value || '').split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0
}

function numberToIpv4(value) {
  const number = value >>> 0
  return `${number >>> 24}.${(number >>> 16) & 255}.${(number >>> 8) & 255}.${number & 255}`
}

function prefixFromNetmask(netmask) {
  const number = ipv4ToNumber(netmask)
  if (number === null) return null
  return number.toString(2).padStart(32, '0').replace(/0+$/, '').length
}

function activeLanInterface() {
  return interfaces().find((item) => item.family === 'IPv4' && !item.internal && ipv4ToNumber(item.address) !== null && !/^169\.254\./.test(item.address)) || null
}

function normaliseNeighborState(value) {
  return /stale|delay|probe|failed|incomplete/i.test(String(value || '')) ? 'stale' : 'reachable'
}

function parseNeighborTable(output, source) {
  const neighbors = []
  let interfaceAddress = activeLanInterface()?.address || 'LAN'
  for (const line of String(output || '').split(/\r?\n/)) {
    if (source === 'windows') {
      const interfaceMatch = line.match(/^(?:Interface|接口):\s+((?:\d{1,3}\.){3}\d{1,3})/i)
      if (interfaceMatch) { interfaceAddress = interfaceMatch[1]; continue }
      const match = line.match(/^\s*((?:\d{1,3}\.){3}\d{1,3})\s+([0-9a-f]{2}(?:[-:][0-9a-f]{2}){5})\s+(\S+)/i)
      if (match) neighbors.push({ ip: match[1], mac: match[2].replace(/-/g, ':').toUpperCase(), state: normaliseNeighborState(match[3]), interface: interfaceAddress })
    } else {
      const match = line.match(/^\s*((?:\d{1,3}\.){3}\d{1,3})\s+dev\s+(\S+)(?:\s+lladdr\s+([0-9a-f:]{17}))?\s+(\S+)/i)
      if (match && match[3]) neighbors.push({ ip: match[1], mac: match[3].toUpperCase(), state: normaliseNeighborState(match[4]), interface: match[2] })
    }
  }
  return neighbors.filter((item) => !/^224\.|^239\.|^255\./.test(item.ip) && !/^ff:ff:ff:ff:ff:ff$/i.test(item.mac))
}

async function readNeighborTable() {
  if (process.platform === 'win32') {
    try {
      const result = await runCommand('arp', ['-a'], 5000)
      return parseNeighborTable(result.stdout, 'windows')
    } catch { return [] }
  }
  try {
    const result = await runCommand('ip', ['neigh', 'show'], 5000)
    return parseNeighborTable(result.stdout, 'linux')
  } catch {
    try {
      const result = await runCommand('arp', ['-a'], 5000)
      return parseNeighborTable(result.stdout, 'linux')
    } catch { return [] }
  }
}

async function touchLanHost(ip) {
  const args = process.platform === 'win32' ? ['-n', '1', '-w', '350', ip] : ['-c', '1', '-W', '1', ip]
  try { await runCommand('ping', args, 1500) } catch { /* A failed ping can still populate ARP. */ }
}

async function refreshLanArp() {
  const local = activeLanInterface()
  if (!local) return
  const address = ipv4ToNumber(local.address)
  const originalPrefix = prefixFromNetmask(local.netmask) ?? 24
  if (address === null || originalPrefix >= 31) return
  // Avoid scanning a /16 or larger network. A /24 window around the current
  // address is the useful local segment and keeps the phone/desktop responsive.
  const prefix = Math.max(originalPrefix, 24)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (address & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const first = network + 1
  const last = broadcast - 1
  const hosts = []
  for (let value = first; value <= last && hosts.length < 512; value += 1) {
    if ((value >>> 0) !== address) hosts.push(numberToIpv4(value))
  }
  let cursor = 0
  const worker = async () => {
    while (cursor < hosts.length) {
      const index = cursor
      cursor += 1
      await touchLanHost(hosts[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(32, hosts.length) }, () => worker()))
}

async function getNeighbors() {
  await refreshLanArp()
  return readNeighborTable()
}

app.get('/api/network', async (_req, res) => res.json({ hostname: os.hostname(), platform: process.platform, gateway: await getGateway(), interfaces: interfaces() }))
app.get('/api/neighbors', async (req, res) => {
  const neighbors = await getNeighbors()
  // When the phone calls the desktop API, the desktop's own interface is a
  // real LAN peer from the phone's point of view. The server's ARP table will
  // never list its own address, so expose it only for a same-subnet remote
  // client and mark it explicitly as the API host.
  const local = activeLanInterface()
  const peer = String(req.ip || '').replace(/^::ffff:/, '')
  if (local && ipv4ToNumber(peer) !== null && peer !== local.address) {
    const prefix = Math.max(prefixFromNetmask(local.netmask) ?? 24, 24)
    const mask = (0xffffffff << (32 - prefix)) >>> 0
    if (((ipv4ToNumber(peer) & mask) >>> 0) === ((ipv4ToNumber(local.address) & mask) >>> 0)) {
      neighbors.unshift({ ip: local.address, mac: local.mac || '—', state: 'reachable', interface: local.name, source: 'api-host' })
    }
  }
  res.json({ neighbors })
})
app.post('/api/trace', async (req, res) => {
  const target = String(req.body?.target || '').trim()
  if (!target || !/^[a-z0-9.:-]+$/i.test(target)) return res.status(400).json({ error: '请输入有效的域名或 IP 地址' })
  try { res.json(await traceTarget(target)) } catch (error) { res.status(500).json({ error: error.message }) }
})

const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist))
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(dist, 'index.html'))
  next()
})
app.listen(PORT, () => console.log(`PathLens API listening on http://localhost:${PORT}`))
