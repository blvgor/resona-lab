import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATE, PRESETS, naturalFrequency, basis, createField, sampleGrid, validateState } from '../physics.js';

const plate={...DEFAULT_STATE};
const close=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('Thin-plate scaling: thickness linear, length inverse-square, square modes degenerate',()=>{
  const f=naturalFrequency(1,3,plate);
  close(naturalFrequency(1,3,{...plate,thickness:3}),f*2);
  close(naturalFrequency(1,3,{...plate,length:60}),f/4);
  close(naturalFrequency(3,1,plate),f);
  assert.ok(f>404&&f<405);
  assert.notEqual(naturalFrequency(1,3,{...plate,aspect:2}),naturalFrequency(3,1,{...plate,aspect:2}));
});

test('Supported boundaries and analytical nodal points have zero displacement',()=>{
  for(const [m,n] of [[1,3],[4,7],[7,7]]){
    close(basis(m,n,0,.37),0);close(basis(m,n,1,.37),0);close(basis(m,n,.43,0),0);close(basis(m,n,.43,1),0);
  }
  // At x=y the antisymmetric degenerate mode cancels analytically.
  const p=PRESETS[1],f=createField(p,plate,naturalFrequency(p.m,p.n,plate),plate.damping,-1,65);
  for(let i=0;i<65;i++)close(f.values[i*65+i],0,1e-10);
  // The symmetric (1,3)+(3,1) mode crosses zero at (.5,.25).
  const ring=createField(PRESETS[0],plate,naturalFrequency(1,3,plate),plate.damping,1,65);
  close(sampleGrid(ring.values,65,.5,.25),0,1e-10);
});

test('All 48 presets produce finite nonempty fields on square and rectangular plates',()=>{
  assert.equal(PRESETS.length,48);assert.equal(new Set(PRESETS.map(p=>p.id)).size,48);
  for(const aspect of [1,2])for(const p of PRESETS){
    const config={...plate,aspect},f=createField(p,config,naturalFrequency(p.m,p.n,config),.005,p.mix,48);
    for(const array of [f.values,f.signed,f.gx,f.gy])assert.ok(array.every(Number.isFinite));
    assert.ok(Math.max(...f.values)>.001);
  }
});

test('Manual frequency changes the physical response, including extreme frequencies',()=>{
  const p=PRESETS[0],a=createField(p,plate,404.7,.015,1,48,true),b=createField(p,plate,1000,.015,1,48,true);
  assert.notDeepEqual(a.response.dominantMode,b.response.dominantMode);
  assert.ok(a.values.some((v,i)=>Math.abs(v-b.values[i])>.1));
  for(const f of [20,16000]){
    const field=createField(p,{...plate,thickness:.5,aspect:2},f,.005,1,32,true);
    assert.ok(field.values.every(Number.isFinite));assert.ok(field.gx.every(Number.isFinite));
  }
});

test('Settings loaded from storage are clamped, typed and restricted to supported values',()=>{
  const state=validateState({preset:999,thickness:-1,count:Infinity,color:'url(javascript:1)',view:'unknown',material:'unknown',exportSize:99999,running:'false',aspect:99});
  assert.equal(state.preset,47);assert.equal(state.thickness,.5);assert.equal(state.count,40000);
  assert.equal(state.color,DEFAULT_STATE.color);assert.equal(state.view,'sand');assert.equal(state.material,'aluminum');
  assert.equal(state.exportSize,3840);assert.equal(state.running,true);assert.equal(state.aspect,2);
});
