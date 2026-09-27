import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionState, traceResult } from '../src/diagnostics.js'

test('remote success cannot override failed phone reachability', () => {
  const result = traceResult({ reachable: true, resolved: '1.1.1.1' }, { method: 'android-ping', reachable: false }, true)
  assert.equal(connectionState(result), 'unreachable')
  assert.equal(result.routeReachable, true)
})

test('a reachable phone remains reachable when the remote trace is incomplete', () => {
  const result = traceResult({ reachable: false, resolved: '1.1.1.1' }, { method: 'android-ping', reachable: true, resolved: '8.8.8.8' }, true)
  assert.equal(connectionState(result), 'reachable')
  assert.equal(result.resolved, '8.8.8.8')
  assert.equal(result.routeResolved, '1.1.1.1')
})

test('missing phone results stay unknown regardless of remote results', () => {
  assert.equal(connectionState(traceResult({ reachable: true }, null, true)), 'unknown')
  assert.equal(connectionState({}), 'unknown')
})
