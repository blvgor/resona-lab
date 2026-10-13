import { sampleGrid } from './physics.js';

export function rgb(hex) { return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)); }
export function random(seed = 713) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15,1 | seed); t ^= t + Math.imul(t ^ t >>> 7,61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function advanceParticles(p,f,spread,rng,dt=1) {
  const rate=Math.min(dt,2);
  for(let i=0;i<p.length;i+=4){
    const x=p[i],y=p[i+1];
    const re=sampleGrid(f.real,f.size,x,y),im=sampleGrid(f.imaginary,f.size,x,y),u=re*re+im*im;
    if(p[i+3]<.065){p[i]+=(rng()-.5)*.0006;p[i+1]+=(rng()-.5)*.0006;}
    else{
      // Interpolate displacement BEFORE squaring. Interpolating squared samples creates
      // grid-dependent false minima and causes sand to drift into isolated clumps.
      const gx=2*(re*sampleGrid(f.realX,f.size,x,y)+im*sampleGrid(f.imaginaryX,f.size,x,y));
      const gy=2*(re*sampleGrid(f.realY,f.size,x,y)+im*sampleGrid(f.imaginaryY,f.size,x,y));
      const den=gx*gx+gy*gy+.0002,scale=Math.min(.7*rate,u/den*1.1*rate);
      const jitter=(.0012*spread+Math.min(.002,Math.sqrt(u)*.002))*Math.sqrt(rate);
      p[i]+=Math.max(-.018,Math.min(.018,-gx*scale))+(rng()-.5)*jitter;
      p[i+1]+=Math.max(-.018,Math.min(.018,-gy*scale))+(rng()-.5)*jitter;
    }
    if(p[i]<.025||p[i]>.975||p[i+1]<.025||p[i+1]>.975){p[i]=.07+rng()*.86;p[i+1]=.07+rng()*.86;}
  }
}

export class SandRenderer {
  constructor(canvas, fieldCanvas, onError) {
    this.canvas = canvas; this.fieldCanvas = fieldCanvas; this.rng = random(); this.onError = onError;
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (this.gl) this.initGL(); else this.ctx = canvas.getContext('2d');
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; onError('Графика приостановлена. Ожидаем восстановления.'); });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.initGL(); onError('Графика восстановлена.'); this.draw(); });
  }
  initGL() {
    const gl = this.gl;
    const shader = (type,source) => { const s = gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s); if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    this.program = gl.createProgram();
    gl.attachShader(this.program,shader(gl.VERTEX_SHADER,'attribute vec4 aParticle; uniform float uSize; varying float vLight; void main(){gl_Position=vec4(aParticle.x*2.0-1.0,1.0-aParticle.y*2.0,0.0,1.0);gl_PointSize=uSize*(0.65+aParticle.w*0.7);vLight=aParticle.z;}'));
    gl.attachShader(this.program,shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform vec3 uColor;uniform float uExposure;varying float vLight;void main(){vec2 p=gl_PointCoord-0.5;float a=1.0-smoothstep(0.12,0.5,length(p));gl_FragColor=vec4(uColor*vLight*uExposure,a*0.48);}'));
    gl.linkProgram(this.program); if (!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program); this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    const attr = gl.getAttribLocation(this.program,'aParticle'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr,4,gl.FLOAT,false,16,0);
    this.uniforms = Object.fromEntries(['uSize','uColor','uExposure'].map(k=>[k,gl.getUniformLocation(this.program,k)]));
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  }
  configure(state, field) {
    this.state = state; this.field = field;
    if (!this.particles || this.particles.length !== state.count * 4) {
      const previous = this.particles; this.particles = new Float32Array(state.count * 4);
      for (let i=0;i<state.count;i++) {
        const j=i*4;
        if (previous && j<previous.length) this.particles.set(previous.subarray(j,j+4),j);
        else { this.particles[j]=.025+this.rng()*.95;this.particles[j+1]=.025+this.rng()*.95;this.particles[j+2]=.3+this.rng()*.7;this.particles[j+3]=this.rng(); }
      }
      if (!previous) for (let i=0;i<35;i++) this.update(1);
    }
    this.drawField(); this.draw();
  }
  resize(width,height) {
    const dpr = Math.min(window.devicePixelRatio || 1,2);
    this.dpr=dpr; this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
    this.fieldCanvas.width=this.canvas.width;this.fieldCanvas.height=this.canvas.height;
    if (this.gl) this.gl.viewport(0,0,this.canvas.width,this.canvas.height);
    if(this.state) {this.drawField();this.draw();}
  }
  reset() {
    for(let i=0;i<this.particles.length;i+=4){this.particles[i]=.025+this.rng()*.95;this.particles[i+1]=.025+this.rng()*.95;}
    this.draw();
  }
  update(dt=1) {
    if (!this.field || this.lost) return;
    advanceParticles(this.particles,this.field,this.state.spread,this.rng,dt);
  }
  draw() {
    if(!this.state||this.lost)return;
    const s=this.state;
    this.canvas.style.visibility=s.view==='sand'?'visible':'hidden';
    this.fieldCanvas.style.visibility=s.view==='sand'?'hidden':'visible';
    if(s.view!=='sand')return;
    if(this.gl) {
      const gl=this.gl,bg=rgb(s.background),c=rgb(s.color);
      gl.clearColor(bg[0]/255,bg[1]/255,bg[2]/255,1);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.particles,gl.DYNAMIC_DRAW);
      gl.uniform1f(this.uniforms.uSize,s.grain*(this.dpr||1)*1.35);gl.uniform3f(this.uniforms.uColor,c[0]/255,c[1]/255,c[2]/255);gl.uniform1f(this.uniforms.uExposure,s.exposure);
      gl.drawArrays(gl.POINTS,0,this.particles.length/4);
    } else this.paintSand(this.ctx,this.canvas.width,this.canvas.height,false,0);
  }
  paintSand(ctx,w,h,transparent=false,pad=0) {
    ctx.clearRect(0,0,w,h);const s=this.state,p=this.particles,c=rgb(s.color);
    if(!transparent){ctx.fillStyle=s.background;ctx.fillRect(0,0,w,h);}
    const innerW=w-pad*2,innerH=h-pad*2,scale=innerW/(this.canvas.clientWidth||600),r=Math.max(.45,s.grain*scale*.42);
    // Native pixels on a separate canvas; export never stretches a screen capture.
    for(let band=0;band<4;band++){
      ctx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},${Math.min(1,(.19+band*.13)*s.exposure)})`;ctx.beginPath();
      for(let i=0;i<p.length;i+=4)if(Math.min(3,Math.floor(p[i+2]*4))===band){const x=pad+p[i]*innerW,y=pad+p[i+1]*innerH;ctx.moveTo(x+r,y);ctx.arc(x,y,r*(.65+p[i+3]*.7),0,Math.PI*2);}
      ctx.fill();
    }
  }
  drawField() {
    if(!this.state||!this.field||!this.fieldCanvas.width)return;
    this.paintField(this.fieldCanvas.getContext('2d'),this.fieldCanvas.width,this.fieldCanvas.height,false,0);
  }
  paintField(ctx,w,h,transparent=false,pad=0) {
    const s=this.state,f=this.field,iw=w-2*pad,ih=h-2*pad;
    ctx.clearRect(0,0,w,h);if(!transparent){ctx.fillStyle=s.background;ctx.fillRect(0,0,w,h);}
    if(s.view==='field'){
      const tile=document.createElement('canvas');tile.width=f.size;tile.height=f.size;const tc=tile.getContext('2d'),im=tc.createImageData(f.size,f.size);
      for(let i=0;i<f.signed.length;i++){const v=Math.max(-1,Math.min(1,f.signed[i])),mag=Math.pow(Math.abs(v),.55),color=v>0?[221,162,94]:[75,130,173];for(let k=0;k<3;k++)im.data[i*4+k]=color[k];im.data[i*4+3]=Math.round(mag*235);}
      tc.putImageData(im,0,0);ctx.drawImage(tile,pad,pad,iw,ih);
    }
    const levels=s.view==='contours'?[0,-.25,.25,-.5,.5]:[0];
    for(const level of levels){ctx.strokeStyle=s.color;ctx.globalAlpha=level===0?.9:.2;ctx.lineWidth=(level===0?1.2:.6)*w/(this.canvas.clientWidth||600);ctx.beginPath();
      for(let y=1;y<f.size-2;y++)for(let x=1;x<f.size-2;x++){
        const j=y*f.size+x,v=[f.signed[j]-level,f.signed[j+1]-level,f.signed[j+f.size+1]-level,f.signed[j+f.size]-level];
        const points=[];for(let edge=0;edge<4;edge++){const next=(edge+1)%4;if((v[edge]<0)===(v[next]<0))continue;const t=v[edge]/(v[edge]-v[next]),corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],a=corners[edge],b=corners[next];points.push([pad+(a[0]+(b[0]-a[0])*t)*iw/(f.size-1),pad+(a[1]+(b[1]-a[1])*t)*ih/(f.size-1)]);}
        for(let k=0;k+1<points.length;k+=2){ctx.moveTo(...points[k]);ctx.lineTo(...points[k+1]);}
      }ctx.stroke();ctx.globalAlpha=1;
    }
  }
  exportCanvas() {
    const s=this.state,out=document.createElement('canvas');out.width=s.exportSize;out.height=Math.round(s.exportSize/s.aspect);
    const pad=s.margins?Math.round(out.height*.06):0;
    if(s.view==='sand')this.paintSand(out.getContext('2d'),out.width,out.height,s.transparent,pad);
    else this.paintField(out.getContext('2d'),out.width,out.height,s.transparent,pad);
    return out;
  }
}

export function paintPreview(canvas,field,color='#e7d7b1') {
  const ctx=canvas.getContext('2d'),size=canvas.width,c=rgb(color),rnd=random(73),image=ctx.createImageData(size,size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=.025+x/size*.95,sy=.025+y/size*.95,value=sampleGrid(field.values,field.size,sx,sy);
    const gradient=Math.hypot(sampleGrid(field.gx,field.size,sx,sy),sampleGrid(field.gy,field.size,sx,sy));
    const distance=2*value/(gradient+.000001),prob=Math.exp(-distance*distance*18000),r=rnd(),j=(y*size+x)*4;
    const intensity=Math.min(1,prob*(.45+r*.75)+(r>.993?.12:0));
    for(let k=0;k<3;k++)image.data[j+k]=Math.round(9*(1-intensity)+c[k]*intensity);image.data[j+3]=255;
  }ctx.putImageData(image,0,0);
}
