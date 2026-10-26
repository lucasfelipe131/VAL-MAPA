// VAL Mapa — interface. Sem build: ES module servido diretamente.
const $=(selector,root=document)=>root.querySelector(selector)
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)]
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))
const fmt=(value,digits=0)=>value===null||value===undefined||value===''?'—':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:digits})
const fmtDate=value=>value?new Date(value).toLocaleDateString('pt-BR'):'—'
const fmtMoney=(value,unit)=>value===null||value===undefined?'—':`R$ ${Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}/${unit==='BRL/t'?'t':'sc'}`
const priorityColor={high:'#009f78',medium:'#2d8cff',watch:'#e5a528',incomplete:'#9aa8a3'}
const palette=['#009f78','#2d8cff','#c8f25e','#e5a528','#14ada7','#8e7cc3','#f07c5c','#6c7f78','#00c896','#1b6fd6','#9aa8a3','#b85c9e']
const SC_TONNES=0.06
const fmtSc=tonnes=>tonnes===null||tonnes===undefined?'—':`${fmt(Math.round(tonnes/SC_TONNES))} sc`
const relationshipColor={prospect:'#9aa8a3',contact:'#e5a528',active:'#2d8cff',partner:'#009f78',inactive:'#c0392b'}

const state={data:null,view:'map',map:null,layer:null,planLayer:null,plan:{active:false,center:null,radiusKm:50},charts:{},sort:{key:'score',dir:-1},selected:null}
const labels={}

// --- API ---------------------------------------------------------------------
async function api(path,options={}){
 const response=await fetch(path,{headers:{'Content-Type':'application/json'},credentials:'same-origin',...options,body:options.body?JSON.stringify(options.body):undefined})
 const body=response.headers.get('content-type')?.includes('json')?await response.json():null
 if(response.status===401&&!path.includes('/session')){showLogin();throw new Error(body?.error||'Sessão expirada.')}
 if(!response.ok)throw new Error(body?.error||`Erro ${response.status}`)
 return body
}
async function reload(){
 state.data=await api('/api/bootstrap')
 const {catalog}=state.data
 for(const group of ['commodities','relationships','intentStatuses','interactionKinds','priceUnits'])labels[group]=Object.fromEntries(catalog[group].map(item=>[item.value,item.label]))
 $('#storage-badge').textContent=state.data.storage==='postgresql'?'PostgreSQL':'Arquivo local'
 fillFilters()
 render()
}
function toast(message,isError=false){const el=$('#toast');el.textContent=message;el.className=`toast${isError?' error':''}`;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,isError?5000:2800)}
const run=async(work,success)=>{try{await work();if(success)toast(success);await reload()}catch(error){toast(error.message,true)}}

// --- sessão ------------------------------------------------------------------
function showLogin(){$('#app').hidden=true;$('#login').hidden=false;$('#login-password').focus()}
async function init(){
 const session=await api('/api/session')
 $('#logout').hidden=!session.protected
 if(!session.authenticated)return showLogin()
 $('#login').hidden=true;$('#app').hidden=false
 await reload()
 setTimeout(()=>state.map?.invalidateSize(),50)
}
$('#login-form').addEventListener('submit',async event=>{
 event.preventDefault();$('#login-error').hidden=true
 try{await api('/api/session',{method:'POST',body:{password:$('#login-password').value}});$('#login-password').value='';await init()}
 catch(error){$('#login-error').textContent=error.message;$('#login-error').hidden=false}
})
$('#logout').addEventListener('click',async()=>{await api('/api/session',{method:'DELETE'});showLogin()})

// --- navegação ----------------------------------------------------------------
$$('.tabs button').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)))
function setView(view){
 state.view=view
 $$('.tabs button').forEach(button=>button.classList.toggle('active',button.dataset.view===view))
 $$('.view').forEach(section=>section.classList.toggle('active',section.id===`view-${view}`))
 location.hash=view
 render()
 if(view==='map')setTimeout(()=>state.map?.invalidateSize(),30)
}
if(['map','producers','decision','tracking','presentation'].includes(location.hash.slice(1)))state.view=location.hash.slice(1)

// --- filtros -----------------------------------------------------------------
const filters=()=>({search:$('#f-search').value.trim().toLowerCase(),culture:$('#f-culture').value,uf:$('#f-uf').value,region:$('#f-region').value,relationship:$('#f-relationship').value,priority:$('#f-priority').value})
function fillFilters(){
 const {catalog,producers}=state.data
 const fill=(select,items,keepFirst=true)=>{const current=select.value;const first=keepFirst?select.options[0].outerHTML:'';select.innerHTML=first+items.map(item=>`<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('');select.value=current}
 fill($('#f-culture'),catalog.commodities.filter(item=>producers.some(p=>p.cultures.includes(item.value))))
 fill($('#f-uf'),[...new Set(producers.map(p=>p.uf).filter(Boolean))].sort().map(uf=>({value:uf,label:uf})))
 fill($('#f-region'),[...new Set(producers.map(p=>p.region).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(r=>({value:r,label:r})))
 fill($('#f-relationship'),catalog.relationships)
 fill($('#d-consultant'),[...new Set(producers.map(p=>p.consultant).filter(Boolean))].sort().map(c=>({value:c,label:c})))
}
function filteredScored(){
 const f=filters();const byId=new Map(state.data.producers.map(p=>[p.id,p]))
 return state.data.scored.filter(item=>{
  const producer=byId.get(item.producerId)||{}
  if(f.culture&&!item.cultures.includes(f.culture))return false
  if(f.uf&&item.uf!==f.uf)return false
  if(f.region&&(producer.region||'')!==f.region)return false
  if(f.relationship&&item.relationship!==f.relationship)return false
  if(f.priority&&item.priority.level!==f.priority)return false
  if(f.search&&!`${item.name} ${item.municipality} ${producer.consultant||''}`.toLowerCase().includes(f.search))return false
  return true
 })
}
;['#f-search','#f-culture','#f-uf','#f-region','#f-relationship','#f-priority','#f-by-municipality'].forEach(id=>$(id).addEventListener('input',renderMap))
$('#f-clear').addEventListener('click',()=>{['#f-search','#f-culture','#f-uf','#f-region','#f-relationship','#f-priority'].forEach(id=>$(id).value='');$('#f-by-municipality').checked=false;renderMap()})

// --- mapa ----------------------------------------------------------------------
function ensureMap(){
 if(state.map)return
 state.map=L.map('map',{zoomControl:true}).setView([-15.8,-52],4)
 const streets=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'})
 const imagery=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imagens &copy; Esri, Maxar, Earthstar Geographics e comunidade GIS'})
 const labels=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,pane:'overlayPane',opacity:.95})
 const hybrid=L.layerGroup([imagery,labels])
 const baseLayers={'Mapa':streets,'Satélite':imagery,'Satélite com nomes':hybrid}
 let saved='Mapa';try{saved=localStorage.getItem('val-mapa-base')||'Mapa'}catch{}
 ;(baseLayers[saved]||streets).addTo(state.map)
 L.control.layers(baseLayers,null,{position:'topright',collapsed:false}).addTo(state.map)
 state.map.on('baselayerchange',event=>{try{localStorage.setItem('val-mapa-base',event.name)}catch{}})
 state.layer=L.layerGroup().addTo(state.map)
 state.planLayer=L.layerGroup().addTo(state.map)
 state.map.on('click',event=>{if(state.plan.active){state.plan.center=event.latlng;renderPlan()}})
}
function renderMap(){
 ensureMap()
 state.layer.clearLayers()
 const items=filteredScored().filter(item=>item.lat!==null&&item.lat!==undefined)
 const max=Math.max(1,...items.map(item=>item.potentialVolumeT||0))
 const bounds=[]
 if($('#f-by-municipality').checked){
  const groups=new Map()
  for(const item of items){const key=`${item.municipality}|${item.uf}`;const group=groups.get(key)||{key,municipality:item.municipality,uf:item.uf,items:[],lat:0,lng:0,volume:0,high:0};group.items.push(item);group.volume+=item.potentialVolumeT||0;group.high+=item.priority.level==='high'?1:0;groups.set(key,group)}
  const maxVolume=Math.max(1,...[...groups.values()].map(g=>g.volume))
  for(const group of groups.values()){
   group.lat=group.items.reduce((s,i)=>s+i.lat,0)/group.items.length;group.lng=group.items.reduce((s,i)=>s+i.lng,0)/group.items.length
   const radius=14+Math.sqrt(group.volume/maxVolume)*30
   const marker=L.circleMarker([group.lat,group.lng],{radius,color:'#fff',weight:2,fillColor:group.high?priorityColor.high:'#2d8cff',fillOpacity:.75})
   marker.bindTooltip(`<span class="marker-tip">${esc(group.municipality)}/${esc(group.uf)}</span><br>${group.items.length} produtor${group.items.length===1?'':'es'} · ${fmt(group.volume)} t<br>${group.high} em prioridade alta`,{direction:'top'})
   marker.on('click',()=>{state.map.setView([group.lat,group.lng],9);$('#f-by-municipality').checked=false;renderMap()})
   marker.addTo(state.layer);bounds.push([group.lat,group.lng])
  }
 }else{
  for(const item of items){
   const radius=6+Math.sqrt((item.potentialVolumeT||0)/max)*16
   const marker=L.circleMarker([item.lat,item.lng],{radius,color:'#fff',weight:2,fillColor:priorityColor[item.priority.level],fillOpacity:.85})
   marker.bindTooltip(`<span class="marker-tip">${esc(item.name)}</span><br>${esc(item.municipality)}/${esc(item.uf)} · ${fmt(item.potentialVolumeT)} t · score ${item.score}`,{direction:'top'})
   marker.on('click',()=>showDetail(item.producerId))
   marker.addTo(state.layer);bounds.push([item.lat,item.lng])
  }
 }
 $('#map-count').textContent=`${items.length} de ${state.data.producers.length} produtores no mapa.`
 if(bounds.length&&!renderMap.fitted){state.map.fitBounds(bounds,{padding:[40,40],maxZoom:9});renderMap.fitted=true}
 renderPlan()
}
$('#plan-toggle').addEventListener('change',event=>{state.plan.active=event.target.checked;$('#plan-radius-field').hidden=!state.plan.active;$('#plan-hint').textContent=state.plan.active?'Clique no mapa para definir o centro. Arraste o raio para ampliar.':'Ative e clique no mapa para definir o centro da visita.';if(!state.plan.active){state.plan.center=null}renderPlan()})
$('#plan-radius').addEventListener('input',event=>{state.plan.radiusKm=Number(event.target.value);$('#plan-radius-label').textContent=state.plan.radiusKm;renderPlan()})
async function renderPlan(){
 state.planLayer.clearLayers();const box=$('#plan-result')
 if(!state.plan.active||!state.plan.center){box.hidden=true;return}
 const {lat,lng}=state.plan.center
 L.circle([lat,lng],{radius:state.plan.radiusKm*1000,color:'#2d8cff',weight:2,fillOpacity:.06,dashArray:'6 6'}).addTo(state.planLayer)
 L.circleMarker([lat,lng],{radius:5,color:'#fff',fillColor:'#071b19',fillOpacity:1,weight:2}).addTo(state.planLayer)
 try{
  const result=await api(`/api/nearby?lat=${lat}&lng=${lng}&radiusKm=${state.plan.radiusKm}`)
  const f=filters();const visible=new Set(filteredScored().map(item=>item.producerId))
  const items=result.items.filter(item=>visible.has(item.producerId))
  const volume=items.reduce((s,i)=>s+(i.potentialVolumeT||0),0)
  box.hidden=false
  box.innerHTML=`<b>${items.length} produtor${items.length===1?'':'es'}</b> em até ${state.plan.radiusKm} km · potencial ${fmt(volume)} t${Object.values(f).some(Boolean)?' (filtros aplicados)':''}
   <ol>${items.slice(0,25).map(item=>`<li><a href="#" data-detail="${item.producerId}">${esc(item.name)}</a> — ${esc(item.municipality)} · ${item.distanceKm} km · <span class="badge ${item.priority.level}">${item.score}</span></li>`).join('')}</ol>`
 }catch(error){box.hidden=false;box.textContent=error.message}
}
document.addEventListener('click',event=>{const link=event.target.closest('[data-detail]');if(link){event.preventDefault();showDetail(link.dataset.detail);if(state.view!=='map')setView('map')}})

function scoreRing(score,level){return `<div class="score-ring" style="background:${priorityColor[level]}">${score}</div>`}
function showDetail(producerId){
 const item=state.data.scored.find(s=>s.producerId===producerId);const producer=state.data.producers.find(p=>p.id===producerId)
 if(!item||!producer)return
 state.selected=producerId
 if(item.lat!==null&&item.lat!==undefined&&state.map)state.map.panTo([item.lat,item.lng])
 const box=$('#detail');box.hidden=false
 box.innerHTML=`<button class="close" aria-label="Fechar" data-close>×</button>
  <h2>${esc(item.name)}</h2>
  <div class="meta">${esc(item.municipality)}/${esc(item.uf||'')}${producer.region?` · ${esc(producer.region)}`:''} · <span class="badge" style="background:${relationshipColor[item.relationship]}22;color:${relationshipColor[item.relationship]}">${esc(item.relationshipLabel)}</span>${producer.consultant?` · ${esc(producer.consultant)}`:''}</div>
  <div class="score-row">${scoreRing(item.score,item.priority.level)}<div><b>${esc(item.priority.label)}</b><div class="meta">${fmt(item.areaHa)} ha · potencial <b>${fmt(item.potentialVolumeT)} t</b> (${fmtSc(item.potentialVolumeT)})${producer.storageCapacityT?` · armazena ${fmt(producer.storageCapacityT)} t (${fmtSc(producer.storageCapacityT)})`:''}</div><div class="cultures">${item.cultures.map(c=>`<span class="chip">${esc(labels.commodities[c]||c)}</span>`).join('')}</div></div></div>
  <div class="blocks"><div>Potencial<b>${item.blocks.potential}/30</b></div><div>Relação<b>${item.blocks.readiness}/25</b></div><div>Mercado<b>${item.blocks.market}/30</b></div><div>Janela<b>${item.blocks.timing}/15</b></div></div>
  <div class="next-action">→ ${esc(item.nextAction)}</div>
  ${item.intent?`<div class="meta">Intenção: <b>${esc(item.intent.direction==='sell'?'venda':'compra')} de ${fmt(item.intent.volumeT)} t de ${esc(item.intent.commodityLabel)}</b> · ${esc(item.intent.statusLabel)} · alvo ${fmtMoney(item.intent.targetPrice,item.intent.priceUnit)}${item.marketReference?` · cotação ${fmtMoney(item.marketReference.price,item.marketReference.priceUnit)} (${esc(item.marketReference.region)}, ${esc(item.marketReference.freshness)})`:''}</div>`:''}
  <ul class="reasons">${item.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>
  ${item.warnings.length?`<ul class="warnings">${item.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}
  <div class="meta">${producer.season?`Safra <b>${esc(producer.season)}</b> · `:''}${producer.productivityScHa?`produtividade <b>${fmt(producer.productivityScHa)} sc/ha</b> · `:''}${producer.freight?`frete <b>${{cif:'CIF',fob:'FOB',both:'CIF e FOB'}[producer.freight]}</b> · `:''}Último contato: <b>${fmtDate(producer.lastContactAt)}</b>${producer.phone?` · ${esc(producer.phone)}`:''}</div>
  ${producer.locationPrecision==='municipality'?'<p class="meta" style="margin-top:6px"><span class="precision">Localização aproximada pelo município</span> — clique em Editar e marque o ponto exato no mini-mapa.</p>':''}
  ${producer.notes?`<p class="meta" style="margin-top:6px">${esc(producer.notes)}</p>`:''}
  <div class="detail-actions">
   <button class="btn small primary" data-act="interaction">Registrar interação</button>
   <button class="btn small" data-act="intent">Nova intenção</button>
   <button class="btn small" data-act="edit">Editar</button>
   <button class="btn small ghost danger" data-act="delete">Excluir</button>
  </div>`
 $('[data-close]',box).onclick=()=>{box.hidden=true;state.selected=null}
 $$('[data-act]',box).forEach(button=>button.onclick=()=>producerAction(button.dataset.act,producer))
}
function producerAction(action,producer){
 if(action==='edit')return openProducerForm(producer)
 if(action==='intent')return openIntentForm(producer.id)
 if(action==='interaction')return openInteractionForm(producer.id)
 if(action==='delete'&&confirm(`Excluir ${producer.name} e suas intenções e interações?`))run(()=>api(`/api/producers/${producer.id}`,{method:'DELETE'}),'Produtor excluído.').then(()=>{$('#detail').hidden=true})
}

// --- produtores ----------------------------------------------------------------
$('#p-search').addEventListener('input',renderProducers)
$$('#p-table th[data-sort]').forEach(th=>th.addEventListener('click',()=>{const key=th.dataset.sort;state.sort={key,dir:state.sort.key===key?-state.sort.dir:(key==='score'||key==='areaHa'||key==='potentialVolumeT'?-1:1)};renderProducers()}))
function renderProducers(){
 const search=$('#p-search').value.trim().toLowerCase()
 const byId=new Map(state.data.scored.map(item=>[item.producerId,item]))
 let rows=state.data.producers.map(p=>({...p,...(byId.get(p.id)||{}),id:p.id})).filter(p=>!search||`${p.name} ${p.municipality} ${p.uf} ${p.consultant||''} ${p.cultures.map(c=>labels.commodities[c]).join(' ')}`.toLowerCase().includes(search))
 const {key,dir}=state.sort
 rows.sort((a,b)=>{const va=a[key]??(dir>0?'￿':-1);const vb=b[key]??(dir>0?'￿':-1);return (typeof va==='number'?va-vb:String(va).localeCompare(String(vb),'pt-BR'))*dir})
 $('#p-empty').hidden=rows.length>0||Boolean(search)
 $('#p-table tbody').innerHTML=rows.map(p=>`<tr>
  <td><a href="#" data-detail="${p.id}"><b>${esc(p.name)}</b></a>${p.lat===null||p.lat===undefined?' <span class="badge incomplete" title="Sem coordenadas">sem mapa</span>':p.locationPrecision==='municipality'?' <span class="badge watch" title="Localização aproximada pelo município">aprox.</span>':''}</td>
  <td>${esc(p.municipality)}${p.uf?`/${esc(p.uf)}`:''}</td>
  <td><div class="cultures">${p.cultures.map(c=>`<span class="chip">${esc(labels.commodities[c]||c)}</span>`).join('')}</div></td>
  <td class="num">${fmt(p.areaHa)}</td><td class="num" title="${fmtSc(p.potentialVolumeT)}">${fmt(p.potentialVolumeT)}</td>
  <td><span class="badge" style="background:${relationshipColor[p.relationship]}22;color:${relationshipColor[p.relationship]}">${esc(labels.relationships[p.relationship]||p.relationship)}</span></td>
  <td>${fmtDate(p.lastContactAt)}</td>
  <td class="num"><span class="score-pill" style="background:${priorityColor[p.priority?.level||'incomplete']}">${p.score??'—'}</span></td>
  <td><button class="btn ghost small" data-edit="${p.id}">Editar</button></td></tr>`).join('')
 $$('[data-edit]').forEach(button=>button.onclick=()=>openProducerForm(state.data.producers.find(p=>p.id===button.dataset.edit)))
}
$('#p-new').addEventListener('click',()=>openProducerForm())
$('#p-import').addEventListener('click',openImport)
$('#p-more').addEventListener('click',event=>{event.stopPropagation();$('#p-more-menu').hidden=!$('#p-more-menu').hidden})
document.addEventListener('click',()=>{$('#p-more-menu').hidden=true})
$('#p-template').addEventListener('click',()=>download('modelo-val-mapa.csv','produtor;municipio;uf;regiao;safra;latitude;longitude;area_ha;produtividade;producao em sacas;volume_t;armazenagem_t;cif;fob;culturas;relacionamento;consultor;telefone;ultimo_contato;observacoes\nFazenda Exemplo;Ijuí;RS;Noroeste;26/27;-28.3878;-53.9149;1200;170;;3900;3000;x;;soja, milho;ativo;Ana;(55) 99999-0000;2026-10-20;Produtor com armazenagem própria\nSítio Exemplo em sacas;São Luiz Gonzaga;RS;Missões;26/27;;;320;180;57600;;;;x;milho;em contato;Ana;;;Produção informada em sacas de 60 kg\n','text/csv'))
$('#p-example').addEventListener('click',()=>{if(confirm('Carregar 14 produtores fictícios de exemplo, com intenções, cotações e interações? Você pode apagar tudo depois.'))run(()=>api('/api/example',{method:'POST'}),'Dados de exemplo carregados.').then(()=>{renderMap.fitted=false;renderMap()})})
$('#p-reset').addEventListener('click',()=>{const typed=prompt('Isso apaga TODOS os produtores, intenções, cotações e interações. Digite APAGAR TUDO para confirmar.');if(typed==='APAGAR TUDO')run(()=>api('/api/reset',{method:'POST',body:{confirm:typed}}),'Dados apagados.')})
$('#p-geocode').addEventListener('click',async()=>{
 const pending=state.data.producers.filter(p=>p.lat===null||p.lat===undefined)
 if(!pending.length)return toast('Todos os produtores já têm coordenadas.')
 if(!confirm(`Localizar ${pending.length} produtor(es) pelo município usando OpenStreetMap? Leva cerca de ${pending.length} segundo(s).`))return
 let done=0;let failed=0
 for(const producer of pending){
  try{const {result}=await api(`/api/geocode?municipality=${encodeURIComponent(producer.municipality)}&uf=${encodeURIComponent(producer.uf||'')}`);if(result){await api(`/api/producers/${producer.id}`,{method:'PUT',body:{...producer,lat:result.lat,lng:result.lng}});done++}else failed++}
  catch{failed++}
  toast(`Localizando… ${done+failed}/${pending.length}`)
 }
 toast(`${done} localizado(s)${failed?`, ${failed} sem resultado`:''}.`);await reload();renderMap.fitted=false;renderMap()
})
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=Object.assign(document.createElement('a'),{href:url,download:name});a.click();URL.revokeObjectURL(url)}

// --- formulários -----------------------------------------------------------------
function openModal(html){$('#modal-body').innerHTML=html;$('#modal').hidden=false;const first=$('#modal input,#modal select,#modal textarea');first?.focus();return $('#modal-body')}
function closeModal(){if(state.modalCleanup){try{state.modalCleanup()}catch{}state.modalCleanup=null}$('#modal').hidden=true}
$('#modal').addEventListener('click',event=>{if(event.target.id==='modal'&&!document.body.classList.contains('map-fullscreen'))closeModal()})
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(state.exitMapFullscreen&&state.exitMapFullscreen())return;closeModal()}})
const options=(items,selected)=>items.map(item=>`<option value="${esc(item.value)}" ${item.value===selected?'selected':''}>${esc(item.label)}</option>`).join('')
const formData=form=>Object.fromEntries(new FormData(form).entries())
const producerOptions=selected=>options([...state.data.producers].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(p=>({value:p.id,label:`${p.name} — ${p.municipality}`})),selected)

function openProducerForm(producer={}){
 const {catalog}=state.data;const editing=Boolean(producer.id)
 const unit=producer.volumeUnit==='sc'?'sc':'t'
 const inUnit=(tonnes,u)=>tonnes===null||tonnes===undefined?'':u==='sc'?String(Math.round(tonnes/SC_TONNES)):String(tonnes)
 const body=openModal(`<h2>${editing?'Editar produtor':'Novo produtor'}</h2><form id="producer-form">
  <label class="field"><span>Nome *</span><input name="name" required value="${esc(producer.name||'')}"></label>
  <div class="grid-3">
   <label class="field" style="grid-column:span 2"><span>Município *</span><input name="municipality" required value="${esc(producer.municipality||'')}"></label>
   <label class="field"><span>UF</span><select name="uf"><option value="">—</option>${options(catalog.ufs.map(uf=>({value:uf,label:uf})),producer.uf)}</select></label>
  </div>
  <div class="grid-3">
   <label class="field"><span>Região</span><input name="region" list="region-list" value="${esc(producer.region||'')}" placeholder="ex.: Missões"><datalist id="region-list">${[...new Set(state.data.producers.map(p=>p.region).filter(Boolean))].map(r=>`<option value="${esc(r)}">`).join('')}</datalist></label>
   <label class="field"><span>Safra</span><input name="season" value="${esc(producer.season||'')}" placeholder="ex.: 26/27"></label>
   <label class="field"><span>Consultor</span><input name="consultant" value="${esc(producer.consultant||'')}"></label>
  </div>
  <div class="field"><span>Localização da propriedade <span class="hint">(clique no mapa, arraste o marcador ou use o GPS)</span></span>
   <div id="form-map" class="form-map"></div>
   <div class="form-map-tools">
    <button type="button" class="btn small" id="gps-btn">Usar minha posição (GPS)</button>
    <button type="button" class="btn small" id="geocode-btn">Centralizar pelo município</button>
    <span id="gps-status" class="hint"></span>
    ${producer.locationPrecision==='municipality'?'<span class="precision">aproximada pelo município</span>':''}
   </div>
  </div>
  <div class="grid-3">
   <label class="field"><span>Latitude</span><input name="lat" inputmode="decimal" value="${producer.lat??''}"></label>
   <label class="field"><span>Longitude</span><input name="lng" inputmode="decimal" value="${producer.lng??''}"></label>
   <input type="hidden" name="locationPrecision" value="${esc(producer.locationPrecision||'')}">
   <label class="field"><span>Área (ha)</span><input name="areaHa" inputmode="decimal" value="${producer.areaHa??''}"></label>
  </div>
  <div class="grid-3">
   <label class="field"><span>Armazenagem (<span data-unit-label>t</span>)</span><input name="storageCapacityT" inputmode="decimal" value="${inUnit(producer.storageCapacityT,unit)}"></label>
   <label class="field"><span>Volume estimado (<span data-unit-label>t</span>)</span><input name="estimatedVolumeT" inputmode="decimal" value="${inUnit(producer.estimatedVolumeT,unit)}" placeholder="vazio = área × produtividade"></label>
   <label class="field"><span>Unidade de volume</span><select name="volumeUnit"><option value="t" ${unit==='t'?'selected':''}>Toneladas (t)</option><option value="sc" ${unit==='sc'?'selected':''}>Sacas de 60 kg (sc)</option></select></label>
  </div>
  <div class="grid-3">
   <label class="field"><span>Produtividade (sc/ha)</span><input name="productivityScHa" inputmode="decimal" value="${producer.productivityScHa??''}"></label>
   <label class="field"><span>Frete</span><select name="freight"><option value="">—</option><option value="cif" ${producer.freight==='cif'?'selected':''}>CIF</option><option value="fob" ${producer.freight==='fob'?'selected':''}>FOB</option><option value="both" ${producer.freight==='both'?'selected':''}>CIF e FOB</option></select></label>
   <label class="field"><span>Relacionamento</span><select name="relationship">${options(catalog.relationships,producer.relationship||'prospect')}</select></label>
  </div>
  <p class="hint" style="margin:0">1 saca = 60 kg. O score usa toneladas; valores em sacas são convertidos automaticamente. Sem volume informado, o potencial é área × produtividade (ou área × 3 t).</p>
  <div class="field"><span>Culturas</span><div class="cultures" style="gap:8px">${catalog.commodities.map(c=>`<label class="toggle"><input type="checkbox" name="cultures" value="${c.value}" ${(producer.cultures||[]).includes(c.value)?'checked':''}><span>${esc(c.label)}</span></label>`).join('')}</div></div>
  <div class="grid-3">
   <label class="field"><span>Telefone</span><input name="phone" value="${esc(producer.phone||'')}"></label>
   <label class="field"><span>Último contato</span><input name="lastContactAt" type="date" value="${producer.lastContactAt?producer.lastContactAt.slice(0,10):''}"></label>
  </div>
  <label class="field"><span>Observações</span><textarea name="notes">${esc(producer.notes||'')}</textarea></label>
  <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button class="btn primary">${editing?'Salvar':'Cadastrar'}</button></div>
 </form>`)
 $('.modal-card').classList.add('wide')
 const form=$('#producer-form',body)
 $('[data-cancel]',form).onclick=closeModal
 form.volumeUnit.onchange=()=>{
  // Converte os valores já digitados para a nova unidade, para o usuário não precisar refazer a conta.
  const to=form.volumeUnit.value
  for(const name of ['storageCapacityT','estimatedVolumeT']){const raw=Number(String(form[name].value).replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));if(form[name].value&&Number.isFinite(raw))form[name].value=to==='sc'?String(Math.round(raw/SC_TONNES)):String(Number((raw*SC_TONNES).toFixed(2)))}
  $$('[data-unit-label]',form).forEach(el=>el.textContent=to)
 }
 $$('[data-unit-label]',form).forEach(el=>el.textContent=unit)

 // Mini-mapa: escolha da localização em tempo real.
 const hasPoint=producer.lat!==null&&producer.lat!==undefined
 const miniMap=L.map('form-map',{zoomControl:true,attributionControl:false}).setView(hasPoint?[producer.lat,producer.lng]:[-15.8,-52],hasPoint?(producer.locationPrecision==='municipality'?11:14):4)
 const miniStreets=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19})
 const miniImagery=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19})
 let miniBase='Mapa';try{miniBase=localStorage.getItem('val-mapa-base')||'Mapa'}catch{}
 ;(miniBase==='Mapa'?miniStreets:miniImagery).addTo(miniMap)
 L.control.layers({'Mapa':miniStreets,'Satélite':miniImagery},null,{position:'topright'}).addTo(miniMap)
 let marker=null;let gpsMarker=null;let gpsWatch=null
 const placeMarker=(lat,lng,precision='exact')=>{
  if(!marker){marker=L.marker([lat,lng],{draggable:true}).addTo(miniMap);marker.on('dragend',()=>{const p=marker.getLatLng();form.lat.value=p.lat.toFixed(5);form.lng.value=p.lng.toFixed(5);form.locationPrecision.value='exact'})}
  else marker.setLatLng([lat,lng])
  form.lat.value=Number(lat).toFixed(5);form.lng.value=Number(lng).toFixed(5);form.locationPrecision.value=precision
  const badge=$('.form-map-tools .precision',form);if(badge)badge.hidden=precision==='exact'
 }
 if(hasPoint)placeMarker(producer.lat,producer.lng,producer.locationPrecision||'exact')
 // Tela cheia: o toque no mapa pequeno abre a tela cheia; na tela cheia, o toque marca a propriedade.
 const mapBox=$('#form-map',form)
 const setFullscreen=on=>{
  mapBox.classList.toggle('fullscreen',on);document.body.classList.toggle('map-fullscreen',on)
  fullscreenControl.getContainer().querySelector('a').textContent=on?'Concluir':'Tela cheia'
  hintControl.getContainer().hidden=!on
  setTimeout(()=>{miniMap.invalidateSize();if(on&&marker)miniMap.setView(marker.getLatLng(),Math.max(miniMap.getZoom(),14))},60)
 }
 const isFullscreen=()=>mapBox.classList.contains('fullscreen')
 const fullscreenControl=L.control({position:'topleft'})
 fullscreenControl.onAdd=()=>{const div=L.DomUtil.create('div','leaflet-bar leaflet-control-fullscreen');const a=L.DomUtil.create('a','',div);a.href='#';a.textContent='Tela cheia';a.setAttribute('role','button');L.DomEvent.on(a,'click',event=>{L.DomEvent.stop(event);setFullscreen(!isFullscreen())});L.DomEvent.disableClickPropagation(div);return div}
 fullscreenControl.addTo(miniMap)
 const hintControl=L.control({position:'bottomleft'})
 hintControl.onAdd=()=>{const div=L.DomUtil.create('div','form-map-hint');div.innerHTML='<b>Toque no mapa</b> para marcar a propriedade. Arraste o pin para ajustar. Depois toque em <b>Concluir</b>.';div.hidden=true;L.DomEvent.disableClickPropagation(div);return div}
 hintControl.addTo(miniMap)
 miniMap.on('click',event=>{if(!isFullscreen())return setFullscreen(true);placeMarker(event.latlng.lat,event.latlng.lng,'exact')})
 state.exitMapFullscreen=()=>{if(isFullscreen()){setFullscreen(false);return true}return false}
 const syncFromInputs=()=>{const lat=Number(String(form.lat.value).replace(',','.'));const lng=Number(String(form.lng.value).replace(',','.'));if(form.lat.value&&form.lng.value&&Number.isFinite(lat)&&Number.isFinite(lng)){placeMarker(lat,lng,'exact');miniMap.setView([lat,lng],Math.max(miniMap.getZoom(),12))}}
 form.lat.onchange=syncFromInputs;form.lng.onchange=syncFromInputs
 setTimeout(()=>miniMap.invalidateSize(),60)
 const stopGps=()=>{if(gpsWatch!==null&&navigator.geolocation){navigator.geolocation.clearWatch(gpsWatch);gpsWatch=null}}
 const gpsControl=L.control({position:'topleft'})
 gpsControl.onAdd=()=>{const div=L.DomUtil.create('div','leaflet-bar leaflet-control-gps');const a=L.DomUtil.create('a','',div);a.href='#';a.textContent='GPS';a.title='Usar minha posição';L.DomEvent.on(a,'click',event=>{L.DomEvent.stop(event);$('#gps-btn',form).click()});L.DomEvent.disableClickPropagation(div);return div}
 gpsControl.addTo(miniMap)
 $('#gps-btn',form).onclick=()=>{
  const status=$('#gps-status',form)
  if(!navigator.geolocation)return toast('Este navegador não oferece geolocalização.',true)
  if(gpsWatch!==null){const p=gpsMarker?.getLatLng();if(p){placeMarker(p.lat,p.lng,'exact');miniMap.setView([p.lat,p.lng],16);status.textContent='Posição do GPS aplicada ao cadastro.'}stopGps();$('#gps-btn',form).textContent='Usar minha posição (GPS)';return}
  status.textContent='Buscando posição…';$('#gps-btn',form).textContent='Aplicar posição atual'
  gpsWatch=navigator.geolocation.watchPosition(position=>{
   const {latitude,longitude,accuracy}=position.coords
   if(!gpsMarker)gpsMarker=L.marker([latitude,longitude],{icon:L.divIcon({className:'',html:'<div class="gps-dot"></div>',iconSize:[14,14],iconAnchor:[7,7]}),interactive:false}).addTo(miniMap)
   else gpsMarker.setLatLng([latitude,longitude])
   if(!marker){placeMarker(latitude,longitude,'exact');miniMap.setView([latitude,longitude],16)}
   status.textContent=`GPS ao vivo: precisão de ±${Math.round(accuracy)} m. Clique em "Aplicar posição atual" para fixar.`
  },error=>{status.textContent='';toast(error.code===1?'Permita o acesso à localização no navegador.':'Não foi possível obter a posição.',true);stopGps();$('#gps-btn',form).textContent='Usar minha posição (GPS)'},{enableHighAccuracy:true,maximumAge:5000,timeout:20000})
 }
 $('#geocode-btn',form).onclick=async()=>{
  const municipality=form.municipality.value.trim();if(!municipality)return toast('Informe o município primeiro.',true)
  const button=$('#geocode-btn',form);button.disabled=true;button.textContent='Localizando…'
  try{const {result}=await api(`/api/geocode?municipality=${encodeURIComponent(municipality)}&uf=${encodeURIComponent(form.uf.value)}`);if(!result)toast('Município não encontrado.',true);else{miniMap.setView([result.lat,result.lng],12);if(!marker)placeMarker(result.lat,result.lng,'municipality');toast(`Centralizado em ${result.label.split(',').slice(0,2).join(',')}. Agora marque o ponto exato.`)}}
  catch(error){toast(error.message,true)}finally{button.disabled=false;button.textContent='Centralizar pelo município'}
 }
 const cleanup=()=>{stopGps();document.body.classList.remove('map-fullscreen');state.exitMapFullscreen=null;miniMap.remove();$('.modal-card').classList.remove('wide')}
 state.modalCleanup=cleanup
 form.onsubmit=event=>{
  event.preventDefault()
  const data={...formData(form),cultures:$$('input[name=cultures]:checked',form).map(input=>input.value)}
  run(()=>api(editing?`/api/producers/${producer.id}`:'/api/producers',{method:editing?'PUT':'POST',body:data}),editing?'Produtor atualizado.':'Produtor cadastrado.').then(()=>{closeModal();if(!editing){renderMap.fitted=false}})
 }
}

function openIntentForm(producerId){
 const {catalog}=state.data
 if(!state.data.producers.length)return toast('Cadastre um produtor antes.',true)
 const body=openModal(`<h2>Nova intenção comercial</h2><form id="intent-form">
  <label class="field"><span>Produtor *</span><select name="producerId" required>${producerOptions(producerId)}</select></label>
  <div class="grid-3">
   <label class="field"><span>Cultura *</span><select name="commodity">${options(catalog.commodities)}</select></label>
   <label class="field"><span>Direção</span><select name="direction"><option value="sell">Venda</option><option value="buy">Compra</option></select></label>
   <label class="field"><span>Volume (t) *</span><input name="volumeT" inputmode="decimal" required></label>
  </div>
  <div class="grid-3">
   <label class="field"><span>Preço-alvo</span><input name="targetPrice" inputmode="decimal"></label>
   <label class="field"><span>Unidade</span><select name="priceUnit">${options(catalog.priceUnits)}</select></label>
   <label class="field"><span>Local de entrega</span><input name="deliveryLocation"></label>
  </div>
  <div class="grid-3">
   <label class="field"><span>Janela início</span><input name="deliveryStart" type="date"></label>
   <label class="field"><span>Janela fim</span><input name="deliveryEnd" type="date"></label>
   <label class="field"><span>Confiança (%)</span><input name="confidence" type="number" min="0" max="100" value="50"></label>
  </div>
  <label class="field"><span>Estado</span><select name="status"><option value="draft">Sinal (não confirmado)</option><option value="monitoring">Monitorando</option><option value="confirmed">Confirmada pelo produtor (confiança ≥ 80%)</option></select></label>
  <label class="field"><span>Observações</span><textarea name="notes"></textarea></label>
  <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button class="btn primary">Registrar</button></div>
 </form>`)
 const form=$('#intent-form',body);$('[data-cancel]',form).onclick=closeModal
 form.onsubmit=event=>{event.preventDefault();run(()=>api('/api/intents',{method:'POST',body:formData(form)}),'Intenção registrada.').then(closeModal)}
}

function openMarketForm(){
 const {catalog}=state.data
 const body=openModal(`<h2>Registrar cotação</h2><form id="market-form">
  <div class="grid-3">
   <label class="field"><span>Cultura *</span><select name="commodity">${options(catalog.commodities)}</select></label>
   <label class="field"><span>Preço *</span><input name="price" inputmode="decimal" required></label>
   <label class="field"><span>Unidade</span><select name="priceUnit">${options(catalog.priceUnits)}</select></label>
  </div>
  <div class="grid-2">
   <label class="field"><span>Praça / região *</span><input name="region" required></label>
   <label class="field"><span>Fonte *</span><input name="sourceName" required placeholder="Cooperativa, corretora, feed"></label>
  </div>
  <label class="field"><span>Observada em</span><input name="observedAt" type="datetime-local" value="${new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}"></label>
  <label class="field"><span>Observações</span><textarea name="notes"></textarea></label>
  <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button class="btn primary">Registrar</button></div>
 </form>`)
 const form=$('#market-form',body);$('[data-cancel]',form).onclick=closeModal
 form.onsubmit=event=>{event.preventDefault();run(()=>api('/api/market',{method:'POST',body:formData(form)}),'Cotação registrada.').then(closeModal)}
}

function openInteractionForm(producerId){
 const {catalog}=state.data
 if(!state.data.producers.length)return toast('Cadastre um produtor antes.',true)
 const body=openModal(`<h2>Registrar interação</h2><form id="interaction-form">
  <label class="field"><span>Produtor *</span><select name="producerId" required>${producerOptions(producerId)}</select></label>
  <div class="grid-3">
   <label class="field"><span>Tipo</span><select name="kind">${options(catalog.interactionKinds)}</select></label>
   <label class="field"><span>Data</span><input name="occurredAt" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
   <label class="field"><span>Resultado</span><select name="outcome"><option value="positive">Positivo</option><option value="neutral" selected>Neutro</option><option value="negative">Negativo</option></select></label>
  </div>
  <label class="field"><span>Notas</span><textarea name="notes"></textarea></label>
  <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button class="btn primary">Registrar</button></div>
 </form>`)
 const form=$('#interaction-form',body);$('[data-cancel]',form).onclick=closeModal
 form.onsubmit=event=>{event.preventDefault();run(()=>api('/api/interactions',{method:'POST',body:formData(form)}),'Interação registrada.').then(closeModal)}
}

// --- importação CSV / XLSX ------------------------------------------------------
const toBase64=buffer=>{let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(binary)}
function openImport(){
 const {catalog}=state.data
 const body=openModal(`<h2>Importar produtores (CSV ou Excel)</h2>
  <p class="hint">Envie a planilha como está: o VAL Mapa encontra a linha de cabeçalho e reconhece colunas como <b>produtor/nome, município, UF, região, área, produtividade (sc/ha), produção em sacas, volume (t), armazenagem, CIF, FOB, consultor, telefone, último contato</b>. O que a planilha não tiver, preencha nos valores padrão abaixo. Produtores com mesmo nome e município são atualizados.</p>
  <form id="import-form">
   <label class="field"><span>Arquivo (.xlsx ou .csv)</span><input type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
   <label class="field"><span>ou cole o conteúdo CSV</span><textarea name="text" placeholder="nome;municipio;uf;area_ha;producao em sacas"></textarea></label>
   <strong class="hint">Valores padrão para linhas sem a coluna</strong>
   <div class="grid-3">
    <label class="field"><span>Município</span><input name="municipality"></label>
    <label class="field"><span>UF</span><select name="uf"><option value="">—</option>${options(catalog.ufs.map(uf=>({value:uf,label:uf})))}</select></label>
    <label class="field"><span>Região</span><input name="region" placeholder="ex.: Missões"></label>
    <label class="field"><span>Cultura</span><select name="cultures"><option value="">—</option>${options(catalog.commodities)}</select></label>
    <label class="field"><span>Safra</span><input name="season" placeholder="ex.: 26/27"></label>
    <label class="field"><span>Consultor</span><input name="consultant"></label>
    <label class="field"><span>Relacionamento</span><select name="relationship">${options(catalog.relationships,'prospect')}</select></label>
    <label class="field"><span>Unidade de volume</span><select name="volumeUnit"><option value="t">Toneladas</option><option value="sc">Sacas de 60 kg</option></select></label>
   </div>
   <div id="import-preview" class="import-preview"></div>
   <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button type="button" class="btn" id="import-preview-btn">Pré-visualizar</button><button class="btn primary">Importar</button></div>
  </form>`)
 const form=$('#import-form',body);$('[data-cancel]',form).onclick=closeModal
 const payload=async()=>{
  const defaults=Object.fromEntries(Object.entries(formData(form)).filter(([key,value])=>!['file','text'].includes(key)&&value!==''))
  const file=form.file.files[0]
  if(file)return {filename:file.name,contentBase64:toBase64(await file.arrayBuffer()),defaults,batch:file.name.replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)}
  if(form.text.value.trim())return {filename:'colado.csv',contentBase64:btoa(unescape(encodeURIComponent(form.text.value))),defaults}
  return null
 }
 $('#import-preview-btn',form).onclick=async()=>{
  const data=await payload();if(!data)return toast('Escolha um arquivo ou cole o conteúdo.',true)
  try{const preview=await api('/api/producers/preview-file',{method:'POST',body:data});$('#import-preview',form).innerHTML=`<b>${preview.count} produtor(es)</b> encontrados${preview.sheet?` na aba "${esc(preview.sheet)}"`:''} (cabeçalho na linha ${preview.headerLine}). Colunas reconhecidas: ${preview.fields.join(', ')}.${preview.skipped.length?` Linhas ignoradas sem nome: ${preview.skipped.join(', ')}.`:''}<br>Exemplo: ${esc(JSON.stringify(preview.sample[0]||{}))}`}
  catch(error){$('#import-preview',form).innerHTML=`<span class="error">${esc(error.message)}</span>`}
 }
 form.onsubmit=async event=>{
  event.preventDefault()
  const data=await payload();if(!data)return toast('Escolha um arquivo ou cole o conteúdo.',true)
  run(async()=>{const result=await api('/api/producers/import-file',{method:'POST',body:data});toast(`${result.inserted} novo(s), ${result.updated} atualizado(s), ${result.rejected.length} rejeitado(s).`);if(result.rejected.length)alert(`Linhas rejeitadas:\n${result.rejected.slice(0,15).map(r=>`${r.line}: ${r.name||'(sem nome)'} — ${r.error}`).join('\n')}`)}).then(()=>{closeModal();renderMap.fitted=false})
 }
}

// --- decisão ------------------------------------------------------------------------
$('#d-priority').addEventListener('change',renderDecision);$('#d-consultant').addEventListener('change',renderDecision)
$('#d-new-intent').addEventListener('click',()=>openIntentForm())
$('#d-new-market').addEventListener('click',openMarketForm)
function renderDecision(){
 const priority=$('#d-priority').value;const consultant=$('#d-consultant').value
 const byId=new Map(state.data.producers.map(p=>[p.id,p]))
 const items=state.data.scored.filter(item=>(!priority||item.priority.level===priority)&&(!consultant||byId.get(item.producerId)?.consultant===consultant))
 $('#d-list').innerHTML=items.length?items.map((item,index)=>`<article class="card">
  <div class="card-head">${scoreRing(item.score,item.priority.level)}<div class="meta"><h3>${index+1}. <a href="#" data-detail="${item.producerId}">${esc(item.name)}</a></h3>${esc(item.municipality)}/${esc(item.uf||'')} · <b>${fmt(item.potentialVolumeT)} t</b> potencial · ${esc(item.relationshipLabel)}${byId.get(item.producerId)?.consultant?` · ${esc(byId.get(item.producerId).consultant)}`:''}</div><span class="badge ${item.priority.level}">${esc(item.priority.label)}</span></div>
  <div class="next-action">→ ${esc(item.nextAction)}</div>
  ${item.intent?`<div class="intent-line"><span class="chip">${esc(item.intent.commodityLabel)}</span><span>${item.intent.direction==='sell'?'Venda':'Compra'} de <b>${fmt(item.intent.volumeT)} t</b> · alvo ${fmtMoney(item.intent.targetPrice,item.intent.priceUnit)} · janela ${item.intent.deliveryStart?fmtDate(item.intent.deliveryStart):'—'}</span><span class="badge muted">${esc(item.intent.statusLabel)} · ${item.intent.confidence}%</span>${item.marketReference?`<span class="meta">cotação ${fmtMoney(item.marketReference.price,item.marketReference.priceUnit)} (${esc(item.marketReference.region)}, ${esc(item.marketReference.freshness)})${item.priceGapPercent!==null?` · <b style="color:${item.priceGapPercent>=0?'var(--p-high)':'#9a6a08'}">${item.priceGapPercent>=0?'+':''}${fmt(item.priceGapPercent,1)}%</b>`:''}</span>`:''}${intentButtons(item.intent)}</div>`:''}
  <details><summary class="hint" style="cursor:pointer">Motivos e alertas</summary><ul class="reasons">${item.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>${item.warnings.length?`<ul class="warnings">${item.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}</details>
  <div class="detail-actions"><button class="btn small" data-int="${item.producerId}">Registrar interação</button><button class="btn small ghost" data-newintent="${item.producerId}">Nova intenção</button></div>
 </article>`).join(''):'<p class="empty">Nenhum produtor nesta seleção.</p>'
 $$('[data-int]').forEach(b=>b.onclick=()=>openInteractionForm(b.dataset.int))
 $$('[data-newintent]').forEach(b=>b.onclick=()=>openIntentForm(b.dataset.newintent))
 $$('[data-status]').forEach(b=>b.onclick=()=>run(()=>api(`/api/intents/${b.dataset.intent}`,{method:'PATCH',body:{status:b.dataset.status}}),'Intenção atualizada.'))
 $$('[data-delintent]').forEach(b=>b.onclick=()=>{if(confirm('Excluir esta intenção?'))run(()=>api(`/api/intents/${b.dataset.delintent}`,{method:'DELETE'}),'Intenção excluída.')})
 const refs=[...state.data.marketRefs].sort((a,b)=>new Date(b.observedAt)-new Date(a.observedAt))
 $('#d-market').innerHTML=refs.length?refs.map(ref=>`<div class="market-item"><div><b>${esc(labels.commodities[ref.commodity]||ref.commodity)}</b> ${fmtMoney(ref.price,ref.priceUnit)}<br><span class="meta">${esc(ref.region)} · ${esc(ref.sourceName)} · ${new Date(ref.observedAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</span></div><button class="btn ghost small danger" data-delmarket="${ref.id}" aria-label="Excluir">×</button></div>`).join(''):'<p class="hint">Nenhuma cotação. Registre a referência de mercado por cultura e praça para o score comparar preço-alvo e mercado.</p>'
 $$('[data-delmarket]').forEach(b=>b.onclick=()=>run(()=>api(`/api/market/${b.dataset.delmarket}`,{method:'DELETE'}),'Cotação excluída.'))
}
function intentButtons(intent){
 const next={draft:[['monitoring','Monitorar'],['confirmed','Confirmar']],monitoring:[['confirmed','Confirmar']],confirmed:[['negotiating','Negociar']],negotiating:[['closed','Fechar']]}[intent.status]||[]
 return `<span class="row">${next.map(([status,label])=>`<button class="btn small" data-intent="${intent.id}" data-status="${status}">${label}</button>`).join('')}${['closed','cancelled'].includes(intent.status)?'':`<button class="btn small ghost" data-intent="${intent.id}" data-status="cancelled">Cancelar</button>`}<button class="btn small ghost danger" data-delintent="${intent.id}" aria-label="Excluir intenção">×</button></span>`
}

// --- acompanhamento -----------------------------------------------------------------
$('#t-months').addEventListener('change',renderTracking)
$('#t-new-interaction').addEventListener('click',()=>openInteractionForm())
$$('[data-download]').forEach(button=>button.addEventListener('click',()=>{const chart=state.charts[button.dataset.download];if(!chart)return;const a=Object.assign(document.createElement('a'),{href:chart.toBase64Image('image/png',1),download:`${button.dataset.download}.png`});a.click()}))
function chart(id,config){
 const canvas=document.getElementById(id);if(!canvas||typeof Chart==='undefined')return
 state.charts[id]?.destroy()
 Chart.defaults.font.family='Manrope, system-ui, sans-serif';Chart.defaults.color='#6c7f78';Chart.defaults.locale='pt-BR'
 state.charts[id]=new Chart(canvas,{...config,options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:12,usePointStyle:true}},...(config.options?.plugins||{})},...(config.options||{}),scales:config.options?.scales}})
}
function aggregates(subset=null){
 const {producers:allProducers,scored:allScored,intents,interactions}=state.data
 const allowed=subset?new Set(subset):null
 const producers=allowed?allProducers.filter(p=>allowed.has(p.id)):allProducers
 const scored=allowed?allScored.filter(s=>allowed.has(s.producerId)):allScored
 const byId=new Map(scored.map(item=>[item.producerId,item]))
 const byUf=new Map();const byCulture=new Map();const byMunicipality=new Map();const byRegion=new Map()
 for(const p of producers){
  const s=byId.get(p.id)||{};const volume=s.potentialVolumeT||0
  const uf=p.uf||'—';const u=byUf.get(uf)||{producers:0,volume:0};u.producers++;u.volume+=volume;byUf.set(uf,u)
  const share=volume/Math.max(1,p.cultures.length)
  for(const c of p.cultures)byCulture.set(c,(byCulture.get(c)||0)+share)
  const key=`${p.municipality}${p.uf?`/${p.uf}`:''}`;const region=p.region||'Sem região'
  const m=byMunicipality.get(`${region}|${key}`)||{region,municipality:key,producers:0,area:0,volume:0,high:0};m.producers++;m.area+=Number(p.areaHa)||0;m.volume+=volume;m.high+=s.priority?.level==='high'?1:0;byMunicipality.set(`${region}|${key}`,m)
  const r=byRegion.get(region)||{region,producers:0,area:0,volume:0,high:0};r.producers++;r.area+=Number(p.areaHa)||0;r.volume+=volume;r.high+=s.priority?.level==='high'?1:0;byRegion.set(region,r)
 }
 const priorities=['high','medium','watch','incomplete'].map(level=>({level,label:{high:'Prioridade alta',medium:'Validar',watch:'Monitorar',incomplete:'Completar dados'}[level],count:scored.filter(s=>s.priority.level===level).length,volume:scored.filter(s=>s.priority.level===level).reduce((sum,s)=>sum+(s.potentialVolumeT||0),0)}))
 const relationships=state.data.catalog.relationships.map(r=>({...r,count:producers.filter(p=>p.relationship===r.value).length}))
 const producerIds=new Set(producers.map(p=>p.id))
 const subsetIntents=allowed?intents.filter(i=>producerIds.has(i.producerId)):intents
 const subsetInteractions=allowed?interactions.filter(i=>producerIds.has(i.producerId)):interactions
 const intentStates=state.data.catalog.intentStatuses.map(s=>({...s,count:subsetIntents.filter(i=>i.status===s.value).length,volume:subsetIntents.filter(i=>i.status===s.value).reduce((sum,i)=>sum+Number(i.volumeT||0),0)}))
 const thirtyDays=Date.now()-30*86_400_000
 const summary={producers:producers.length,mapped:producers.filter(p=>p.lat!==null&&p.lat!==undefined).length,municipalities:new Set(producers.map(p=>`${(p.municipality||'').toLowerCase()}|${p.uf}`)).size,totalAreaHa:Math.round(producers.reduce((sum,p)=>sum+(Number(p.areaHa)||0),0)),potentialVolumeT:Math.round(scored.reduce((sum,s)=>sum+(s.potentialVolumeT||0),0)),activeIntents:subsetIntents.filter(i=>!['closed','cancelled'].includes(i.status)).length,confirmedIntents:subsetIntents.filter(i=>['confirmed','negotiating'].includes(i.status)).length,highPriority:scored.filter(s=>s.priority.level==='high').length,interactions30d:subsetInteractions.filter(i=>new Date(i.occurredAt).getTime()>=thirtyDays).length}
 return {producers,scored,summary,byUf,byCulture,byMunicipality:[...byMunicipality.values()].sort((a,b)=>b.volume-a.volume),byRegion:[...byRegion.values()].sort((a,b)=>b.volume-a.volume),priorities,relationships,intentStates,interactions:subsetInteractions}
}
function renderTracking(){
 const {summary}=state.data;const agg=aggregates();const months=Number($('#t-months').value)
 $('#t-kpis').innerHTML=kpiCards(summary)
 const ufs=[...agg.byUf.entries()].sort((a,b)=>b[1].volume-a[1].volume)
 chart('chart-uf',{type:'bar',data:{labels:ufs.map(([uf])=>uf),datasets:[{label:'Potencial (t)',data:ufs.map(([,v])=>Math.round(v.volume)),backgroundColor:'#009f78',yAxisID:'y',borderRadius:6},{label:'Produtores',data:ufs.map(([,v])=>v.producers),backgroundColor:'#2d8cff',yAxisID:'y1',borderRadius:6}]},options:{scales:{y:{beginAtZero:true,title:{display:true,text:'t'}},y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'produtores'}}}}})
 const cultures=[...agg.byCulture.entries()].sort((a,b)=>b[1]-a[1])
 chart('chart-culture',{type:'doughnut',data:{labels:cultures.map(([c])=>labels.commodities[c]||c),datasets:[{data:cultures.map(([,v])=>Math.round(v)),backgroundColor:palette,borderWidth:2,borderColor:'#fff'}]},options:{cutout:'58%'}})
 chart('chart-priority',{type:'bar',data:{labels:agg.priorities.map(p=>p.label),datasets:[{label:'Produtores',data:agg.priorities.map(p=>p.count),backgroundColor:agg.priorities.map(p=>priorityColor[p.level]),borderRadius:6}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{precision:0}}}}})
 const monthKeys=[];const now=new Date();for(let i=months-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);monthKeys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)}
 const kinds=state.data.catalog.interactionKinds
 chart('chart-interactions',{type:'bar',data:{labels:monthKeys.map(k=>{const [y,m]=k.split('-');return new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})}),datasets:kinds.map((kind,index)=>({label:kind.label,data:monthKeys.map(k=>agg.interactions.filter(i=>i.kind===kind.value&&i.occurredAt.slice(0,7)===k).length),backgroundColor:palette[index],stack:'a',borderRadius:4}))},options:{scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true,ticks:{precision:0}}}}})
 chart('chart-funnel',{type:'bar',data:{labels:agg.relationships.map(r=>r.label),datasets:[{label:'Produtores',data:agg.relationships.map(r=>r.count),backgroundColor:agg.relationships.map(r=>relationshipColor[r.value]),borderRadius:6}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}})
 chart('chart-intents',{type:'bar',data:{labels:agg.intentStates.map(s=>s.label),datasets:[{label:'Volume (t)',data:agg.intentStates.map(s=>Math.round(s.volume)),backgroundColor:'#14ada7',borderRadius:6}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}})
 const byId=new Map(state.data.producers.map(p=>[p.id,p]))
 const recent=[...agg.interactions].sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt)).slice(0,12)
 $('#t-recent').innerHTML=recent.length?recent.map(i=>`<div class="recent-item"><span class="when">${fmtDate(i.occurredAt)}</span><span class="outcome ${i.outcome}" title="${i.outcome}"></span><b>${esc(labels.interactionKinds[i.kind]||i.kind)}</b><a href="#" data-detail="${i.producerId}">${esc(byId.get(i.producerId)?.name||'Produtor removido')}</a><span class="meta">${esc(i.notes||'')}</span><button class="btn ghost small danger" data-delint="${i.id}" aria-label="Excluir" style="margin-left:auto">×</button></div>`).join(''):'<p class="hint">Nenhuma interação registrada.</p>'
 $$('[data-delint]').forEach(b=>b.onclick=()=>run(()=>api(`/api/interactions/${b.dataset.delint}`,{method:'DELETE'}),'Interação excluída.'))
}
const kpiCards=summary=>[
 ['Produtores',summary.producers,`${summary.mapped} no mapa`],['Municípios',summary.municipalities,''],['Área total',`${fmt(summary.totalAreaHa)} ha`,''],['Potencial',`${fmt(summary.potentialVolumeT)} t`,'volume estimado'],['Prioridade alta',summary.highPriority,'produtores'],['Intenções ativas',summary.activeIntents,`${summary.confirmedIntents} confirmadas`],['Interações 30 dias',summary.interactions30d,'']
].map(([label,value,small])=>`<div class="kpi"><span>${label}</span><b>${value}</b>${small?`<small>${small}</small>`:''}</div>`).join('')

// --- apresentação ------------------------------------------------------------------------
$('#pr-print').addEventListener('click',()=>window.print())
const prFilterIds=['#prf-uf','#prf-region','#prf-municipality','#prf-culture','#prf-consultant','#prf-priority','#prf-season']
prFilterIds.forEach(id=>$(id).addEventListener('change',renderPresentation))
$('#prf-clear').addEventListener('click',()=>{prFilterIds.forEach(id=>$(id).value='');renderPresentation()})
function fillPresentationFilters(){
 const {producers,catalog}=state.data
 const fill=(select,items)=>{const current=select.value;const first=select.options[0].outerHTML;select.innerHTML=first+items.map(item=>`<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('');select.value=[...select.options].some(o=>o.value===current)?current:''}
 const uniq=(values)=>[...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR')).map(v=>({value:v,label:v}))
 const uf=$('#prf-uf').value;const region=$('#prf-region').value
 fill($('#prf-uf'),uniq(producers.map(p=>p.uf)))
 fill($('#prf-region'),uniq(producers.filter(p=>!uf||p.uf===uf).map(p=>p.region)))
 fill($('#prf-municipality'),uniq(producers.filter(p=>(!uf||p.uf===uf)&&(!region||p.region===region)).map(p=>p.municipality)))
 fill($('#prf-culture'),catalog.commodities.filter(c=>producers.some(p=>p.cultures.includes(c.value))))
 fill($('#prf-consultant'),uniq(producers.map(p=>p.consultant)))
 fill($('#prf-season'),uniq(producers.map(p=>p.season)))
}
function presentationSubset(){
 const f={uf:$('#prf-uf').value,region:$('#prf-region').value,municipality:$('#prf-municipality').value,culture:$('#prf-culture').value,consultant:$('#prf-consultant').value,priority:$('#prf-priority').value,season:$('#prf-season').value}
 const byId=new Map(state.data.scored.map(s=>[s.producerId,s]))
 const ids=state.data.producers.filter(p=>{
  const s=byId.get(p.id)
  return (!f.uf||p.uf===f.uf)&&(!f.region||p.region===f.region)&&(!f.municipality||p.municipality===f.municipality)&&(!f.culture||p.cultures.includes(f.culture))&&(!f.consultant||p.consultant===f.consultant)&&(!f.priority||s?.priority.level===f.priority)&&(!f.season||p.season===f.season)
 }).map(p=>p.id)
 const labelsActive=[f.uf&&`UF ${f.uf}`,f.region&&`região ${f.region}`,f.municipality&&`município ${f.municipality}`,f.culture&&(labels.commodities[f.culture]||f.culture),f.consultant&&`consultor ${f.consultant}`,f.priority&&{high:'prioridade alta',medium:'validar',watch:'monitorar',incomplete:'completar dados'}[f.priority],f.season&&`safra ${f.season}`].filter(Boolean)
 return {ids,labelsActive}
}
const municipalitySlug=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const meshCache={}
const loadMesh=uf=>meshCache[uf]||(meshCache[uf]=api(`/api/malhas/${encodeURIComponent(uf)}`).catch(error=>{delete meshCache[uf];throw error}))
const choropleth=['#e6f4ee','#b9e3d1','#7fcbae','#3fae88','#0f8a66','#0e3530']
function renderPresentationMap(scored,producers){
 if(!state.prMap){
  state.prMap=L.map('pr-map',{zoomControl:true,scrollWheelZoom:false}).setView([-15.8,-52],4)
  const streets=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap · Malha municipal IBGE'})
  const imagery=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imagens &copy; Esri · Malha municipal IBGE'})
  let saved='Mapa';try{saved=localStorage.getItem('val-mapa-base')||'Mapa'}catch{}
  ;(saved==='Mapa'?streets:imagery).addTo(state.prMap)
  state.prMuniLayer=L.layerGroup().addTo(state.prMap)
  state.prLayer=L.layerGroup().addTo(state.prMap)
  L.control.layers({'Mapa':streets,'Satélite':imagery},{'Limites municipais':state.prMuniLayer,'Produtores':state.prLayer},{position:'topright'}).addTo(state.prMap)
 }
 state.prLayer.clearLayers();state.prMuniLayer.clearLayers()
 const items=scored.filter(s=>s.lat!==null&&s.lat!==undefined)
 const max=Math.max(1,...items.map(s=>s.potentialVolumeT||0))
 for(const item of items){
  L.circleMarker([item.lat,item.lng],{radius:3+Math.sqrt((item.potentialVolumeT||0)/max)*6,color:'#fff',weight:1,fillColor:priorityColor[item.priority.level],fillOpacity:.9})
   .bindTooltip(`<span class="marker-tip">${esc(item.name)}</span><br>${esc(item.municipality)}/${esc(item.uf||'')} · ${fmt(item.potentialVolumeT)} t (${fmtSc(item.potentialVolumeT)}) · score ${item.score}`,{direction:'top'}).addTo(state.prLayer)
 }
 setTimeout(()=>{state.prMap.invalidateSize();if(items.length)state.prMap.fitBounds(items.map(s=>[s.lat,s.lng]),{padding:[30,30],maxZoom:10})},60)
 // Limites municipais (IBGE) pintados pelo potencial dos produtores filtrados em cada município.
 const byMunicipality=new Map()
 for(const s of scored){const key=`${s.uf||''}|${municipalitySlug(s.municipality)}`;const m=byMunicipality.get(key)||{name:s.municipality,producers:0,volume:0,high:0};m.producers++;m.volume+=s.potentialVolumeT||0;m.high+=s.priority.level==='high'?1:0;byMunicipality.set(key,m)}
 const volumes=[...byMunicipality.values()].map(m=>m.volume).filter(v=>v>0).sort((a,b)=>a-b)
 const bucket=volume=>{if(!volume||!volumes.length)return -1;const rank=volumes.filter(v=>v<=volume).length/volumes.length;return Math.min(choropleth.length-1,Math.floor(rank*(choropleth.length-1)))}
 const ufs=[...new Set(producers.map(p=>p.uf).filter(Boolean))]
 const token=(state.prMeshToken=(state.prMeshToken||0)+1)
 const status=$('#pr-map-status');if(status)status.textContent=ufs.length?'Carregando limites municipais do IBGE…':''
 Promise.all(ufs.map(uf=>loadMesh(uf).then(mesh=>({uf,mesh})).catch(()=>null))).then(results=>{
  if(token!==state.prMeshToken)return
  let painted=0
  for(const result of results.filter(Boolean)){
   L.geoJSON(result.mesh,{
    style:feature=>{const data=byMunicipality.get(`${result.uf}|${feature.properties.slug}`);const b=data?bucket(data.volume):-1;if(data)painted++;return data?{color:'#0e3530',weight:1.2,fillColor:choropleth[Math.max(0,b)],fillOpacity:.55}:{color:'#6c7f78',weight:.6,opacity:.7,fillOpacity:0}},
    onEachFeature:(feature,layer)=>{
     const data=byMunicipality.get(`${result.uf}|${feature.properties.slug}`)
     layer.bindTooltip(data?`<span class="marker-tip">${esc(feature.properties.name)}/${result.uf}</span><br>${data.producers} produtor${data.producers===1?'':'es'} · ${fmt(data.volume)} t (${fmtSc(data.volume)})${data.high?` · ${data.high} em prioridade alta`:''}`:`${esc(feature.properties.name)}/${result.uf}`,{sticky:true})
     if(data)layer.on('click',()=>{const select=$('#prf-municipality');const option=[...select.options].find(o=>municipalitySlug(o.value)===feature.properties.slug);if(option){select.value=option.value;renderPresentation()}})
    }
   }).addTo(state.prMuniLayer)
  }
  if(status)status.textContent=results.some(Boolean)?`Limites municipais do IBGE · ${painted} município${painted===1?'':'s'} com produtores. Clique em um município para filtrar.`:(ufs.length?'Não foi possível carregar os limites municipais do IBGE agora; o mapa mostra só os produtores.':'')
 })
}
$('#pr-copy').addEventListener('click',async()=>{
 const {ids,labelsActive}=presentationSubset();const agg=aggregates(ids);const {summary,scored}=agg
 const text=[`VAL Mapa — resumo de ${new Date().toLocaleDateString('pt-BR')}${labelsActive.length?` (filtros: ${labelsActive.join(', ')})`:''}`,'',`Produtores: ${summary.producers} (${summary.mapped} georreferenciados) em ${summary.municipalities} municípios`,`Área total: ${fmt(summary.totalAreaHa)} ha · Potencial: ${fmt(summary.potentialVolumeT)} t (${fmtSc(summary.potentialVolumeT)})`,`Prioridade alta: ${summary.highPriority} · Intenções ativas: ${summary.activeIntents} (${summary.confirmedIntents} confirmadas) · Interações em 30 dias: ${summary.interactions30d}`,'','Potencial por região:',...agg.byRegion.map(r=>`- ${r.region}: ${r.producers} produtores, ${fmt(r.area)} ha, ${fmt(r.volume)} t (${fmtSc(r.volume)})`),'','Potencial por município:',...agg.byMunicipality.slice(0,10).map(m=>`- ${m.municipality} (${m.region}): ${m.producers} produtores, ${fmt(m.volume)} t`),'','Prioridades da semana:',...scored.slice(0,10).map((s,i)=>`${i+1}. ${s.name} (${s.municipality}) — score ${s.score}, ${fmt(s.potentialVolumeT)} t — ${s.nextAction}`)].join('\n')
 try{await navigator.clipboard.writeText(text);toast('Resumo copiado para a área de transferência.')}catch{prompt('Copie o resumo:',text)}
})
function renderPresentation(){
 fillPresentationFilters()
 const {ids,labelsActive}=presentationSubset();const agg=aggregates(ids);const {summary,scored}=agg
 $('#pr-date').textContent=`Posição em ${new Date().toLocaleDateString('pt-BR',{dateStyle:'long'})} · ${summary.producers} produtores · regra mapa-rules-v1`
 $('#pr-filter-summary').textContent=labelsActive.length?`Filtros aplicados: ${labelsActive.join(' · ')}`:'Carteira completa, sem filtros.'
 $('#pr-kpis').innerHTML=kpiCards(summary)
 renderPresentationMap(scored,agg.producers)
 chart('pr-chart-region',{type:'bar',data:{labels:agg.byRegion.map(r=>r.region),datasets:[{label:'Potencial (t)',data:agg.byRegion.map(r=>Math.round(r.volume)),backgroundColor:'#009f78',borderRadius:6},{label:'Produtores',data:agg.byRegion.map(r=>r.producers),backgroundColor:'#2d8cff',borderRadius:6,yAxisID:'y1'}]},options:{scales:{y:{beginAtZero:true},y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false},ticks:{precision:0}}}}})
 const cultures=[...agg.byCulture.entries()].sort((a,b)=>b[1]-a[1])
 chart('pr-chart-culture',{type:'doughnut',data:{labels:cultures.map(([c])=>labels.commodities[c]||c),datasets:[{data:cultures.map(([,v])=>Math.round(v)),backgroundColor:palette,borderWidth:2,borderColor:'#fff'}]},options:{cutout:'58%'}})
 const ufs=[...agg.byUf.entries()].sort((a,b)=>b[1].volume-a[1].volume)
 chart('pr-chart-uf',{type:'bar',data:{labels:ufs.map(([uf])=>uf),datasets:[{label:'Potencial (t)',data:ufs.map(([,v])=>Math.round(v.volume)),backgroundColor:'#14ada7',borderRadius:6}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}})
 chart('pr-chart-priority',{type:'bar',data:{labels:agg.priorities.map(p=>p.label),datasets:[{label:'Produtores',data:agg.priorities.map(p=>p.count),backgroundColor:agg.priorities.map(p=>priorityColor[p.level]),borderRadius:6}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{precision:0}}}}})
 const regionRows=[]
 for(const r of agg.byRegion){regionRows.push(`<tr style="background:#f8fbfa"><td><b>${esc(r.region)}</b></td><td class="hint">todos</td><td class="num"><b>${r.producers}</b></td><td class="num"><b>${fmt(r.area)}</b></td><td class="num"><b>${fmt(r.volume)}</b></td><td class="num"><b>${fmt(Math.round(r.volume/SC_TONNES))}</b></td><td class="num"><b>${r.high}</b></td></tr>`);for(const m of agg.byMunicipality.filter(m=>m.region===r.region))regionRows.push(`<tr><td></td><td>${esc(m.municipality)}</td><td class="num">${m.producers}</td><td class="num">${fmt(m.area)}</td><td class="num">${fmt(m.volume)}</td><td class="num">${fmt(Math.round(m.volume/SC_TONNES))}</td><td class="num">${m.high}</td></tr>`)}
 $('#pr-regions tbody').innerHTML=regionRows.join('')||'<tr><td colspan="7" class="empty">Sem dados para os filtros escolhidos.</td></tr>'
 $('#pr-top tbody').innerHTML=scored.slice(0,10).map((s,i)=>`<tr><td>${i+1}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.municipality)}/${esc(s.uf||'')}</td><td class="num">${fmt(s.potentialVolumeT)}</td><td class="num">${fmt(Math.round((s.potentialVolumeT||0)/SC_TONNES))}</td><td class="num"><span class="score-pill" style="background:${priorityColor[s.priority.level]}">${s.score}</span></td><td class="wrap">${esc(s.nextAction)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Sem dados.</td></tr>'
}

// --- render ----------------------------------------------------------------------------------
function render(){
 if(!state.data)return
 if(state.view==='map'){renderMap();if(state.selected)showDetail(state.selected)}
 if(state.view==='producers')renderProducers()
 if(state.view==='decision')renderDecision()
 if(state.view==='tracking')renderTracking()
 if(state.view==='presentation')renderPresentation()
}
setView(state.view)
init().catch(error=>toast(error.message,true))
