import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowDownToLine, ArrowUpRight, Cable, CheckCircle2, ChevronRight, CircleHelp, Globe2, Home, LocateFixed, MapPin, Menu, Network, Radio, RefreshCw, Router, Search, Server, ShieldCheck, Signal, Smartphone, Wifi, X } from 'lucide-react'
import './styles.css'
import { getMobileNetworkStatus, getPublicIpLocation, isNativeApp, nativeNeighbors, nativeNetwork, nativeTrace, registerOfflineShell, requestApi, requestTrace } from './mobile'

import { connectionState as getTraceConnectionState, traceResult } from './diagnostics'
import WorldMap from './WorldMap'
const quickTargets = [
  { label: 'Google DNS', value: '8.8.8.8', meta: '全球 DNS' },
  { label: 'Cloudflare', value: '1.1.1.1', meta: '全球 DNS' },
  { label: 'Quad9', value: '9.9.9.9', meta: '安全 DNS' },
  { label: 'GitHub', value: 'github.com', meta: '代码托管' },
  { label: 'Baidu', value: 'www.baidu.com', meta: '搜索引擎' },
  { label: 'OpenAI', value: 'openai.com', meta: 'AI 服务' }
]
// Network discovery is intentionally empty until the device reports real data.
// Showing made-up LAN hosts is misleading, especially when the phone is on a
// different subnet or the ARP cache has not been populated yet.
const fallbackNetwork = { hostname: '手机本机', gateway: '—', platform: 'unknown', interfaces: [] }
const fallbackNeighbors = []

function getTraceConnectionLabel(state) {
  if (state === 'reachable') return '已连通'
  if (state === 'unreachable') return '无法连通'
  return '未验证'
}

function traceNotice(target, data) {
  const local = data.connectionSource === 'phone'
    ? (data.nativeReachable === true ? '手机 ping 已确认可达' : data.nativeReachable === false ? '手机 ping 未收到目标响应' : '手机连通性未验证')
    : (data.reachable === true ? '探针已抵达目标' : '探针尚未抵达目标')
  if (data.source === 'globalping-traceroute') return `${local}；远程探针（${data.probe?.city || '未知城市'}）返回 ${data.hops?.length || 0} 跳。路径从探针出发，不是手机的实际路由。`
  return `${local}；已显示 ${data.hops?.length || 0} 条探测结果`
}

const initialLocalDevice = { ip: null, city: null, lat: null, lng: null, source: 'loading' }

function App() {
  const [target, setTarget] = useState('8.8.8.8')
  const [trace, setTrace] = useState([])
  const [traceMeta, setTraceMeta] = useState({ target: '8.8.8.8', resolved: '8.8.8.8', source: 'pending' })
  const [network, setNetwork] = useState(fallbackNetwork)
  const [neighbors, setNeighbors] = useState(fallbackNeighbors)
  const [selectedHop, setSelectedHop] = useState(null)
  const [loading, setLoading] = useState(false)
  const [networkLoading, setNetworkLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [activeTab, setActiveTab] = useState('path')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mobileNetwork, setMobileNetwork] = useState({ connected: true, connectionType: 'unknown' })
  const [localDevice, setLocalDevice] = useState(initialLocalDevice)

  const traceRequestRef = useRef(0)

  const runTrace = async (nextTarget = target) => {
    const clean = nextTarget.trim()
    if (!clean) return
    const requestId = ++traceRequestRef.current
    document.activeElement?.blur()
    setLoading(true)
    setNotice('正在探测路径…')
    try {
      const remotePromise = (async () => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 30000)
        try {
          return await requestTrace(clean, controller.signal)
        } catch { return null } finally { clearTimeout(timeout) }
      })()
      const nativePromise = isNativeApp ? nativeTrace(clean).catch(() => null) : Promise.resolve(null)
      const [remoteData, nativeResult] = await Promise.all([remotePromise, nativePromise])

      if (requestId !== traceRequestRef.current) return
      // Keep the phone measurement and remote route distinct.
      if (remoteData?.hops?.length && remoteData.source !== 'demo-fallback') {
        const result = traceResult(remoteData, nativeResult, isNativeApp)
        setTrace(remoteData.hops)
        setTraceMeta(result)
        setSelectedHop(remoteData.hops.length)
        setNotice(traceNotice(clean, result))
        return
      }
      if (nativeResult?.method) {
        const nativeHop = { hop: 1, ip: nativeResult.resolved || clean, hostname: clean, latency: nativeResult.latency ? Math.round(nativeResult.latency) : null, status: nativeResult.reachable === true ? 'ok' : 'timeout', city: '手机原生探测', region: 'Android', country: '—', isp: '本机网络', asn: '—', lat: null, lng: null }
        const nativeData = { target: clean, resolved: nativeResult.resolved || clean, source: nativeResult.method, reachable: nativeResult.reachable === true, verified: true }
        setTrace([nativeHop])
        setTraceMeta(nativeData)
        setSelectedHop(1)
        setNotice(nativeData.reachable ? '手机原生 ping 已连通；远程 API 暂不可用，当前显示本机结果' : `目标 ${clean} 无法连通`)
        return
      }
      throw new Error('API unavailable')
    } catch {
      if (requestId !== traceRequestRef.current) return
      setTrace([])
      setTraceMeta({ target: clean, resolved: clean, source: 'error', reachable: null })
      setSelectedHop(null)
      setNotice('探测暂不可用，请检查网络后重试。没有可显示的路由结果。')
    } finally { if (requestId === traceRequestRef.current) setLoading(false) }
  }

  const loadNetwork = async () => {
    setNetworkLoading(true)
    try {
      if (isNativeApp) {
        try {
          const [nativeNetworkData, nativeNeighborData] = await Promise.all([nativeNetwork(), nativeNeighbors()])
          const nativeInterfaces = nativeNetworkData?.interfaces || []
          if (nativeInterfaces.length || nativeNetworkData?.gateway) {
            setNetwork(nativeNetworkData)
            setNeighbors(Array.isArray(nativeNeighborData?.neighbors) ? nativeNeighborData.neighbors : [])
            setMobileNetwork(await getMobileNetworkStatus())
            return
          }
        } catch { /* Remote API fallback below. */ }
      }
      const [networkResponse, neighborResponse] = await Promise.all([requestApi('/api/network'), requestApi('/api/neighbors')])
      if (!networkResponse.ok || !neighborResponse.ok) throw new Error('API unavailable')
      setNetwork(await networkResponse.json())
      const neighborData = await neighborResponse.json()
      setNeighbors(Array.isArray(neighborData?.neighbors) ? neighborData.neighbors : [])
    } catch {
      const status = await getMobileNetworkStatus().catch(() => ({ connected: navigator.onLine, connectionType: 'unknown' }))
      setMobileNetwork(status)
      setNetwork({ ...fallbackNetwork, hostname: isNativeApp ? '手机本机' : fallbackNetwork.hostname })
      setNeighbors([])
    }
    finally { setNetworkLoading(false) }
  }

  const loadLocalDevice = async () => {
    let privateIp = null
    try {
      const data = isNativeApp ? await nativeNetwork() : await (await requestApi('/api/network')).json()
      privateIp = data?.interfaces?.find((item) => item.family === 'IPv4' && !item.internal)?.address || null
    } catch { /* Public lookup below still provides the map position. */ }
    try {
      const location = await getPublicIpLocation()
      setLocalDevice((current) => ({ ...current, ...location, privateIp }))
    } catch {
      setLocalDevice((current) => ({ ...current, privateIp, source: 'error' }))
    }
  }

  useEffect(() => { registerOfflineShell(); loadNetwork(); loadLocalDevice() }, [])

  const healthyCount = trace.filter((hop) => hop.status === 'ok').length
  const lastHop = trace[trace.length - 1] || {}
  const maxLatency = lastHop.latency || 0
  const connectionState = getTraceConnectionState(traceMeta)

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Activity size={19} /></div><div><strong>PathLens</strong><span>网络路径观测器</span></div></div>
      <div className="topbar-actions"><div className="live-pill"><span className="live-dot" />{isNativeApp ? '手机模式' : '实时监测'}</div><button className="icon-btn mobile-menu" onClick={() => setDrawerOpen(true)} aria-label="打开菜单"><Menu size={20} /></button><div className="avatar">P</div></div>
    </header>
    <div className="workspace">
      <aside className={`sidebar ${drawerOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-head"><div><p className="eyebrow">诊断工作台</p><h1>网络路径</h1></div><button className="icon-btn close-menu" onClick={() => setDrawerOpen(false)} aria-label="关闭菜单"><X size={18} /></button></div>
        <div className="target-form">
          <label htmlFor="target">目标 IP / 域名</label>
          <div className="target-input"><Search size={17} /><input id="target" value={target} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && runTrace()} placeholder="例如 8.8.8.8" /><button onClick={() => runTrace()} disabled={loading} aria-label="开始探测"><ArrowUpRight size={17} /></button></div>
          <button className="trace-btn" onClick={() => runTrace()} disabled={loading}>{loading ? <><RefreshCw className="spin" size={16} />探测中…</> : <><Radio size={16} />开始路径探测</>}</button>
        </div>
        <div className="quick-section"><div className="section-label"><span>快速访问</span><span className="muted">常用目标</span></div><div className="quick-list">{quickTargets.map((item) => <button key={item.value} className={`quick-card ${target === item.value ? 'active' : ''}`} onClick={() => { setTarget(item.value); runTrace(item.value); setDrawerOpen(false) }}><div className="quick-icon"><Globe2 size={15} /></div><div><b>{item.label}</b><small>{item.value}</small></div><ChevronRight size={15} /></button>)}</div></div>
        <div className="sidebar-status"><div className="status-head"><span className="status-icon"><ShieldCheck size={16} /></span><div><b>{mobileNetwork.connected ? '本机网络正常' : '当前网络已断开'}</b><small>{isNativeApp ? `手机独立模式 · ${mobileNetwork.connectionType || '网络'}` : '最近检查 · 刚刚'}</small></div><span className="status-check"><CheckCircle2 size={17} /></span></div><div className="status-meter"><span style={{ width: mobileNetwork.connected ? '92%' : '18%' }} /></div><div className="status-foot"><span>{isNativeApp ? '本地界面已就绪' : '延迟稳定'}</span><strong>{mobileNetwork.connected ? '92 分' : '—'}</strong></div></div>
        <div className="sidebar-bottom"><span className="help-link"><CircleHelp size={15} />使用帮助</span><span className="version">v1.0.0</span></div>
      </aside>
      {drawerOpen && <button className="scrim" onClick={() => setDrawerOpen(false)} aria-label="关闭菜单" />}
      <main className="main-content">
        <div className="mobile-page-title"><div><p className="eyebrow">诊断工作台</p><h1>网络路径</h1></div><button className="refresh-btn" onClick={() => { runTrace(); loadNetwork() }}><RefreshCw size={16} /></button></div>
        <MainTargetForm target={target} setTarget={setTarget} runTrace={runTrace} loading={loading} />
        <div className="summary-row"><div><p className="eyebrow route-heading"><span>路径概览</span><span className="route-live"><i className="live-dot" />LIVE</span></p><h2>{traceMeta.target || target}</h2><div className={`resolved-line ${connectionState}`}><span className="ping-dot" />{getTraceConnectionLabel(connectionState)} <span className="divider" />解析至 {traceMeta.resolved || target}</div></div><div className="summary-stats"><Stat label="跳数" value={String(trace.length).padStart(2, '0')} icon={<Network size={16} />} /><Stat label="平均延迟" value={`${Math.round(trace.reduce((sum, item) => sum + (item.latency || 0), 0) / Math.max(healthyCount, 1))} ms`} icon={<Activity size={16} />} /><Stat label="已响应" value={`${healthyCount}/${trace.length}`} icon={<Signal size={16} />} /></div></div>
        {notice && <div className="notice"><CheckCircle2 size={15} />{notice}</div>}
        <nav className="tabbar"><button className={activeTab === 'path' ? 'active' : ''} onClick={() => setActiveTab('path')}><MapPin size={16} />逐跳路径</button><button className={activeTab === 'topology' ? 'active' : ''} onClick={() => setActiveTab('topology')}><Network size={16} />网络拓扑 <span className="tab-count">{neighbors.length}</span></button><button className={activeTab === 'neighbors' ? 'active' : ''} onClick={() => setActiveTab('neighbors')}><Wifi size={16} />邻居设备 <span className="tab-count">{neighbors.length}</span></button></nav>
        {activeTab === 'path' ? <PathView trace={trace} traceMeta={traceMeta} localDevice={localDevice} selectedHop={selectedHop} setSelectedHop={setSelectedHop} maxLatency={maxLatency} healthyCount={healthyCount} /> : activeTab === 'topology' ? <TopologyView trace={trace} network={network} neighbors={neighbors} /> : <NeighborsView neighbors={neighbors} network={network} loading={networkLoading} refresh={loadNetwork} />}
      </main>
    </div>
  </div>
}

function MainTargetForm({ target, setTarget, runTrace, loading }) {
  return <section className="main-target-form"><div className="main-target-heading"><div><p className="eyebrow">快速检测</p><h3>输入 IP 或域名开始测试</h3></div><span className="target-hint">支持 IPv4 / 域名</span></div><div className="main-target-row"><div className="main-target-input"><Search size={17} /><input value={target} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && runTrace()} placeholder="例如 8.8.8.8 或 github.com" /><button onClick={() => runTrace()} disabled={loading}>{loading ? <RefreshCw className="spin" size={16} /> : <ArrowUpRight size={17} />}<span>{loading ? '测试中' : '测试'}</span></button></div></div><div className="main-quick-list">{quickTargets.map((item) => <button key={item.value} className={`main-quick-chip ${target === item.value ? 'active' : ''}`} onClick={() => { setTarget(item.value); runTrace(item.value) }}><Globe2 size={14} /><span><b>{item.label}</b><small>{item.value}</small></span></button>)}</div></section>
}

function Stat({ label, value, icon }) { return <div className="stat"><span className="stat-icon">{icon}</span><div><small>{label}</small><b>{value}</b></div></div> }

function PathView({ trace, traceMeta, localDevice, selectedHop, setSelectedHop, maxLatency, healthyCount }) {
  return <>
    <div className="map-panel"><div className="panel-title"><div><p className="eyebrow">路径地图</p><h3>完整路由路径</h3></div><div className="map-legend"><span><i className="legend-line" />路径</span><span><i className="legend-dot local" />本机</span><span><i className="legend-dot" />节点</span><span><i className="legend-dot current" />目标</span></div></div><WorldMap trace={trace} localDevice={localDevice} selectedHop={selectedHop} setSelectedHop={setSelectedHop} /></div>
    <div className="path-section"><div className="section-heading"><div><p className="eyebrow">详细跳数 <span className="muted">· {healthyCount}/{trace.length} 已响应</span></p><h3>{traceMeta.source === 'globalping-traceroute' ? '远程探针到目标的逐跳路径' : traceMeta.source === 'android-ping' ? '手机 ping 检测结果' : '逐跳探测结果'}</h3></div><div className="latency-scale"><span>延迟</span><i style={{ width: `${Math.min(maxLatency / 1.2, 100)}%` }} /></div></div><div className="hop-list">{!trace.length && <p className="empty-state">输入 IP 或域名开始测试。蓝色节点为本机公网 IP 的属地。</p>}{trace.map((hop, index) => <HopRow key={`${hop.hop}-${hop.ip}`} hop={hop} isSelected={selectedHop === hop.hop} isLast={index === trace.length - 1} onClick={() => setSelectedHop(hop.hop)} />)}</div></div>
  </>
}

function HopRow({ hop, isSelected, isLast, onClick }) {
  return <button className={`hop-row ${isSelected ? 'selected' : ''}`} onClick={onClick}><span className={`hop-number ${isLast ? 'last' : ''}`}>{hop.hop}</span><span className="hop-rail"><i className={isLast ? 'last' : ''} /></span><span className="hop-main"><b>{hop.hostname || hop.ip || 'Request timed out'}</b><small>{hop.ip || '未收到响应'} · {hop.city || '未知位置'}{hop.locationSource === 'probe-estimate' ? '（探针附近，估计）' : ''}</small></span><span className="hop-meta"><b className={hop.status === 'timeout' ? 'timeout' : ''}>{hop.latency ? `${hop.latency} ms` : '—'}</b><small>{hop.asn || '—'}</small></span><ChevronRight className="hop-chevron" size={17} /></button>
}

function TopologyView({ trace, network, neighbors }) {
  return <div className="topology-grid"><section className="topology-card topology-visual"><div className="panel-title"><div><p className="eyebrow">实时关系图</p><h3>当前网络拓扑</h3></div><span className="online-tag"><span className="live-dot" />在线</span></div><InteractiveTopology network={network} trace={trace} neighbors={neighbors} /><div className="topology-caption"><span><i className="node-key local" />本地设备</span><span><i className="node-key route" />路由节点</span><span><i className="node-key neighbor" />邻居设备</span><span className="topology-gesture-hint">单指拖动 · 双指缩放</span></div></section><section className="topology-card interface-card"><div className="panel-title"><div><p className="eyebrow">本机状态</p><h3>网络接口</h3></div><button className="small-action" onClick={() => window.location.reload()}><RefreshCw size={14} /></button></div><div className="interface-list">{(network.interfaces || []).filter((item) => item.family === 'IPv4').slice(0, 3).map((item) => <div className="interface-row" key={item.name + '-' + item.address}><span className="interface-icon"><Cable size={16} /></span><div><b>{item.name}</b><small>{item.address} · {item.netmask}</small></div><span className="interface-state">已连接</span></div>)}</div><div className="gateway-line"><span>默认网关</span><b>{network.gateway || '—'}</b></div></section><section className="topology-card compact-neighbors"><div className="panel-title"><div><p className="eyebrow">局域网发现</p><h3>邻居设备</h3></div><span className="tab-count large">{neighbors.length}</span></div><div className="mini-neighbors">{neighbors.slice(0, 4).map((item) => <div className="mini-neighbor" key={item.ip}><span className={'device-dot ' + (item.state === 'stale' ? 'stale' : '')} /><div><b>{item.ip}</b><small>{item.mac}</small></div><span className="neighbor-state">{item.state === 'reachable' ? '在线' : '缓存'}</span></div>)}</div></section></div>
}

function InteractiveTopology({ network, trace, neighbors }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const gestureRef = useRef({ mode: 'none', startX: 0, startY: 0, originX: 0, originY: 0, distance: 0, originScale: 1 })
  const lastHop = trace[trace.length - 1] || {}

  const clampScale = (value) => Math.min(2.6, Math.max(.72, value))
  const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }) }
  const zoomAt = (delta) => setScale((value) => clampScale(value + delta))
  const distance = (first, second) => Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
  const onPointerDown = (event) => { event.currentTarget.setPointerCapture?.(event.pointerId); gestureRef.current = { mode: 'drag', startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y, distance: 0, originScale: scale } }
  const onPointerMove = (event) => { const gesture = gestureRef.current; if (gesture.mode === 'drag') setOffset({ x: gesture.originX + event.clientX - gesture.startX, y: gesture.originY + event.clientY - gesture.startY }) }
  const onPointerUp = () => { gestureRef.current.mode = 'none' }
  const onTouchStart = (event) => { if (event.touches.length === 2) gestureRef.current = { mode: 'pinch', startX: 0, startY: 0, originX: offset.x, originY: offset.y, distance: distance(event.touches[0], event.touches[1]), originScale: scale }; else if (event.touches.length === 1) gestureRef.current = { mode: 'drag', startX: event.touches[0].clientX, startY: event.touches[0].clientY, originX: offset.x, originY: offset.y, distance: 0, originScale: scale } }
  const onTouchMove = (event) => { const gesture = gestureRef.current; if (gesture.mode === 'pinch' && event.touches.length === 2) { event.preventDefault(); setScale(clampScale(gesture.originScale * (distance(event.touches[0], event.touches[1]) / gesture.distance))) } else if (gesture.mode === 'drag' && event.touches.length === 1) { event.preventDefault(); setOffset({ x: gesture.originX + event.touches[0].clientX - gesture.startX, y: gesture.originY + event.touches[0].clientY - gesture.startY }) } }
  const onWheel = (event) => { event.preventDefault(); zoomAt(event.deltaY > 0 ? -.08 : .08) }
  const transform = 'translate(' + offset.x + 'px, ' + offset.y + 'px) scale(' + scale + ')'
  const neighborPositions = neighbors.map((item, index) => {
    const columns = Math.min(3, Math.max(1, neighbors.length))
    const column = index % columns
    const row = Math.floor(index / columns)
    return { item, index, left: 23 + column * 26, top: 69 + row * 20 }
  })
  return <div className="topology-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onPointerUp} onWheel={onWheel}><div className="topology-stage" style={{ transform }}><svg className="topology-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="17" y1="48" x2="55" y2="53" /><line x1="55" y1="53" x2="89" y2="33" />{neighborPositions.map(({ index, left, top }) => <line key={`link-${index}`} x1="55" y1="53" x2={left + 7} y2={top + 5} />)}</svg><TopologyNode icon={<Smartphone size={18} />} label="本机" detail={network.interfaces?.find((item) => item.family === 'IPv4')?.address || '—'} main /><TopologyNode icon={<Router size={18} />} label="网关" detail={network.gateway || '—'} style={{ left: '50%', top: '48%' }} /><TopologyNode icon={<Globe2 size={18} />} label="目标网络" detail={lastHop.ip || '—'} style={{ left: '82%', top: '26%' }} />{neighborPositions.map(({ item, index, left, top }) => <TopologyNode key={`${item.ip}-${index}`} icon={<Wifi size={17} />} label={`邻居 ${index + 1}`} detail={item.ip || '—'} neighbor style={{ left: `${left}%`, top: `${top}%` }} />)}</div><div className="topology-controls"><button onClick={(event) => { event.stopPropagation(); zoomAt(.15) }} aria-label="放大">+</button><button onClick={(event) => { event.stopPropagation(); zoomAt(-.15) }} aria-label="缩小">−</button><button onClick={(event) => { event.stopPropagation(); reset() }} aria-label="重置">↺</button></div><span className="topology-zoom-label">{Math.round(scale * 100)}%</span></div>
}

function TopologyNode({ icon, label, detail, main, neighbor, style }) { return <div className={`topology-node ${main ? 'main' : ''} ${neighbor ? 'neighbor-node' : ''}`} style={style}><span className="topology-node-icon">{icon}</span><div><b>{label}</b><small>{detail}</small></div></div> }

function NeighborsView({ neighbors, network, loading, refresh }) {
  return <div className="neighbors-view"><section className="topology-card neighbors-card"><div className="panel-title"><div><p className="eyebrow">局域网发现</p><h3>网络中的邻居设备</h3><p className="panel-subtitle">基于本机 ARP / 邻居缓存读取，帮助确认同一局域网内的设备。</p></div><button className="refresh-btn" onClick={refresh} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={16} />刷新</button></div><div className="neighbor-summary"><div><span className="summary-label">已发现</span><b>{neighbors.length}<small> 台设备</small></b></div><div><span className="summary-label">活跃</span><b className="green">{neighbors.filter((item) => item.state === 'reachable').length}<small> 台在线</small></b></div><div><span className="summary-label">接口</span><b>{network.interfaces?.filter((item) => item.family === 'IPv4').length || 0}<small> 个</small></b></div></div><div className="neighbor-table"><div className="neighbor-table-head"><span>设备 / IP</span><span>MAC 地址</span><span>接口</span><span>状态</span></div>{neighbors.map((item) => <div className="neighbor-table-row" key={item.ip}><span className="device-cell"><span className={`device-dot ${item.state === 'stale' ? 'stale' : ''}`} /><div><b>{item.ip}</b><small>{item.source === 'api-host' ? '远程 API 主机' : item.ip === network.gateway ? '默认网关' : '局域网设备'}</small></div></span><span className="mono">{item.mac}</span><span>{item.interface || 'LAN'}</span><span><em className={`state-pill ${item.state === 'reachable' ? 'reachable' : 'stale'}`}>{item.state === 'reachable' ? '可达' : '缓存'}</em></span></div>)}</div></section></div>
}

window.__PATHLENS_BOOTED__ = true
createRoot(document.getElementById('root')).render(<App />)
