'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('mapCanvas'), staticCanvas=$('staticCanvas'), wrap = $('canvasParent');
  const liveCtx=canvas.getContext('2d',{alpha:true}), staticCtx=staticCanvas.getContext('2d',{alpha:false});
  let ctx=liveCtx, staticKey='', staticGeneration=0, requestScheduled=false;
  let shownPlayer=null, lastFrameAt=0;
  // Public GitHub Pages hosts only the interface. The private source HTTPS
  // is remembered solely in this browser; it is never committed to GitHub.
  const sourceParams = new URLSearchParams(location.search);
  let storedSource = '';
  try { storedSource = localStorage.getItem('aw-live-source') || ''; } catch (_) {}
  const dataBase = storedSource.replace(/\/+$/, '');
  const demo = sourceParams.has('demo') || (!dataBase && (location.hostname.endsWith('.github.io') || location.protocol==='file:'));
  let state = null, graph = {markers:[],manual:[],learned:[],stairs:[],drops:[]};
  let routeTab = 'manual', chosenRoute = null, floorFilter = 'auto', ready = false;
  let center = {x:1280,y:-16}, zoom = 18, scaleFit = false, following = true;
  let w=1,h=1,dpr=1, dragging=false, dragged=false, startPoint=null;
  let trail=[], lastSession=null, lastTick=null, ignoredLogs=false, lastLogKey='';
  const layers = {manual:'manualLayer', learned:'learnedLayer', stairs:'stairsLayer',active:'activeLayer',trail:'trailLayer'};
  const color = {manual:'#fff1bf',learned:'#668e75',stairs:'#eea93f',active:'#f8ee95',target:'#d94735',trail:'#685944'};
  const num = (n,d=1) => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—';
  const txt = (id,s) => { const node=$(id); if(node) node.textContent=String(s); };
  const dist = (a,b) => Math.hypot((a?.x||0)-(b?.x||0),(a?.y||0)-(b?.y||0));
  const px = x => w/2 + (x-center.x)*zoom;
  const py = y => h/2 - (y-center.y)*zoom;
  const unproject = (x,y) => ({x:(x-w/2)/zoom+center.x, y:(h/2-y)/zoom+center.y});
  const layer = name => $(layers[name]).checked;
  const FLOOR_SPLIT=1001.58;
  const floorName = z => z==null?'—':z<FLOOR_SPLIT?'DOLNY':'GÓRNY';
  const activeFloor = () => floorFilter==='auto' ? (state?.player?.z < FLOOR_SPLIT?'lower':'upper') : floorFilter;
  const floorAlpha = z => {
    if (floorFilter==='all') return 1;
    const shown=activeFloor();
    if (z===undefined) return 1;
    return shown==='lower' ? (z < FLOOR_SPLIT ? 1 : .13) : (z>=FLOOR_SPLIT ? 1 : .13);
  };
  const pointInside = p => p && Number.isFinite(p.x)&&Number.isFinite(p.y);
  const lineColor = (base,a=1) => {
    ctx.globalAlpha=a;
    ctx.strokeStyle=base;
  };
  function resize(){
    const rect=wrap.getBoundingClientRect(); const realW=rect.width, realH=rect.height;
    dpr=Math.min(window.devicePixelRatio||1,2); w=realW; h=realH;
    for(const cvs of [canvas,staticCanvas]){cvs.width=Math.round(realW*dpr);cvs.height=Math.round(realH*dpr);}
    for(const c of [liveCtx,staticCtx])c.setTransform(dpr,0,0,dpr,0,0);
    staticKey='';render();
  }
  function seeded(i,j){let v=Math.sin(i*12.9898+j*78.233)*43758.5453123;return v-Math.floor(v);}
  function drawBackground(){
    // Stylizowana papierowa mapa. W trybie LIVE NIE udajemy, ze znamy kolizje regałów.
    ctx.fillStyle='#c6b896';ctx.fillRect(0,0,w,h);
    let grad=ctx.createLinearGradient(0,0,w,h);
    grad.addColorStop(0,'#ded0aa');grad.addColorStop(.58,'#cbbd99');grad.addColorStop(1,'#b7a987');
    ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
    const step=5;
    const left=center.x-w/(2*zoom),right=center.x+w/(2*zoom),bottom=center.y-h/(2*zoom),top=center.y+h/(2*zoom);
    // Druk mapy — delikatna siatka wspolrzednych i postarzone plamy tuszu.
    ctx.save();
    for(let i=0;i<110;i++){
      const seed=seeded(i,26), seed2=seeded(83,i);
      const x=seed*w,y=seed2*h,rad=3+seeded(i,11)*38;
      ctx.fillStyle=i%3===0?'#5b482609':'#f7e6c50c';
      ctx.beginPath();ctx.ellipse(x,y,rad,rad*.5,seed*6,0,Math.PI*2);ctx.fill();
    }
    ctx.strokeStyle='#675c4930';ctx.lineWidth=1;ctx.beginPath();
    for(let x=Math.floor(left/step)*step;x<=right;x+=step){const screen=px(x);ctx.moveTo(screen,0);ctx.lineTo(screen,h);}
    for(let y=Math.floor(bottom/step)*step;y<=top;y+=step){const screen=py(y);ctx.moveTo(0,screen);ctx.lineTo(w,screen);}
    ctx.stroke();
    // Niejednorodne kreski kartografii (dekoracyjne).
    for(let i=0;i<26;i++){
      const xx=(seeded(i,7)*w)|0,yy=(seeded(2,i)*h)|0;
      ctx.strokeStyle='#473b2920';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx+8,yy-2);ctx.stroke();
    }
    // Wylacznie demonstracja zawiera umowne regaly, aby nie wprowadzac w blad na live.
    if(demo){
      ctx.save();
      const blocks=[{x:1286.2,y:-17.6,w:1.8,h:8.2},{x:1282.2,y:-17.6,w:1.8,h:8.2},
      {x:1278.2,y:-17.6,w:1.8,h:8.2},{x:1287.1,y:-28.5,w:1.2,h:4.4},
      {x:1283.1,y:-28.5,w:1.2,h:4.4},{x:1270.8,y:-22.3,w:1.9,h:9.1}];
      for(const b of blocks){
        const x=px(b.x),y=py(b.y+b.h),ww=b.w*zoom,hh=b.h*zoom;
        if(x+ww<0||x>w||y+hh<0||y>h)continue;
        ctx.fillStyle='#776d52a3';ctx.strokeStyle='#4a4538';ctx.lineWidth=1.2;
        ctx.fillRect(x,y,ww,hh);ctx.strokeRect(x,y,ww,hh);
        ctx.beginPath();for(let t=0;t<4;t++){ctx.moveTo(x,y+hh*t/4);ctx.lineTo(x+ww,y+hh*t/4);}ctx.stroke();
      }
      ctx.globalAlpha=.55;
      ctx.fillStyle='#4f553d';ctx.font='bold 11px Georgia,serif';ctx.fillText('STORAGE AISLES',px(1289),py(-17));
      ctx.fillText('STAIRS',px(1277.9),py(-10.2));
      ctx.restore();
    }
    ctx.globalAlpha=1;
    const gap=zoom>=20?5:zoom>=6?10:25;
    ctx.font='bold 10px Courier New,monospace';ctx.fillStyle='#544735aa';ctx.textAlign='left';
    for(let x=Math.floor(left/gap)*gap;x<=right;x+=gap)ctx.fillText(String(x),px(x)+4,18);
    for(let y=Math.floor(bottom/gap)*gap;y<=top;y+=gap)ctx.fillText(String(y),6,py(y)-4);
    ctx.restore();
    // Narożny ozdobnik papierowej mapy
    ctx.save();ctx.strokeStyle='#6c553caa';ctx.lineWidth=1.5;
    for(let k=0;k<4;k++){const pad=12+k*3;ctx.strokeRect(pad,pad,w-pad*2,h-pad*2);}
    ctx.restore();
  }
  function paintPath(points,stroke,width=2,dash=[],opacity=1){
    if(!Array.isArray(points)||points.length<2)return;
    ctx.beginPath();let moved=false;
    for(const p of points){if(!pointInside(p))continue;
      if(!moved){ctx.moveTo(px(p.x),py(p.y));moved=true;}else{ctx.lineTo(px(p.x),py(p.y));}}
    ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash(dash);
    if(width>=2.2){ctx.strokeStyle='#181c1599';ctx.globalAlpha=opacity*.77;ctx.lineWidth=width+3;ctx.stroke();}
    ctx.strokeStyle=stroke;ctx.globalAlpha=opacity;ctx.lineWidth=width;ctx.stroke();
    ctx.setLineDash([]);ctx.globalAlpha=1;
  }
  function paintDot(p,r,fill,ring=null){
    if(!pointInside(p))return;
    ctx.beginPath();ctx.arc(px(p.x),py(p.y),r,0,Math.PI*2);
    ctx.fillStyle=fill;ctx.fill();
    if(ring){ctx.strokeStyle=ring;ctx.lineWidth=2;ctx.stroke();}
  }
  function textAt(p,content,fill='#cbdbe9',offsetY=-12){
    if(!pointInside(p))return;
    ctx.font='bold 11px Tahoma,sans-serif';
    ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#1b1e17';ctx.strokeText(content,px(p.x),py(p.y)+offsetY);
    ctx.fillStyle=fill;ctx.fillText(content,px(p.x),py(p.y)+offsetY);ctx.textAlign='start';
  }
  function drawStaticWorld(){

    drawBackground();
    if(!ready)return;
    if(layer('learned'))for(const edge of graph.learned||[]){const op=floorAlpha(edge.points?.[0]?.z);
      paintPath(edge.points,color.learned,1.5,[3,6],op*.5);}
    if(layer('manual'))for(const edge of graph.manual||[]){const op=floorAlpha(edge.points?.[0]?.z);
      paintPath(edge.points,color.manual,2.2,[],op*.65);}
    if(layer('stairs'))for(const stair of graph.stairs||[]){
      paintPath(stair.points,color.stairs,2.7,[6,4],.85);}
    for(const drop of graph.drops||[]){
      if(drop.entry&&drop.exit){paintPath([drop.entry,drop.exit],'#e49780',2,[3,3],.75);paintDot(drop.entry,3,'#f9bd94');}}
    if(chosenRoute){const found=(graph[routeTab]||[]).find(r=>r.id===chosenRoute.id);
      if(found){paintPath(found.points,'#f8ecac',6,[],.18);paintPath(found.points,'#fff3d0',3.5,[],1);
        if(found.points?.length){paintDot(found.points[0],5,'#b7dc7d');paintDot(found.points.at(-1),5,'#ec634b');}}}
    const zoomShow=zoom>4;
    for(const marker of graph.markers||[]){
      const opacity=floorAlpha(marker.z);
      ctx.globalAlpha=opacity;
      paintDot(marker,4.2,'#e9e8c9','#25281e');
      if(zoomShow && opacity>.4)textAt(marker,marker.name||'#'+marker.id,'#f6f1d6',-11);
      ctx.globalAlpha=1;
    }
    ctx.globalAlpha=1;
  }
  function drawDynamicWorld(){
    if(layer('trail'))paintPath(trail,color.trail,1.7,[],.73);
    if(layer('active')){
      paintPath(state?.activeRoute,'#f2e6a4',4.2,[],1);
      paintPath(state?.recordingPath,'#df853e',2.8,[4,4],.95);
      if(state?.nextWaypoint)paintDot(state.nextWaypoint,5,'#f9cc68','#161914');
    }
    for(const b of state?.blockedPoints||[]){if(floorAlpha(b.z)<.4)continue;paintDot(b,Math.max(5,(b.hits||1)*2+4),'#ab3b2d','#fff1b4');}
    if(state?.target){const t=state.target;
      const halo=8+Math.sin(Date.now()/380)*2;
      paintDot(t,halo,'#d5423345');paintDot(t,7,color.target,'#fff1b4');
      textAt(t,'CHECKPOINT / '+(num(state.distanceXY)+' m'),'#ffecd1',-20);
    }
    if(state?.player){const p=shownPlayer||state.player;
      paintDot(p,12,'#171b1a40');paintDot(p,7,'#eeeccf','#1a1d1a');
      const angle=-(Number(p.heading)||0)*Math.PI/180-Math.PI/2;
      const dx=Math.cos(angle)*15,dy=Math.sin(angle)*15;
      ctx.strokeStyle='#ffffff';ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(px(p.x),py(p.y));ctx.lineTo(px(p.x)+dx,py(p.y)+dy);ctx.stroke();
      textAt(p,'YOU ARE HERE','#fff6de',-19);
    }
    ctx.globalAlpha=1;
    drawRadar();
    txt('mapScale',(50/zoom).toFixed(1)+' m / 50 px');
  }
  function drawRadar(){
    if(!state?.player || w<310 || h<250)return;
    const r = w<560?47:64, x=r+17, y=h-r-31;
    ctx.save();ctx.shadowColor='#0b0d08';ctx.shadowBlur=9;ctx.shadowOffsetY=5;
    ctx.fillStyle='#060806';ctx.beginPath();ctx.arc(x,y,r+7,0,Math.PI*2);ctx.fill();
    ctx.restore();ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
    ctx.fillStyle='#a2a584';ctx.fillRect(x-r,y-r,2*r,2*r);
    ctx.strokeStyle='#64684e';ctx.lineWidth=7;
    const worldscale=8;
    // Uproszczony radar stylizowany na GTA:SA: znane ścieżki, nie mapa kolizji.
    function rpoint(p){const player=shownPlayer||state.player;return{x:x+(p.x-player.x)*worldscale,y:y-(p.y-player.y)*worldscale};}
    for(const route of (graph.manual||[]).slice(0,55)){
      const pts=route.points||[];if(pts.length<2)continue;
      ctx.beginPath();for(let i=0;i<pts.length;i++){const v=rpoint(pts[i]);if(i===0)ctx.moveTo(v.x,v.y);else ctx.lineTo(v.x,v.y);}
      ctx.strokeStyle='#343c31';ctx.lineWidth=7;ctx.stroke();ctx.strokeStyle='#d9d8b6';ctx.lineWidth=3;ctx.stroke();
    }
    for(let offset=-55;offset<=55;offset+=27){ctx.strokeStyle='#4c60444d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-r,y+offset);ctx.lineTo(x+r,y+offset);ctx.stroke();}
    if(state.target){const t=rpoint(state.target);const dx=t.x-x,dy=t.y-y,len=Math.hypot(dx,dy)||1,reach=Math.min(r-9,len);const xx=x+reach*dx/len,yy=y+reach*dy/len;
      ctx.fillStyle='#e04436';ctx.strokeStyle='#100f0d';ctx.lineWidth=2;ctx.beginPath();ctx.arc(xx,yy,6,0,Math.PI*2);ctx.fill();ctx.stroke();}
    ctx.translate(x,y);const a=-(Number((shownPlayer||state.player).heading)||0)*Math.PI/180-Math.PI/2;
    ctx.rotate(a+Math.PI/2);ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(7,8);ctx.lineTo(0,5);ctx.lineTo(-7,8);ctx.closePath();ctx.fillStyle='#f9f5db';ctx.strokeStyle='#111713';ctx.lineWidth=2;ctx.fill();ctx.stroke();ctx.restore();
    ctx.beginPath();ctx.arc(x,y,r+2,0,Math.PI*2);ctx.strokeStyle='#e9e0bd';ctx.lineWidth=2;ctx.stroke();
    ctx.font='900 10px Impact,sans-serif';ctx.fillStyle='#faf4d7';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#111611';ctx.strokeText('RADAR',x,y+r+18);ctx.fillText('RADAR',x,y+r+18);ctx.textAlign='left';
  }
  function drawFrame(){
    if(w<=0||h<=0||document.hidden)return;
    const now=performance.now(),dt=Math.min(.08,Math.max(.005,(now-lastFrameAt)/1000||.033));lastFrameAt=now;
    if(state?.player){
      const p=state.player;
      if(!shownPlayer||dist(shownPlayer,p)>8||Math.abs(shownPlayer.z-p.z)>3)shownPlayer={...p};
      else {const k=1-Math.exp(-dt*9);shownPlayer.x+=(p.x-shownPlayer.x)*k;shownPlayer.y+=(p.y-shownPlayer.y)*k;shownPlayer.z+=(p.z-shownPlayer.z)*k;shownPlayer.heading=p.heading;}
      if(following&&dist(center,shownPlayer)>2.4){center={x:shownPlayer.x,y:shownPlayer.y};}
    }
    const keys=[center.x.toFixed(2),center.y.toFixed(2),zoom.toFixed(3),floorFilter,activeFloor(),routeTab,
       chosenRoute?.id,staticGeneration,...Object.values(layers).slice(0,3).map(id=>$(id).checked)].join('|');
    if(keys!==staticKey){staticKey=keys;ctx=staticCtx;ctx.clearRect(0,0,w,h);drawStaticWorld();}
    ctx=liveCtx;ctx.clearRect(0,0,w,h);drawDynamicWorld();
  }
  function render(){if(!requestScheduled){requestScheduled=true;requestAnimationFrame(()=>{requestScheduled=false;drawFrame();});}}

  function allPoints(){
    const pts=[];
    for(const m of graph.markers||[])pts.push(m);
    for(const kind of ['manual','learned','stairs'])for(const e of graph[kind]||[])for(const p of e.points||[])pts.push(p);
    if(state?.player)pts.push(state.player);
    if(state?.target)pts.push(state.target);
    return pts.filter(pointInside);
  }
  function fitMap(points=null){
    const pts=points||allPoints();if(!pts.length)return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of pts){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    center={x:(minX+maxX)/2,y:(minY+maxY)/2};
    const width=Math.max(10,maxX-minX+7),height=Math.max(10,maxY-minY+7);
    zoom=Math.max(1.2,Math.min(55,Math.min(w/width,h/height)));
    following=false;scaleFit=true;render();
  }
  function focusPlayer(){if(!state?.player)return;center={x:state.player.x,y:state.player.y};following=true;scaleFit=false;zoom=Math.max(zoom,8);render();}
  function parseSelected(kind,item){routeTab=kind;chosenRoute={id:item.id};for(const b of ['Manual','Learned','Stairs'])$('tab'+b).classList.toggle('active',b.toLowerCase()===kind);renderRouteList();fitMap(item.points);}
  function renderRouteList(){
    const list=$('routeList');list.replaceChildren();const routes=graph[routeTab]||[];
    txt('routeTotalLabel',routes.length+' tras');
    if(!routes.length){const d=document.createElement('div');d.className='list-empty';d.textContent='Brak zapisanych tras.';list.append(d);return;}
    for(const r of routes.slice(0,100)){
      const b=document.createElement('button');b.type='button';b.className='route-item'+(chosenRoute?.id===r.id?' selected':'');
      const first=document.createElement('div');first.className='line-one';
      const name=document.createElement('b');
      name.textContent=routeTab==='manual' ?
        `T${r.id}  ${graph.markers?.[r.from-1]?.name||'#'+r.from} → ${graph.markers?.[r.to-1]?.name||'#'+r.to}` :
        routeTab==='stairs' ? `P${r.id}  ${r.name||'Schody'}` : `N${r.id}  Trasa nauczona`;
      const tag=document.createElement('span');tag.className='route-tag';tag.textContent=(r.seconds?num(r.seconds)+' s':'—');
      first.append(name,tag);
      const small=document.createElement('small');small.textContent=`${r.points?.length||0} punktów  •  ${r.success||0} udanych  •  ${r.fails||0} błędów`;
      b.append(first,small);b.addEventListener('click',()=>parseSelected(routeTab,r));list.append(b);
    }
  }
  function updateState(s){
    const session=s.session;
    if(session&&lastSession&&lastSession!==session){trail=[];lastTick=null;}
    lastSession=session||lastSession;
    state=s;
    const online=demo||Boolean(s._transport?.online);
    $('connection').className='connection'+(demo?' demo':online?'':' offline');
    txt('connectionText',demo?'TRYB DEMO':online?'LIVE / POŁĄCZONO':'OFFLINE');
    txt('mapBadge',demo?'DANE DEMONSTRACYJNE':online?'ODŚWIEŻANIE NA ŻYWO':'OCZEKIWANIE NA GRĘ');
    txt('modeValue',s.mode||'BRAK DANYCH');
    txt('mobileMode',s.mode||'BRAK DANYCH');
    txt('mobileDistance',s.distanceXY==null?'—':num(s.distanceXY)+' m');
    txt('mobileAttempts',`${s.attempts??0}/${s.maxAttempts??4}`);
    txt('mobileRetry',`${s.retryCycles??0}/${s.maxRetryCycles??3}`);
    txt('modeDesc',s.pauseReason||(!online?'Nie otrzymuję nowych danych z MoonLoadera.':s.enabled?'Automat jest aktywny. Trasa aktualizuje się na żywo.':'AutoWork nie steruje aktualnie postacią.'));
    txt('enabledValue',!online?'OFFLINE':s.enabled?'AKTYWNY':'WYŁĄCZONY');
    txt('automationLabel',s.learning?'UCZENIE ON':'UCZENIE OFF');
    txt('distanceValue',s.distanceXY==null?'—':num(s.distanceXY)+' m');
    txt('heightValue',s.dz==null?'—':(s.dz>0?'+':'')+num(s.dz,2)+' m');
    txt('attemptValue',`${s.attempts??0}/${s.maxAttempts??4}`);
    txt('retryValue',`${s.retryCycles??0}/${s.maxRetryCycles??3}`);
    txt('xValue',num(s.player?.x,3));txt('yValue',num(s.player?.y,3));txt('zValue',num(s.player?.z,3));
    txt('floorValue',floorName(s.player?.z));
    txt('missionZone',s.player?.interior!=null?'INTERIOR '+s.player.interior:'WAREHOUSE INTERIOR');
    txt('waypointValue',s.routeTotal?`${s.routeIndex} / ${s.routeTotal}`:'—');
    txt('routeTypeValue',s.routeType||'—');
    txt('resumeValue',s.resume?`${s.resume.count??0}/${s.resume.max??3} • ${s.resume.status||'—'}`:'—');
    txt('planValue',s.planExpanded?`${s.planExpanded} pól`:'—');
    const statsRows=s.jobText||[];const jobNode=$('jobStats');
    const statsKey=JSON.stringify(statsRows);
    if(jobNode && jobNode.dataset.key!==statsKey){jobNode.dataset.key=statsKey;jobNode.replaceChildren();
      if(!statsRows.length){const el=document.createElement('div');el.className='job-empty';el.textContent='Brak pasujących TextDraw. Licznik może być rysowany grafiką.';jobNode.append(el);}
      else for(const r of statsRows){const el=document.createElement('div');el.className='job-line';
        const id=document.createElement('small');id.textContent='#'+r.id;const value=document.createElement('b');value.textContent=r.text;el.append(id,value);jobNode.append(el);}
    }
    txt('jobStatsLabel',statsRows.length+' ODNOTOWANYCH');
    txt('blockedStatus',(s.blockedPoints?.length||0)+' punktów • '+(s.blockedRepeats||0)+' powt.');
    txt('shortcutStatus',s.checkpointShortcut||'—');
    txt('recordValue',s.recording?`${s.recording.points} punktów`:'—');
    txt('timeLabel',s.serverTime?new Date(s.serverTime*1000).toLocaleTimeString('pl-PL'):'—');
    txt('lastValue',demo?'DEMO':s._transport?.ageSeconds==null?'brak':num(s._transport.ageSeconds)+' s temu');
    txt('markerCount',s.markerCount??graph.markers?.length??0);txt('manualCount',s.manualCount??graph.manual?.length??0);
    txt('learnedCount',s.learnedCount??graph.learned?.length??0);txt('stairCount',s.stairCount??graph.stairs?.length??0);
    if(s.target){
      const match=(graph.markers||[]).find(m=>dist(m,s.target)<1.95&&Math.abs(m.z-s.target.z)<.78);
      txt('targetId',match?`#${match.id}`:'#?');
      txt('targetCoords',`${num(s.target.x,2)}, ${num(s.target.y,2)}, ${num(s.target.z,2)}`);
      txt('targetExtra',`Promień ${num(s.target.radius,1)} m • odległość ${num(s.distanceXY)} m`);
    }else{txt('targetId','—');txt('targetCoords','Brak aktywnego markera');txt('targetExtra','Oczekiwanie na nowy checkpoint');}
    if(s.player&&online && s.tick!==lastTick){
      if(trail.length===0||dist(trail[trail.length-1],s.player)>.14||Math.abs(trail[trail.length-1].z-s.player.z)>.1){
        trail.push({x:s.player.x,y:s.player.y,z:s.player.z});
        if(trail.length>450)trail.shift();
      }
      lastTick=s.tick;
      // Centrum podaza za wygładzoną pozycją tylko przy rzeczywistym przesunięciu (drawFrame).
    }
    if(!ignoredLogs){
      const logs=(s.logs||[]).slice(-26);const key=JSON.stringify(logs);
      if(key!==lastLogKey){lastLogKey=key;const area=$('eventLogs');area.replaceChildren();
        for(const event of logs.slice().reverse()){
          const el=document.createElement('div');el.className='log-line';
          const t=document.createElement('time');t.textContent=event.time||'—';
          const message=document.createElement('span');message.textContent=event.message||'';
          message.className=/brak|blad|nie znalaz|pawza|4\/4|pause|utkn/i.test(event.message||'')?'warn':'normal';
          el.append(t,message);area.append(el);
        }
        if(!logs.length){const p=document.createElement('div');p.className='log-placeholder';p.textContent='Brak nowych komunikatów.';area.append(p);}
      }
    }
    ready=Boolean(s.player)||ready;
    $('emptyOverlay').hidden=ready;
    render();
  }
  function updateMap(m){
    graph={markers:m.markers||[],manual:m.manual||[],learned:m.learned||[],stairs:m.stairs||[],drops:m.drops||[]};
    staticGeneration++;renderRouteList();
    ready=Boolean(state?.player)||allPoints().length>0;
    $('emptyOverlay').hidden=ready;
    if(!scaleFit && !following && allPoints().length)fitMap();
    render();
  }
  function setup(){
    const sourceOverlay=$('sourceOverlay'), sourceInput=$('sourceInput');
    const hideSource=()=>{sourceOverlay.hidden=true;};
    $('sourceOpen').addEventListener('click',()=>{
      sourceInput.value=dataBase;
      txt('sourceError','');
      sourceOverlay.hidden=false;
      sourceInput.focus();
    });
    $('sourceClose').addEventListener('click',hideSource);
    sourceOverlay.addEventListener('click',e=>{if(e.target===sourceOverlay)hideSource();});
    window.addEventListener('keydown',e=>{if(e.key==='Escape')hideSource();});
    $('sourceConnect').addEventListener('click',()=>{
      try {
        const url=new URL(sourceInput.value.trim());
        if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) {
          throw new Error('Podaj prywatny adres HTTPS bez hasła ani dodatkowych parametrów.');
        }
        localStorage.setItem('aw-live-source',url.origin);
        location.assign(location.pathname);
      } catch (e) {
        txt('sourceError',e.message||'Niepoprawny adres.');
      }
    });
    $('sourceDemo').addEventListener('click',()=>{
      try { localStorage.removeItem('aw-live-source'); } catch (_) {}
      location.assign(location.pathname+'?demo=1');
    });
    const host=document.querySelector('.server-address');
    if(host)host.textContent=dataBase?'ZDALNY LIVE':location.protocol==='file:'?'Podgląd HTML':location.host;
    $('floorControls').addEventListener('click',ev=>{const btn=ev.target.closest('button[data-floor]');if(!btn)return;
      floorFilter=btn.dataset.floor;
      for(const b of $('floorControls').querySelectorAll('button'))b.classList.toggle('active',b===btn);render();});
    $('fitButton').addEventListener('click',()=>fitMap());
    $('focusButton').addEventListener('click',focusPlayer);
    $('zoomIn').addEventListener('click',()=>{zoom=Math.min(85,zoom*1.4);render();});
    $('zoomOut').addEventListener('click',()=>{zoom=Math.max(.7,zoom/1.4);render();});
    for(const name of Object.values(layers))$(name).addEventListener('change',render);
    for(const type of ['Manual','Learned','Stairs'])$('tab'+type).addEventListener('click',()=>{
      routeTab=type.toLowerCase();chosenRoute=null;
      for(const c of ['Manual','Learned','Stairs'])$('tab'+c).classList.toggle('active',c===type);
      renderRouteList();render();});
    $('clearLogs').addEventListener('click',()=>{$('eventLogs').replaceChildren();ignoredLogs=true;lastLogKey='';
      const b=document.createElement('button');b.textContent='Przywróć logi';b.className='route-item';b.addEventListener('click',()=>{ignoredLogs=false;lastLogKey='';updateState(state||{});});$('eventLogs').append(b);});
    canvas.addEventListener('wheel',e=>{e.preventDefault();const rect=canvas.getBoundingClientRect();const sx=e.clientX-rect.left,sy=e.clientY-rect.top;
      const world=unproject(sx,sy);zoom=Math.max(.6,Math.min(90,zoom*(e.deltaY<0?1.17:1/1.17)));
      center.x=world.x-(sx-w/2)/zoom;center.y=world.y+(sy-h/2)/zoom;following=false;scaleFit=false;render();},{passive:false});
    // Jeden palec przesuwa mapę, dwa palce płynnie zmieniają zoom wokół środka gestu.
    const pointers=new Map();let pinch=null;
    const resetStart=(e)=>{dragging=true;startPoint={x:e.clientX,y:e.clientY,cx:center.x,cy:center.y};};
    canvas.addEventListener('pointerdown',e=>{
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      canvas.classList.add('dragging');
      if(pointers.size===1){pinch=null;resetStart(e);}
      else if(pointers.size===2){
        const [a,b]=[...pointers.values()];const rect=canvas.getBoundingClientRect();
        const mx=(a.x+b.x)/2-rect.left,my=(a.y+b.y)/2-rect.top;
        pinch={distance:Math.max(10,Math.hypot(a.x-b.x,a.y-b.y)),baseZoom:zoom,world:unproject(mx,my)};
        dragging=false;startPoint=null;
      }
    });
    canvas.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId))return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      const rect=canvas.getBoundingClientRect();
      if(pointers.size>=2&&pinch){
        const [a,b]=[...pointers.values()];const mx=(a.x+b.x)/2-rect.left,my=(a.y+b.y)/2-rect.top;
        zoom=Math.max(.6,Math.min(90,pinch.baseZoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance));
        center.x=pinch.world.x-(mx-w/2)/zoom;
        center.y=pinch.world.y+(my-h/2)/zoom;
      } else if(startPoint){
        center.x=startPoint.cx-(e.clientX-startPoint.x)/zoom;
        center.y=startPoint.cy+(e.clientY-startPoint.y)/zoom;
      }
      following=false;scaleFit=false;
      const p=unproject(e.clientX-rect.left,e.clientY-rect.top);
      txt('pointerCoords',`X ${num(p.x,2)} / Y ${num(p.y,2)}`);
      render();
    });
    const up=e=>{
      pointers.delete(e.pointerId);pinch=null;
      if(pointers.size===1){const p=[...pointers.values()][0];resetStart({clientX:p.x,clientY:p.y});}
      else {dragging=false;startPoint=null;canvas.classList.remove('dragging');}
    };
    canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
    // Mobilna dolna nawigacja: osobne wysuwane panele bez zasłaniania mapy.
    const backdrop=$('mobileBackdrop'),left=document.querySelector('.left-pane'),right=document.querySelector('.right-pane');
    function openMobile(view){
      const isSmall=window.matchMedia('(max-width:800px)').matches;
      const mode=isSmall?view:'map';
      left.classList.toggle('mobile-open',mode==='status');
      right.classList.toggle('mobile-open',mode==='routes'||mode==='logs');
      right.dataset.mobileView=mode;
      backdrop.hidden=mode==='map';
      document.querySelectorAll('[data-mobile]').forEach(b=>{
        b.classList.toggle('active',b.dataset.mobile===mode);
        b.setAttribute('aria-pressed',String(b.dataset.mobile===mode));
      });
    }
    document.querySelector('.mobile-dock').addEventListener('click',e=>{
      const btn=e.target.closest('button[data-mobile]');if(btn)openMobile(btn.dataset.mobile);
    });
    backdrop.addEventListener('click',()=>openMobile('map'));
    window.addEventListener('keydown',e=>{if(e.key==='Escape')openMobile('map');});
    $('layersButton').addEventListener('click',()=>{
      const filter=document.querySelector('.route-filter');const opened=filter.classList.toggle('expanded');
      $('layersButton').setAttribute('aria-expanded',String(opened));
    });
    window.addEventListener('resize',()=>{if(window.innerWidth>800)openMobile('map');resize();});
    resize();
  }
  async function pollState(){try{const response=await fetch((dataBase||'')+'/api/state',{cache:'no-store',mode:'cors',credentials:'omit'});if(!response.ok)throw Error(response.status);updateState(await response.json());}
    catch(e){$('connection').className='connection offline';txt('connectionText','BRAK SERWERA');txt('mapBadge','BŁĄD POŁĄCZENIA');}}
  let lastMapBody='';
  async function pollMap(){try{const response=await fetch((dataBase||'')+'/api/map',{cache:'no-store',mode:'cors',credentials:'omit'});if(response.status===304)return;if(response.ok){const body=await response.text();if(body!==lastMapBody){lastMapBody=body;updateMap(JSON.parse(body));}}}catch(e){/* keep last known map */}}
  function demoData(){
    const stairs=[
      [1290.34,-10.51,1000.85],[1287,-10.65,1000.85],[1283,-10.8,1000.85],
      [1279,-11.42,1000.85],[1278,-11.52,1001.26],[1277,-11.56,1002.06],
      [1276.7,-11.59,1002.46],[1274.5,-12.3,1002.44],[1274.4,-15.27,1002.44],
      [1274.0,-15.68,1002.43]].map(a=>({x:a[0],y:a[1],z:a[2]}));
    graph={markers:[{id:1,x:1290.34,y:-10.51,z:1000.85,name:'M1',interior:18},
      {id:2,x:1281,y:-20,z:1000.85,name:'M2',interior:18},{id:3,x:1274,y:-16,z:1002.43,name:'M3',interior:18},
      {id:4,x:1264,y:-24,z:1002.43,name:'M4',interior:18},{id:5,x:1287,y:-29,z:1000.85,name:'M5',interior:18}],
      manual:[{id:1,from:1,to:2,seconds:6.9,success:4,fails:0,points:[{x:1290.34,y:-10.51,z:1000.85},{x:1290,y:-20,z:1000.85},{x:1281,y:-20,z:1000.85}]},
      {id:2,from:3,to:4,seconds:5.8,success:7,fails:1,points:[{x:1274,y:-16,z:1002.43},{x:1274,y:-24,z:1002.43},{x:1264,y:-24,z:1002.43}]},
      {id:3,from:2,to:5,seconds:4.8,success:4,fails:0,points:[{x:1281,y:-20,z:1000.85},{x:1281,y:-29,z:1000.85},{x:1287,y:-29,z:1000.85}]}],
      learned:[{id:1,seconds:3.9,success:3,fails:0,points:[{x:1287,y:-29,z:1000.85},{x:1282,y:-27,z:1000.85},{x:1281,y:-20,z:1000.85}]}],
      stairs:[{id:1,name:'oryginalna-40',points:stairs}],drops:[]};
    updateMap(graph);
    let frame=0;
    const steps=[{x:1274.1,y:-15.9,z:1002.43},{x:1274,y:-18,z:1002.43},
      {x:1274,y:-20,z:1002.43},{x:1272,y:-24,z:1002.43},{x:1268,y:-24,z:1002.43}];
    const tick=()=>{
      frame++;const p=steps[Math.floor(frame/8)%steps.length],t=graph.markers[3];
      updateState({schema:1,session:'DEMO-1',serverTime:Date.now()/1000,tick:frame*400,_transport:{online:true,ageSeconds:.1},
        enabled:true,mode:'SPRINT / TRASA',player:{...p,heading:270,interior:18},target:{...t,radius:1},
        distanceXY:dist(p,t),dz:t.z-p.z,routeIndex:Math.floor(frame/8)%5+1,routeTotal:5,routeType:'manual',
        activeRoute:steps.slice(Math.floor(frame/8)%5),attempts:0,maxAttempts:4,retryCycles:0,maxRetryCycles:3,
        resume:{count:1,max:3,status:'T2 od punktu 4'},
        checkpointShortcut:'checkpoint ma pierwszeństwo przed M/S',
        jobText:[{id:'41',text:'Magazynier: 4 / 8 paczek'},{id:'44',text:'Zarobek: $1200'}],
        blockedPoints:[{x:1277,y:-18,z:1002.43,hits:2}],blockedRepeats:1,
        markerCount:graph.markers.length,manualCount:graph.manual.length,learnedCount:graph.learned.length,stairCount:1,
        learning:true,logs:[{time:'23:18:41',message:'Przeładowano AutoWork LIVE.'},
          {time:'23:18:43',message:'Nowy checkpoint. Szukam optymalnej trasy.'},
          {time:'23:18:44',message:'Trasa z mapy markerow: M3 -> M4, ETA 5.8s'}]});
    };
    tick();setInterval(tick,500);
  }
  setup();
  const setClock=()=>txt('saClock',new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'}));
  setClock();setInterval(setClock,15000);
  if(demo)demoData();else{pollState();pollMap();setInterval(pollState,500);setInterval(pollMap,4500);}
  let animLast=0;function animate(t){if(!document.hidden&&ready&&t-animLast>(window.innerWidth<=800?48:32)){animLast=t;render();}requestAnimationFrame(animate);}requestAnimationFrame(animate);
})();
