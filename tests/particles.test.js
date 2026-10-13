import test from 'node:test';
import assert from 'node:assert/strict';
import { createField, DEFAULT_STATE, PRESETS, naturalFrequency, sampleGrid } from '../physics.js';
import { advanceParticles, random } from '../renderer.js';

test('A sustained simulation keeps a complete nodal ring instead of collapsing into grid minima',()=>{
  const field=createField(PRESETS[0],DEFAULT_STATE,naturalFrequency(1,3,DEFAULT_STATE),.015,1,192),rng=random(513),p=new Float32Array(4000*4);
  for(let i=0;i<p.length;i+=4){p[i]=.04+rng()*.92;p[i+1]=.04+rng()*.92;p[i+2]=rng();p[i+3]=.07+rng()*.93;}
  for(let step=0;step<1800;step++)advanceParticles(p,field,1.2,rng);
  const sectors=Array(16).fill(0);let settled=0;
  for(let i=0;i<p.length;i+=4){
    assert.ok(Number.isFinite(p[i])&&Number.isFinite(p[i+1]));
    const re=sampleGrid(field.real,192,p[i],p[i+1]),im=sampleGrid(field.imaginary,192,p[i],p[i+1]);
    if(re*re+im*im<.0004&&Math.hypot(p[i]-.5,p[i+1]-.5)<.4){settled++;const angle=(Math.atan2(p[i+1]-.5,p[i]-.5)+Math.PI)/(2*Math.PI);sectors[Math.min(15,Math.floor(angle*16))]++;}
  }
  assert.ok(settled>3500,`${settled} particles settled`);
  assert.ok(sectors.every(count=>count>30),`Angular distribution: ${sectors.join(',')}`);
});
