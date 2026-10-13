import {test,expect} from 'bun:test'
import {createOfflineMeasurementFixture} from './workflow-v3-offline-measurement'
test('offline measurement fixture refuses a real billing configuration before starting any service',async()=>{
 const previous=process.env.BEEGAME_BILLING_MODE
 process.env.BEEGAME_BILLING_MODE='remote'
 try{await expect(createOfflineMeasurementFixture()).rejects.toThrow('Offline fixture refuses real billing configuration')}
 finally{if(previous===undefined)delete process.env.BEEGAME_BILLING_MODE;else process.env.BEEGAME_BILLING_MODE=previous}
})
test('normal native Agent sees saved UI failures, repairs via real tools, and hands off current results without replay',async()=>{
 const fixture=await createOfflineMeasurementFixture()
 try{await fixture.start();const proof=await fixture.wait()
  expect(proof.passed).toBe(true);expect(proof.requests).toBe(9);expect(proof.nativeStarts).toHaveLength(1)
  expect(proof.uiCheckVersion).toBe('v3-ui-dom-consumption.5')
  expect(proof.oldProbe.probes).toHaveLength(5);expect(proof.current.freshness.current).toBe(true)
  expect(proof.current.quality).toBe('unverified');expect(proof.paidCalls).toBe(0)
  expect(proof.permissionExpiry).toEqual({capabilityRemoved:true,retiredBridgeRejected:true,unauthenticatedReadStatus:401})
  console.log(JSON.stringify({normalNativeMeasurementProof:proof.root,requests:proof.requests,paidCalls:0,passed:true}))
 }finally{await fixture.close()}
},150000)
