// Remote probes measure their own connection. Only a phone result can verify
// the phone's reachability, even when the remote probe reaches the target.
export function connectionState(meta) {
  if (meta?.reachable === true) return 'reachable'
  if (meta?.reachable === false) return 'unreachable'
  return 'unknown'
}

export function traceResult(remote, native, isPhone) {
  return {
    ...remote,
    resolved: native?.resolved || remote.resolved,
    routeResolved: remote.resolved,
    routeReachable: remote.reachable,
    reachable: isPhone ? (native?.method ? native.reachable === true : null) : remote.reachable,
    nativeReachable: native?.method ? native.reachable === true : null,
    connectionSource: isPhone ? 'phone' : 'probe',
  }
}
