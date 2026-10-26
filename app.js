import { MATERIALS, PRESETS, DEFAULT_STATE, validateState, naturalFrequency, createField } from './physics.js';
import { SandRenderer, paintPreview } from './renderer.js';

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const number = (v,digits=1) => new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(v);
const storageKey = 'resona.settings.v1';
let stored;
try { stored=JSON.parse(localStorage.getItem(storageKey)); } catch { stored=null; }
let state=validateState(stored || DEFAULT_STATE);
if(!stored && matchMedia('(prefers-reduced-motion: reduce)').matches)state.running=false;
let field, galleryFilter='all', page='studio', settings='physics', rebuild=false, appearanceDirty=false;
let audio=null, oscillator=null, gain=null, soundOn=false, sweepOn=false, last=0, saveTimer, toastTimer, galleryVersion=0;
const palettes={sand:['#e7d7b1','#090a09'],chalk:['#ecece2','#101211'],cobalt:['#8faaff','#0a101d'],ember:['#f18b66','#140c09'],moss:['#b2d19f','#0a110b']};

function notify(message){$('status').textContent=message;$('status').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('status').classList.remove('visible'),4000);}
const renderer = new SandRenderer($('sand'),$('field'),notify);

function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}},200);}
function preset(){return PRESETS[state.preset];}
function rebuildField(){
  if(state.tuning==='patterns')state.frequency=naturalFrequency(preset().m,preset().n,state);
  field=createField(preset(),state,state.frequency,state.damping,state.mix,192,state.tuning==='manual');
  renderer.configure(state,field);syncUI();updateSound();rebuild=false;appearanceDirty=false;save();
}
function pressed(selector,value,attr){for(const el of $$(selector))el.setAttribute('aria-pressed',String(el.dataset[attr]===String(value)));}
function syncUI(){
  const p=preset();
  $('frequency-value').textContent=number(state.frequency,1);
  $('pattern-index').textContent=`${String(state.preset+1).padStart(2,'0')} / ${PRESETS.length}`;
  $('pattern-name').textContent=state.tuning==='patterns'?p.name:'Manual tuning';
  const mode=state.tuning==='manual'?field?.response.dominantMode:null;
  $('mode-label').textContent=mode?`Main mode (${mode.m}, ${mode.n}) · ${number(mode.frequency,1)} Hz`:(p.m===p.n?`Mode (${p.m}, ${p.n})`:`Modes (${p.m}, ${p.n}) ${state.mix<0?'−':'+'} (${p.n}, ${p.m})`);
  const description=`${state.tuning==='patterns'?p.name:'Manual pattern'}, ${number(state.frequency)} Hz`;
  $('sand').setAttribute('aria-label',`${description}, ${state.count} sand particles`);
  $('sand').setAttribute('aria-hidden',String(state.view!=='sand'));
  $('field').setAttribute('aria-hidden',String(state.view==='sand'));
  $('field').setAttribute('role','img');$('field').setAttribute('aria-label',`${state.view==='field'?'Vibration field':'Contours'}, ${description}`);
  $('pattern-tuner').hidden=state.tuning!=='patterns';$('manual-tuner').hidden=state.tuning!=='manual';
  for(const key of ['thickness','length','damping','mix','count','grain','spread','exposure','material','color','background'])$(key).value=state[key];
  if(document.activeElement!==$('frequency'))$('frequency').value=state.frequency.toFixed(1);
  $('frequency-slider').value=state.frequency;
  $('thickness-output').textContent=number(state.thickness)+' mm';$('length-output').textContent=number(state.length,0)+' cm';
  $('damping-output').textContent=number(state.damping,3);$('mix-output').textContent=(state.mix>=0?'+':'')+number(state.mix,2);
  $('count-output').textContent=number(state.count,0);
  for(const key of ['grain','spread','exposure'])$(key+'-output').textContent=number(state[key]);
  $('mix').disabled=state.tuning==='manual'||p.m===p.n;
  $('transparent').checked=state.transparent;$('margins').checked=state.margins;
  $('export-dimensions').textContent=`${state.exportSize} × ${Math.round(state.exportSize/state.aspect)} px`;
  $('pause').textContent=state.running?'Ⅱ':'▷';$('pause').setAttribute('aria-label',state.running?'Pause the sand':'Resume the sand');$('pause').setAttribute('aria-pressed',String(!state.running));
  $('live-state').textContent=state.running?'Simulation running':'Simulation paused';
  pressed('[data-tuning]',state.tuning,'tuning');pressed('[data-view]',state.view,'view');pressed('[data-size]',state.exportSize,'size');pressed('[data-aspect]',state.aspect,'aspect');
  for(const el of $$('[data-palette]'))el.setAttribute('aria-pressed',String(palettes[el.dataset.palette][0]===state.color&&palettes[el.dataset.palette][1]===state.background));
  for(const el of $$('input[type=range]'))el.style.setProperty('--progress',((Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))*100)+'%');
  const plate=$('plate');plate.style.aspectRatio=state.aspect;plate.style.background=state.background;
  plate.style.width='100%';plate.style.height='auto';
}

function change(update,physics=false){Object.assign(state,update);if(physics)rebuild=true;else appearanceDirty=true;syncUI();save();}
function stopSweep(){sweepOn=false;$('sweep').setAttribute('aria-pressed','false');$('sweep').textContent='Start resonance sweep';}
function choosePattern(index){stopSweep();state.preset=(index+PRESETS.length)%PRESETS.length;state.mix=preset().mix;state.tuning='patterns';rebuildField();showPage('studio');}

function showPage(next){
  page=next;$('studio-page').hidden=next!=='studio';$('gallery-page').hidden=next!=='gallery';
  $('nav-studio').setAttribute('aria-pressed',String(next==='studio'));$('nav-gallery').setAttribute('aria-pressed',String(next==='gallery'));
  history.replaceState(null,'',next==='gallery'?'#collection':'#studio');
  if(next==='gallery')renderGallery();else {syncUI();resize();}
}
function resize(){const rect=$('plate-wrap').getBoundingClientRect();if(rect.width===0)return;syncUI();const bounds=$('plate').getBoundingClientRect();renderer.resize(bounds.width,bounds.height);}
new ResizeObserver(()=>{if(page==='studio')resize();}).observe($('plate-wrap'));
const mobileLayout=matchMedia('(max-width:1024px)');
function orderPanels(){const layout=document.querySelector('.studio-layout'),canvas=document.querySelector('.canvas-panel'),left=document.querySelector('.left-panel');layout.insertBefore(mobileLayout.matches?canvas:left,mobileLayout.matches?left:canvas);}
mobileLayout.addEventListener('change',orderPanels);orderPanels();

function renderGallery(){
  const version=++galleryVersion,grid=$('gallery-grid');grid.replaceChildren();
  const list=PRESETS.filter(p=>galleryFilter==='all'||p.category===galleryFilter);
  const count=list.length,ending=count===1?'pattern':'patterns';
  $('gallery-count').textContent=`${count} ${ending}`;
  const pending=[];
  for(const p of list){
    const button=document.createElement('button');button.className='pattern-card';button.setAttribute('aria-label',`Open pattern ${p.name} in the lab`);
    const canvas=document.createElement('canvas');canvas.width=280;canvas.height=280;canvas.setAttribute('aria-hidden','true');
    const cap=document.createElement('div');cap.className='card-caption';const title=document.createElement('h2');title.textContent=p.name;const frequency=document.createElement('span');frequency.textContent=number(naturalFrequency(p.m,p.n,state),1)+' Hz';cap.append(title,frequency);
    button.append(canvas,cap);button.addEventListener('click',()=>{choosePattern(p.id);$('pause').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});});grid.append(button);pending.push({p,canvas});
  }
  let i=0;
  function batch(){if(version!==galleryVersion)return;for(let k=0;k<4&&i<pending.length;k++,i++){const {p,canvas}=pending[i];const f=createField(p,state,naturalFrequency(p.m,p.n,state),state.damping,p.mix,128);paintPreview(canvas,f,state.color);}if(i<pending.length)requestAnimationFrame(batch);}
  batch();
}

$('nav-studio').addEventListener('click',()=>showPage('studio'));$('nav-gallery').addEventListener('click',()=>showPage('gallery'));
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();showPage('studio');});
$('previous').addEventListener('click',()=>choosePattern(state.preset-1));$('next').addEventListener('click',()=>choosePattern(state.preset+1));
$('random-pattern').addEventListener('click',()=>{
  // Pick any other preset, preserving the current plate and appearance settings.
  const candidate=Math.floor(Math.random()*(PRESETS.length-1));
  choosePattern(candidate>=state.preset?candidate+1:candidate);
  renderer.reset();
  if(state.view==='sand')for(let i=0;i<35;i++)renderer.update(1);
  renderer.draw();
  $('pattern-change').textContent=`Selected pattern: ${preset().name}`;
});
for(const el of $$('[data-tuning]'))el.addEventListener('click',()=>{stopSweep();change({tuning:el.dataset.tuning},true);});
for(const el of $$('[data-view]'))el.addEventListener('click',()=>change({view:el.dataset.view}));
for(const el of $$('[data-size]'))el.addEventListener('click',()=>change({exportSize:Number(el.dataset.size)}));
for(const el of $$('[data-aspect]'))el.addEventListener('click',()=>{change({aspect:Number(el.dataset.aspect)},true);resize();});
for(const key of ['thickness','length','damping','mix','count','grain','spread','exposure'])$(key).addEventListener('input',()=>change({[key]:Number($(key).value)},['thickness','length','damping','mix'].includes(key)));
$('material').addEventListener('change',()=>change({material:$('material').value},true));
for(const key of ['color','background'])$(key).addEventListener('input',()=>change({[key]:$(key).value}));
for(const el of $$('[data-palette]'))el.addEventListener('click',()=>{const [color,background]=palettes[el.dataset.palette];change({color,background});});
for(const key of ['transparent','margins'])$(key).addEventListener('change',()=>change({[key]:$(key).checked}));
for(const el of $$('[data-settings]'))el.addEventListener('click',()=>{settings=el.dataset.settings;pressed('[data-settings]',settings,'settings');$('physics-settings').hidden=settings!=='physics';$('appearance-settings').hidden=settings!=='appearance';});
for(const el of $$('[data-filter]'))el.addEventListener('click',()=>{galleryFilter=el.dataset.filter;pressed('[data-filter]',galleryFilter,'filter');renderGallery();});

function setFrequency(value){
  const valid=Number.isFinite(value)&&value>=20&&value<=16000;$('frequency-error').hidden=valid;$('frequency').setAttribute('aria-invalid',String(!valid));
  if(valid){stopSweep();change({frequency:value,tuning:'manual'},true);}
}
$('frequency').addEventListener('input',()=>setFrequency($('frequency').valueAsNumber));
$('frequency').addEventListener('blur',()=>{if(!$('frequency-error').hidden){$('frequency').value=state.frequency.toFixed(1);$('frequency-error').hidden=true;$('frequency').setAttribute('aria-invalid','false');}});
$('frequency-slider').addEventListener('input',()=>setFrequency(Number($('frequency-slider').value)));
$('sweep').addEventListener('click',()=>{sweepOn=!sweepOn;$('sweep').setAttribute('aria-pressed',String(sweepOn));$('sweep').textContent=sweepOn?'Stop sweep':'Start resonance sweep';});
$('pause').addEventListener('click',()=>change({running:!state.running}));
$('reset-sand').addEventListener('click',()=>{renderer.reset();change({running:true});notify('Sand scattered again');});
$('reset-settings').addEventListener('click',()=>{stopSweep();state={...DEFAULT_STATE,running:!matchMedia('(prefers-reduced-motion: reduce)').matches};$('frequency-error').hidden=true;$('frequency').removeAttribute('aria-invalid');rebuildField();renderer.reset();resize();notify('Default settings restored');});

function updateSound(){if(oscillator&&audio)oscillator.frequency.setTargetAtTime(Math.min(16000,state.frequency),audio.currentTime,.04);}
async function toggleSound(){
  try{
    if(!audio){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('Unsupported');audio=new Audio();gain=audio.createGain();gain.gain.value=0;gain.connect(audio.destination);oscillator=audio.createOscillator();oscillator.type='sine';oscillator.connect(gain);oscillator.start();}
    await audio.resume();soundOn=!soundOn;updateSound();gain.gain.setTargetAtTime(soundOn?.035:0,audio.currentTime,.04);$('sound').setAttribute('aria-pressed',String(soundOn));$('sound-label').textContent=soundOn?'Sound off':'Sound on';
  }catch{notify('This browser could not turn on sound. Everything else still works.');}
}
$('sound').addEventListener('click',toggleSound);
document.addEventListener('visibilitychange',()=>{if(audio)gain.gain.setTargetAtTime(document.hidden?0:soundOn?.035:0,audio.currentTime,.04);});

$('export').addEventListener('click',async()=>{
  const button=$('export');button.disabled=true;button.textContent='Preparing PNG…';
  try{
    if(rebuild)rebuildField();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const out=renderer.exportCanvas(),blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('PNG export returned no image');
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`resona-${state.tuning==='manual'?'manual':preset().id+1}-${Math.round(state.frequency)}Hz-${out.width}x${out.height}.png`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);notify(`PNG ready · ${out.width} × ${out.height} px`);
  }catch{notify('Could not save the PNG. Try a smaller size.');}
  finally{button.disabled=false;button.textContent='Download PNG';}
});

const dialog=$('about-dialog');let returnFocus;
$('about-open').addEventListener('click',()=>{returnFocus=document.activeElement;dialog.showModal();$('about-close').focus();});
function closeDialog(){dialog.close();returnFocus?.focus();}
$('about-close').addEventListener('click',closeDialog);dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))closeDialog();});
dialog.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const items=[...dialog.querySelectorAll('button,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first.focus();}});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('plate-wrap').requestFullscreen();}catch{notify('Full screen is not available in this browser.');}});
$('fullscreen-close').addEventListener('click',async()=>{try{await document.exitFullscreen();}catch{}$('fullscreen').focus({preventScroll:true});resize();});
document.addEventListener('fullscreenchange',()=>{resize();if(document.fullscreenElement)$('fullscreen-close').focus();});

function animate(time){
  const dt=last?Math.min(2,(time-last)/16.667):1;last=time;
  if(!document.hidden){
    if(sweepOn&&page==='studio'){state.frequency=Math.min(16000,state.frequency+Math.max(.2,state.frequency*.0025)*dt);if(state.frequency>=16000)stopSweep();rebuild=true;}
    if(rebuild)rebuildField();else if(appearanceDirty){renderer.configure(state,field);appearanceDirty=false;}
    if(page==='studio'&&state.running&&state.view==='sand'){renderer.update(dt);renderer.draw();}
  }
  requestAnimationFrame(animate);
}
rebuildField();resize();
if(location.hash==='#collection')showPage('gallery');
requestAnimationFrame(animate);
