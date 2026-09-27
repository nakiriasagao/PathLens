import React, { useEffect, useMemo, useRef, useState } from 'react'
import { LocateFixed } from 'lucide-react'

const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || '9c13df2862ed69b7c7466e4b164c7022'
let scriptPromise

function loadAmap() {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = 'amap-script'
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}`
    script.async = true
    const timer = setTimeout(() => fail(), 25000)
    function fail() {
      clearTimeout(timer)
      script.remove()
      reject(new Error('高德地图资源加载超时，请检查网络后重试'))
    }
    script.onerror = fail
    script.onload = () => {
      clearTimeout(timer)
      if (window.AMap) resolve(window.AMap)
      else fail()
    }
    document.head.appendChild(script)
  }).catch((error) => { scriptPromise = null; throw error })
  return scriptPromise
}

export default function WorldMap({ trace, localDevice, selectedHop, setSelectedHop }) {
  const hostRef = useRef(null)
  const canvasRef = useRef(null)
  const mapRef = useRef(null)
  const overlaysRef = useRef([])
  const markersRef = useRef([])
  const localRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [progress, setProgress] = useState(10)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const coords = useMemo(() => trace.filter((hop) => Number.isFinite(hop.lng) && Number.isFinite(hop.lat)), [trace])
  const localPosition = useMemo(() => Number.isFinite(localDevice?.lng) && Number.isFinite(localDevice?.lat) ? [localDevice.lng, localDevice.lat] : null, [localDevice?.lng, localDevice?.lat])
  localRef.current = localPosition

  const fit = () => {
    const map = mapRef.current
    if (!map) return
    if (coords.length) map.setFitView(overlaysRef.current, true, [100, 100, 100, 100], 10)
    else if (localRef.current) map.setZoomAndCenter(10, localRef.current, true)
    else map.setZoomAndCenter(2, [0, 15], true)
  }

  useEffect(() => {
    let active = true
    let map, observer, tileTimer
    setStatus('loading')
    setProgress(10)
    setError('')

    // AMap's minimum zoom is 2 (a 1024px world). A larger canvas scaled to
    // the available width lets a phone show the whole online world map.
    const sizeCanvas = () => {
      const { clientWidth: width, clientHeight: height } = hostRef.current
      const canvasWidth = Math.max(width, 1100)
      const scale = width / canvasWidth
      Object.assign(canvasRef.current.style, { width: `${canvasWidth}px`, height: `${height / scale}px`, zoom: String(scale) })
      canvasRef.current.style.setProperty('--marker-scale', String(1 / scale))
      map?.resize()
    }
    sizeCanvas()
    observer = new ResizeObserver(sizeCanvas)
    observer.observe(hostRef.current)
    const fail = (reason) => {
      if (!active) return
      clearTimeout(tileTimer)
      setError(reason)
      setStatus('error')
    }
    loadAmap().then((AMap) => {
      if (!active) return
      setProgress(45)
      map = new AMap.Map(canvasRef.current, { zoom: localRef.current ? 10 : 2, center: localRef.current || [0, 15], zooms: [2, 20], mapStyle: 'amap://styles/dark', viewMode: '2D', resizeEnable: true })
      mapRef.current = map
      tileTimer = setTimeout(() => fail('地图底图加载超时，请重试'), 25000)
      map.on('complete', () => {
        if (!active) return
        clearTimeout(tileTimer)
        setProgress(100)
        setStatus('loaded')
      })
      map.on('error', () => fail('高德地图加载失败，请检查网络后重试'))
    }).catch((reason) => fail(reason.message))

    // Only unmount/retry destroys the map. A complete event must not destroy it.
    return () => {
      active = false
      clearTimeout(tileTimer)
      observer.disconnect()
      map?.destroy()
      mapRef.current = null
      overlaysRef.current = []
    }
  }, [attempt])

  useEffect(() => {
    const map = mapRef.current
    if (status !== 'loaded' || !map) return
    const AMap = window.AMap
    if (overlaysRef.current.length) map.remove(overlaysRef.current)
    const overlays = []
    markersRef.current = []
    coords.forEach((hop, index) => {
      if (index > 0) {
        const previous = coords[index - 1]
        overlays.push(new AMap.Polyline({ path: [[previous.lng, previous.lat], [hop.lng, hop.lat]], strokeColor: '#6de5c0', strokeWeight: 7, strokeOpacity: .85, strokeStyle: hop.hop - previous.hop > 1 ? 'dashed' : 'solid' }))
      }
      const content = document.createElement('div')
      content.className = `route-map-marker${hop.hop === trace.length ? ' last' : ''}`
      content.textContent = String(hop.hop)
      content.dataset.hop = hop.hop
      const marker = new AMap.Marker({ position: [hop.lng, hop.lat], anchor: 'center', content, title: `${hop.ip} · ${hop.city || '位置未知'}`, zIndex: 50 })
      marker.on('click', () => setSelectedHop(hop.hop))
      markersRef.current.push({ hop: hop.hop, content, marker })
      overlays.push(marker)
    })
    if (localPosition) {
      const content = document.createElement('div')
      content.className = 'local-map-marker'
      content.textContent = '本机'
      const marker = new AMap.Marker({ position: localPosition, anchor: 'center', content, title: `公网 IP：${localDevice.ip || '未知'}；局域网 IP：${localDevice.privateIp || '未知'}`, zIndex: 200 })
      overlays.push(marker)
    }
    overlaysRef.current = overlays
    if (overlays.length) map.add(overlays)
    fit()
  }, [status, coords, localPosition, localDevice?.ip, localDevice?.privateIp])

  useEffect(() => {
    markersRef.current.forEach(({ hop, content, marker }) => {
      content.classList.toggle('selected', hop === selectedHop)
      marker.setzIndex(hop === selectedHop ? 120 : 50)
    })
  }, [selectedHop, coords, status])

  const loaded = status === 'loaded'
  return <>
    <div className="world-map-wrap" ref={hostRef}>
      <div className={`pathlens-map-canvas amap-container ${loaded ? 'visible' : ''}`} ref={canvasRef} />
      {!loaded && <div className={`map-loading ${status === 'error' ? 'error' : ''}`}>
        {status === 'error' ? <><b>高德地图加载失败</b><small>{error}</small><button onClick={() => setAttempt((value) => value + 1)}>重新加载</button></> : <><b>正在加载高德地图…</b><small>{progress < 45 ? '加载地图脚本' : '等待在线底图加载完成'}</small><div className="map-progress" role="progressbar" aria-label="高德地图加载" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div></>}
      </div>}
      <div className="map-zoom">
        <button disabled={!loaded} onClick={() => mapRef.current?.setZoom(mapRef.current.getZoom() + 1)} aria-label="放大">+</button>
        <button disabled={!loaded} onClick={() => mapRef.current?.setZoom(mapRef.current.getZoom() - 1)} aria-label="缩小">−</button>
        <button disabled={!loaded} onClick={fit} aria-label="定位完整路径">⌖</button>
        <button disabled={!loaded || !localPosition} onClick={() => mapRef.current?.setZoomAndCenter(10, localPosition)} aria-label="定位本机"><LocateFixed size={14} /></button>
      </div>
    </div>
    <div className="map-info"><span>{localDevice?.source === 'loading' ? '正在查询本机公网 IP 属地…' : localPosition ? `本机 ${localDevice.ip || ''} · ${localDevice.city || '未知城市'}` : '本机 IP 属地查询失败'}{localDevice?.privateIp ? ` · 局域网 ${localDevice.privateIp}` : ''}</span><span className="map-status">{loaded ? '在线地图' : status === 'error' ? '加载失败' : '加载中'}</span></div>
    {coords.length > 0 && <p className="map-note">IP 属地仅为近似位置；虚线跨过位置未知的跳数，不代表实际线路。</p>}
  </>
}
