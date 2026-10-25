'use strict';
/* ===== CONFIG : par défaut, services gratuits sans clé. ENDPOINT (optionnel) = ton propre backend, voir worker.js. ===== */
const CONFIG={ENDPOINT:'',FREE_LLM:'https://text.pollinations.ai',TIMEOUT:25000,LANG:'fr-FR'};

const $=id=>document.getElementById(id);
const cv=$('orb'),x=cv.getContext('2d'),stEl=$('state'),txEl=$('text'),inEl=$('q');
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const LABEL={idle:'Touche pour parler',listen:'Je t’écoute…',think:'Je réfléchis…',speak:'Je réponds…',error:'Un souci'};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
let state='idle',lv=0,ph=0,last=0,W=0,H=0,stream=null,ac=null,an=null,buf=null,rec=null,hist=[],voice=null,ty,et;

function setState(s,msg){state=s;stEl.textContent=LABEL[s];if(msg!==undefined)txEl.textContent=msg}
function type(m){clearInterval(ty);let i=0;txEl.textContent='';ty=setInterval(()=>{txEl.textContent=m.slice(0,++i);if(i>=m.length)clearInterval(ty)},reduce?0:22)}
function showInput(){inEl.hidden=false}
function fail(msg){stopListen();setState('error',msg);clearTimeout(et);et=setTimeout(()=>{if(state==='error')setState('idle')},6000)}

/* ---------- Microphone réel (getUserMedia + AnalyserNode) ---------- */
async function startMic(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw{name:'Unsupported'};
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  const AC=window.AudioContext||window.webkitAudioContext;
  ac=new AC();if(ac.state==='suspended')await ac.resume();
  const src=ac.createMediaStreamSource(stream);
  an=ac.createAnalyser();an.fftSize=512;an.smoothingTimeConstant=.8;src.connect(an);
  buf=new Uint8Array(an.fftSize);
}
function stopMic(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;try{if(ac)ac.close()}catch(e){}ac=an=null}
function level(){if(!an)return 0;an.getByteTimeDomainData(buf);let s=0;for(let i=0;i<buf.length;i++){const d=(buf[i]-128)/128;s+=d*d}return Math.min(1,Math.sqrt(s/buf.length)*4)}
function micMsg(e){
  switch(e&&e.name){
    case'NotAllowedError':case'SecurityError':return'Micro refusé. Réglages ▸ Safari ▸ Micro, ou aA ▸ Réglages du site ▸ Micro.';
    case'NotFoundError':return'Aucun micro détecté.';
    case'NotReadableError':return'Le micro est utilisé par une autre application.';
    case'Unsupported':return'Micro indisponible dans ce navigateur.';
    default:return'Micro indisponible ('+((e&&e.name)||'erreur')+').'}
}

/* ---------- Écoute + reconnaissance vocale ---------- */
async function startListen(){
  if(!window.isSecureContext){fail('Le micro exige HTTPS. Ouvre cette page depuis une adresse https://.');return}
  try{await startMic()}catch(e){fail(micMsg(e));return}
  setState('listen','');
  if(!SR){txEl.textContent='Reconnaissance vocale indisponible ici. Écris ta demande ci-dessous.';showInput();return}
  startRec();
}
function startRec(){
  const r=new SR();rec=r;r.lang=CONFIG.LANG;r.interimResults=true;r.continuous=false;
  let fin='';
  r.onresult=e=>{let it='';for(let i=e.resultIndex;i<e.results.length;i++){const s=e.results[i];if(s.isFinal)fin+=s[0].transcript;else it+=s[0].transcript}txEl.textContent=(fin+it).trim()};
  r.onerror=e=>{
    if(e.error==='no-speech')txEl.textContent='Je n’ai rien entendu. Touche la sphère pour réessayer.';
    else if(e.error==='not-allowed'||e.error==='service-not-allowed'){fail('Reconnaissance vocale refusée. Réglages ▸ Safari ▸ Micro et Reconnaissance vocale.');showInput()}
    else if(e.error!=='aborted'){fail('Reconnaissance vocale : '+e.error+'. Tu peux écrire ta demande.');showInput()}};
  r.onend=()=>{if(rec!==r)return;rec=null;const q=fin.trim();if(state!=='listen')return;stopListen();if(q)ask(q);else setState('idle')};
  try{r.start()}catch(e){fail('Reconnaissance vocale indisponible.');showInput()}
}
function stopListen(){if(rec){const r=rec;rec=null;r.onend=null;try{r.abort()}catch(e){}}stopMic()}

/* ---------- Réponses : services gratuits sans clé, appelés depuis l’iPhone ---------- */
const SYS='Tu es Xenora, une IA vocale futuriste à la voix de femme, chaleureuse, curieuse et intelligente. Tu réfléchis, tu donnes ton avis, tu relances si utile. Réponds en français, en 2 à 4 phrases courtes, sans markdown ni emoji, faites pour être lues à voix haute. La météo, la date, l’heure et Wikipédia sont gérés par l’application ; si tu ne sais pas quelque chose, dis-le franchement sans inventer.';
try{hist=JSON.parse(localStorage.getItem('xen_h')||'[]')}catch(e){}
const WMO={0:'ciel dégagé',1:'plutôt dégagé',2:'partiellement nuageux',3:'couvert',45:'brouillard',48:'brouillard givrant',51:'bruine légère',53:'bruine',55:'bruine forte',61:'pluie faible',63:'pluie',65:'forte pluie',71:'neige faible',73:'neige',75:'forte neige',80:'averses',81:'averses',82:'fortes averses',95:'orage',96:'orage avec grêle',99:'orage avec grêle'};
const J=async u=>{const r=await fetch(u);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()};
const pos=()=>new Promise((ok,ko)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>ok(p.coords),()=>ko(new Error('position refusée')),{timeout:8000,maximumAge:600000}):ko(new Error('position indisponible')));
async function meteo(q){
  try{
    const m=q.match(/(?:\bà|\bau|\bde|\bpour|\bsur|\ben)\s+([\p{L}\-' ]+?)(?:\s+(?:aujourd|demain|ce|cet|cette|maintenant)|[?.!,]|$)/iu);
    const city=m&&!/^(demain|aujourd|ce|cet|cette|la|le|l|les|quoi)\b/i.test(m[1])?m[1].trim():'';
    let lat,lon,lieu='Chez toi';
    if(city){const g=await J('https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&name='+encodeURIComponent(city));
      if(g.results&&g.results[0]){lat=g.results[0].latitude;lon=g.results[0].longitude;lieu='À '+g.results[0].name}}
    if(lat===undefined){const c=await pos();lat=c.latitude;lon=c.longitude}
    const w=await J('https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&current=temperature_2m,apparent_temperature,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2');
    const dem=/demain/i.test(q),i=dem?1:0,d=w.daily,c=w.current,r=Math.round;
    const fin=' entre '+r(d.temperature_2m_min[i])+' et '+r(d.temperature_2m_max[i])+' degrés, '+(WMO[d.weather_code[i]]||'temps variable')+', '+(d.precipitation_probability_max[i]||0)+' % de risque de pluie.';
    return dem?'Demain '+lieu.toLowerCase().replace('à ','à ')+','+fin:lieu+', il fait '+r(c.temperature_2m)+' degrés, '+(WMO[c.weather_code]||'temps variable')+', ressenti '+r(c.apparent_temperature)+'. Aujourd’hui'+fin;
  }catch(e){return'Je n’ai pas pu obtenir la météo ('+e.message+'). Dis-moi une ville, par exemple « météo à Lyon ».'}
}
async function wiki(q){
  const sub=q.replace(/^(qui est|qui était|c[’']est quoi|qu[’']est-ce (?:que|qu[’'])|parle-moi d[eu]|explique-moi)\s+(l[ae]s?\s+|l[’']|un\s+|une\s+|d[eu]\s+)?/i,'').replace(/[?.!]/g,'').trim();
  const r=await J('https://fr.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch='+encodeURIComponent(sub));
  const hit=r.query&&r.query.search&&r.query.search[0];if(!hit)return null;
  const p=await J('https://fr.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(hit.title));
  return p.extract?p.extract.split(/(?<=[.!?])\s+/).slice(0,2).join(' '):null;
}
async function route(q){
  const n=new Date();
  if(/m[ée]t[ée]o|quel temps|pleuvoir|il pleut|il fait (chaud|froid|beau)/i.test(q))return meteo(q);
  if(/quelle heure|l[’']heure/i.test(q))return'Il est '+n.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'.';
  if(/quel jour|la date|quelle date/i.test(q))return'Nous sommes le '+n.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+'.';
  if(/^(qui (est|était)|c[’']est quoi|qu[’']est-ce (que|qu)|parle-moi d|explique-moi)/i.test(q)){try{return await wiki(q)}catch(e){return null}}
  return null;
}
async function llm(signal){
  const now=new Date().toLocaleString('fr-FR'),msgs=[{role:'system',content:SYS+' Date et heure : '+now+'.'}].concat(hist.slice(-12));
  if(CONFIG.ENDPOINT){
    const r=await fetch(CONFIG.ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},signal,
      body:JSON.stringify({message:hist[hist.length-1].content,history:hist.slice(-9,-1),now,tz:Intl.DateTimeFormat().resolvedOptions().timeZone})});
    if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();
    if(!d||typeof d.reply!=='string'||!d.reply.trim())throw new Error('réponse invalide');return d.reply.trim();
  }
  try{
    const r=await fetch(CONFIG.FREE_LLM+'/openai',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({model:'openai',messages:msgs})});
    if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();
    const a=d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content;if(!a)throw new Error('réponse invalide');return a.trim();
  }catch(e){
    if(e.name==='AbortError')throw e;
    const r=await fetch(CONFIG.FREE_LLM+'/'+encodeURIComponent(hist[hist.length-1].content)+'?model=openai&system='+encodeURIComponent(msgs[0].content),{signal});
    if(!r.ok)throw new Error('HTTP '+r.status);const a=(await r.text()).trim();if(!a)throw new Error('réponse vide');return a;
  }
}
async function ask(q){
  setState('think',q);hist.push({role:'user',content:q});
  const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),CONFIG.TIMEOUT);
  try{reply((await route(q))||(await llm(ctl.signal)).replace(/[*_#`]/g,''))}
  catch(e){hist.pop();fail(e.name==='AbortError'?'Délai dépassé : le service ne répond pas.':'Je n’arrive pas à joindre le service de réponse ('+e.message+').')}
  finally{clearTimeout(to)}
}

/* ---------- Réponse + voix (Amélie si installée) ---------- */
let voices=[],vi=0;const savedV=(()=>{try{return localStorage.getItem('xen_v')||''}catch(e){return''}})();
function pickVoice(){if(!('speechSynthesis' in window))return;
  const sc=v=>(v.name===savedV?500:0)+(/siri/i.test(v.name)?200:0)+(/premium|enhanced|am[eé]lior/i.test(v.name)?100:0)+(/am[eé]lie/i.test(v.name)?50:/audrey|aur[eé]lie|marie/i.test(v.name)?20:0);
  voices=speechSynthesis.getVoices().filter(v=>/^fr/i.test(v.lang)).sort((p,q)=>sc(q)-sc(p));voice=voices[0]||null}
if('speechSynthesis' in window){pickVoice();speechSynthesis.onvoiceschanged=pickVoice}
const ELV={sarah:'EXAVITQu4vr4xnSDxMaL',rachel:'21m00Tcm4TlvDq8ikWAM',aria:'9BWtsMINqrJLrRacOk9x'};
const LSg=k=>{try{return localStorage.getItem(k)||''}catch(e){return''}};
const LSs=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k)}catch(e){}};
const au=new Audio();au.playsInline=true;
const SIL='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
const unlockAudio=()=>{try{au.src=SIL;au.play().catch(()=>{})}catch(e){}};
function sysSpeak(a){
  if(!('speechSynthesis' in window)){setTimeout(()=>{if(state==='speak')setState('idle')},a.length*50);return}
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(a);u.lang=CONFIG.LANG;if(voice)u.voice=voice;u.rate=.97;
  u.onend=u.onerror=()=>{if(state==='speak')setState('idle')};speechSynthesis.speak(u);
}
async function elSpeak(a){
  const r=await fetch('https://api.elevenlabs.io/v1/text-to-speech/'+(ELV[LSg('xen_elv')]||ELV.sarah)+'?output_format=mp3_44100_64',{method:'POST',
    headers:{'xi-api-key':LSg('xen_el'),'Content-Type':'application/json',Accept:'audio/mpeg'},
    body:JSON.stringify({text:a.slice(0,600),model_id:'eleven_flash_v2_5',voice_settings:{stability:.45,similarity_boost:.8}})});
  if(!r.ok)throw new Error('HTTP '+r.status);
  au.src=URL.createObjectURL(await r.blob());au.onended=au.onerror=()=>{if(state==='speak')setState('idle')};await au.play();
}
function reply(a){
  hist.push({role:'assistant',content:a});try{localStorage.setItem('xen_h',JSON.stringify(hist.slice(-20)))}catch(e){}
  setState('speak');type(a);au.pause();
  if(LSg('xen_el'))elSpeak(a).catch(e=>{stEl.textContent='Voix naturelle indisponible ('+e.message+')';sysSpeak(a)});else sysSpeak(a);
}
function voiceCmd(v){
  const arg=v.replace(/^\/voix\s*/i,'').trim(),low=arg.toLowerCase();
  inEl.value='';sendBtn.classList.remove('on');inEl.blur();unlockAudio();
  if(!arg){txEl.textContent=LSg('xen_el')?'Voix naturelle activée ('+(LSg('xen_elv')||'sarah')+'). Écris /voix off pour la couper, ou /voix sarah, /voix rachel, /voix aria.':'Écris /voix suivi de ta clé ElevenLabs pour activer une voix naturelle.';return}
  if(low==='off'){LSs('xen_el','');txEl.textContent='Voix naturelle désactivée.';return}
  if(ELV[low]){LSs('xen_elv',low);txEl.textContent='Voix : '+low+'.';if(LSg('xen_el')){setState('speak');elSpeak('Bonjour, voici ma voix.').catch(e=>{setState('idle');txEl.textContent='Voix indisponible ('+e.message+').'})}return}
  LSs('xen_el',arg);txEl.textContent='Clé enregistrée. Je teste ma nouvelle voix…';setState('speak');
  elSpeak('Bonjour, je suis Xenora. Voici ma nouvelle voix.').catch(e=>{LSs('xen_el','');setState('idle');txEl.textContent='Clé refusée ou quota atteint ('+e.message+').'});
}

/* ---------- Interactions : tout passe par la sphère ---------- */
function tap(){
  au.pause();unlockAudio();
  if('speechSynthesis' in window){speechSynthesis.cancel();try{speechSynthesis.speak(new SpeechSynthesisUtterance(''))}catch(e){}}
  if(state==='listen'){stopListen();setState('idle');return}
  if(state==='think')return;
  clearTimeout(et);startListen();
}
cv.addEventListener('click',tap);
cv.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();tap()}});
const sendBtn=$('send'),bar=document.querySelector('.bar');
function submit(){const v=inEl.value.trim();if(!v||state==='think')return;if(/^\/voix(\s|$)/i.test(v)){voiceCmd(v);return}inEl.value='';sendBtn.classList.remove('on');inEl.blur();if(state==='listen')stopListen();ask(v)}
inEl.addEventListener('keydown',e=>{if(e.key==='Enter')submit()});
inEl.addEventListener('input',()=>sendBtn.classList.toggle('on',!!inEl.value.trim()));
sendBtn.addEventListener('click',submit);
if(window.visualViewport){const vv=visualViewport,f=()=>{bar.style.transform='translateY('+(-Math.max(0,innerHeight-vv.height-vv.offsetTop))+'px)'};vv.addEventListener('resize',f);vv.addEventListener('scroll',f)}
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopListen();if('speechSynthesis' in window)speechSynthesis.cancel();if(state==='listen'||state==='speak')setState('idle')}});
stEl.style.pointerEvents='auto';
stEl.addEventListener('click',()=>{
  if(state!=='idle'||!voices.length||!('speechSynthesis' in window))return;
  vi=(vi+1)%voices.length;voice=voices[vi];try{localStorage.setItem('xen_v',voice.name)}catch(e){}
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance('Bonjour, voici ma voix.');u.lang=CONFIG.LANG;u.voice=voice;speechSynthesis.speak(u);
  txEl.textContent='Voix : '+voice.name+' ('+(vi+1)+'/'+voices.length+')'});
if(!SR)showInput();

/* ---------- Rendu : sphère Liquid Glass (Canvas 2D) ---------- */
const D=Math.min(devicePixelRatio||1,2);
function resize(){W=innerWidth;H=innerHeight;cv.width=W*D;cv.height=H*D;x.setTransform(D,0,0,D,0,0)}
addEventListener('resize',resize);addEventListener('orientationchange',resize);resize();
const PAL=['40,120,255','150,90,255','0,225,255','255,120,215','90,150,255'];
const ERRP=['255,150,60','255,80,80','255,120,150','255,200,160','255,110,70'];
function frame(ms){
  const dt=Math.min((ms-last)/1000||.016,.05);last=ms;
  ph+=dt*(reduce?.25:state==='think'?.7:state==='listen'?1.1:state==='speak'?1.3:.55);
  const tg=state==='listen'?.12+level()*.8:state==='speak'?.35+.25*Math.sin(ph*5)*Math.sin(ph*1.7):state==='think'?.1:state==='error'?.12:.05+.03*Math.sin(ph);
  lv+=(tg-lv)*.16;
  const pulse=state==='listen'&&!reduce?1+.025*Math.sin(ph*2.4):1,k=reduce?0:1,P=state==='error'?ERRP:PAL;
  const cx=W/2,cy=H*.4+(reduce?0:Math.sin(ph*.45)*4),R=Math.min(W*.34,H*.17)*(1+lv*.08)*pulse;
  x.clearRect(0,0,W,H);
  let g=x.createRadialGradient(cx,cy,R*.85,cx,cy,R*2.1);
  g.addColorStop(0,`rgba(${P[1]},${.26+lv*.22})`);g.addColorStop(.5,`rgba(${P[0]},.08)`);g.addColorStop(1,'rgba(0,0,0,0)');
  x.fillStyle=g;x.fillRect(0,0,W,H);
  const path=()=>{x.beginPath();for(let i=0;i<=90;i++){const a=i/90*6.2832,r=R*(1+k*((.015+lv*.09)*Math.sin(3*a+ph*1.8)+(.01+lv*.05)*Math.sin(5*a-ph*1.3)));
    i?x.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r):x.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r)}x.closePath()};
  path();g=x.createRadialGradient(cx-R*.2,cy-R*.25,R*.1,cx,cy,R);g.addColorStop(0,'rgba(14,20,48,.95)');g.addColorStop(1,'rgba(4,6,20,.95)');x.fillStyle=g;x.fill();
  x.save();x.clip();x.globalCompositeOperation='lighter';
  for(let i=0;i<5;i++){
    const a=ph*(.35+i*.11)+i*1.26,dist=R*(.5+.08*Math.sin(ph*.7+i)),bx=cx+Math.cos(a)*dist,by=cy+Math.sin(a*1.07)*dist,rad=R*(.5+.05*i);
    g=x.createRadialGradient(bx,by,0,bx,by,rad);g.addColorStop(0,`rgba(${P[i]},.6)`);g.addColorStop(1,`rgba(${P[i]},0)`);
    x.fillStyle=g;x.fillRect(cx-R*1.2,cy-R*1.2,R*2.4,R*2.4)}
  g=x.createRadialGradient(cx+R*.35,cy+R*.55,0,cx+R*.35,cy+R*.55,R*.7);g.addColorStop(0,`rgba(${P[2]},.4)`);g.addColorStop(1,`rgba(${P[2]},0)`);
  x.fillStyle=g;x.fillRect(cx-R,cy-R,R*2,R*2);
  x.globalCompositeOperation='source-over';
  g=x.createRadialGradient(cx,cy,R*.7,cx,cy,R*1.02);g.addColorStop(0,'rgba(170,200,255,0)');g.addColorStop(1,'rgba(170,200,255,.3)');
  x.fillStyle=g;x.fillRect(cx-R*1.2,cy-R*1.2,R*2.4,R*2.4);
  x.restore();
  let rim;
  if(x.createConicGradient){rim=x.createConicGradient(ph*.5,cx,cy);[0,1,2,3,4,0].forEach((c,i)=>rim.addColorStop(i/5,`rgba(${P[c]},.95)`))}
  else{rim=x.createLinearGradient(cx-R,cy-R,cx+R,cy+R);rim.addColorStop(0,`rgba(${P[2]},.9)`);rim.addColorStop(.5,`rgba(${P[1]},.9)`);rim.addColorStop(1,`rgba(${P[3]},.9)`)}
  path();x.strokeStyle=rim;x.lineWidth=R*.05;x.shadowColor=`rgba(${P[1]},.9)`;x.shadowBlur=18;x.stroke();x.shadowBlur=0;
  path();x.strokeStyle='rgba(255,255,255,.5)';x.lineWidth=1;x.stroke();
  x.save();x.translate(cx,cy);x.scale(.93,.93);x.translate(-cx,-cy);path();x.strokeStyle='rgba(255,255,255,.12)';x.lineWidth=1;x.stroke();x.restore();
  x.lineCap='round';x.beginPath();x.arc(cx,cy,R*.9,3.5,4.45);x.strokeStyle='rgba(255,255,255,.7)';x.lineWidth=R*.035;x.shadowColor='#fff';x.shadowBlur=8;x.stroke();x.shadowBlur=0;
  x.save();x.translate(cx-R*.3,cy-R*.52);x.rotate(-.5);x.scale(1,.5);
  g=x.createRadialGradient(0,0,0,0,0,R*.38);g.addColorStop(0,'rgba(255,255,255,.32)');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.beginPath();x.arc(0,0,R*.38,0,6.2832);x.fill();x.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
