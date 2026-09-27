from pathlib import Path

path = Path('src/main.jsx')
source = path.read_text(encoding='utf-8')
start = source.index('function TopologyView(')
end = source.index('function TopologyNode(', start)
replacement = r'''function TopologyView({ trace, network, neighbors }) {
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
  return <div className="topology-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onPointerUp} onWheel={onWheel}><div className="topology-stage" style={{ transform }}><div className="topology-line line-a" /><div className="topology-line line-b" /><div className="topology-line line-c" /><TopologyNode icon={<Smartphone size={18} />} label="本机" detail={network.interfaces?.find((item) => item.family === 'IPv4')?.address || '—'} main /><TopologyNode icon={<Router size={18} />} label="网关" detail={network.gateway || '—'} style={{ left: '50%', top: '48%' }} /><TopologyNode icon={<Globe2 size={18} />} label="目标网络" detail={lastHop.ip || '—'} style={{ left: '82%', top: '26%' }} /><TopologyNode icon={<Wifi size={17} />} label={neighbors.length + ' 个邻居'} detail="局域网" style={{ left: '81%', top: '75%' }} /></div><div className="topology-controls"><button onClick={(event) => { event.stopPropagation(); zoomAt(.15) }} aria-label="放大">+</button><button onClick={(event) => { event.stopPropagation(); zoomAt(-.15) }} aria-label="缩小">−</button><button onClick={(event) => { event.stopPropagation(); reset() }} aria-label="重置">↺</button></div><span className="topology-zoom-label">{Math.round(scale * 100)}%</span></div>
}

'''
path.write_text(source[:start] + replacement + source[end:], encoding='utf-8', newline='\n')
