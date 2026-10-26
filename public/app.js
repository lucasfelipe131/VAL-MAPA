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
const filters=()=>({search:$('#f-search').value.trim().toLowerCase(),culture:$('#f-culture').value,uf:$('#f-uf').value,relationship:$('#f-relationship').value,priority:$('#f-priority').value})
function fillFilters(){
 const {catalog,producers}=state.data
 const fill=(select,items,keepFirst=true)=>{const current=select.value;const first=keepFirst?select.options[0].outerHTML:'';select.innerHTML=first+items.map(item=>`<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('');select.value=current}
 fill($('#f-culture'),catalog.commodities.filter(item=>producers.some(p=>p.cultures.includes(item.value))))
 fill($('#f-uf'),[...new Set(producers.map(p=>p.uf).filter(Boolean))].sort().map(uf=>({value:uf,label:uf})))
 fill($('#f-relationship'),catalog.relationships)
 fill($('#d-consultant'),[...new Set(producers.map(p=>p.consultant).filter(Boolean))].sort().map(c=>({value:c,label:c})))
}
function filteredScored(){
 const f=filters();const byId=new Map(state.data.producers.map(p=>[p.id,p]))
 return state.data.scored.filter(item=>{
  const producer=byId.get(item.producerId)||{}
  if(f.culture&&!item.cultures.includes(f.culture))return false
  if(f.uf&&item.uf!==f.uf)return false
  if(f.relationship&&item.relationship!==f.relationship)return false
  if(f.priority&&item.priority.level!==f.priority)return false
  if(f.search&&!`${item.name} ${item.municipality} ${producer.consultant||''}`.toLowerCase().includes(f.search))return false
  return true
 })
}
;['#f-search','#f-culture','#f-uf','#f-relationship','#f-priority','#f-by-municipality'].forEach(id=>$(id).addEventListener('input',renderMap))
$('#f-clear').addEventListener('click',()=>{['#f-search','#f-culture','#f-uf','#f-relationship','#f-priority'].forEach(id=>$(id).value='');$('#f-by-municipality').checked=false;renderMap()})

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
  <div class="meta">${esc(item.municipality)}/${esc(item.uf||'')} · <span class="badge" style="background:${relationshipColor[item.relationship]}22;color:${relationshipColor[item.relationship]}">${esc(item.relationshipLabel)}</span>${producer.consultant?` · ${esc(producer.consultant)}`:''}</div>
  <div class="score-row">${scoreRing(item.score,item.priority.level)}<div><b>${esc(item.priority.label)}</b><div class="meta">${fmt(item.areaHa)} ha · potencial <b>${fmt(item.potentialVolumeT)} t</b> (${fmtSc(item.potentialVolumeT)})${producer.storageCapacityT?` · armazena ${fmt(producer.storageCapacityT)} t (${fmtSc(producer.storageCapacityT)})`:''}</div><div class="cultures">${item.cultures.map(c=>`<span class="chip">${esc(labels.commodities[c]||c)}</span>`).join('')}</div></div></div>
  <div class="blocks"><div>Potencial<b>${item.blocks.potential}/30</b></div><div>Relação<b>${item.blocks.readiness}/25</b></div><div>Mercado<b>${item.blocks.market}/30</b></div><div>Janela<b>${item.blocks.timing}/15</b></div></div>
  <div class="next-action">→ ${esc(item.nextAction)}</div>
  ${item.intent?`<div class="meta">Intenção: <b>${esc(item.intent.direction==='sell'?'venda':'compra')} de ${fmt(item.intent.volumeT)} t de ${esc(item.intent.commodityLabel)}</b> · ${esc(item.intent.statusLabel)} · alvo ${fmtMoney(item.intent.targetPrice,item.intent.priceUnit)}${item.marketReference?` · cotação ${fmtMoney(item.marketReference.price,item.marketReference.priceUnit)} (${esc(item.marketReference.region)}, ${esc(item.marketReference.freshness)})`:''}</div>`:''}
  <ul class="reasons">${item.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>
  ${item.warnings.length?`<ul class="warnings">${item.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}
  <div class="meta">Último contato: <b>${fmtDate(producer.lastContactAt)}</b>${producer.phone?` · ${esc(producer.phone)}`:''}</div>
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
  <td><a href="#" data-detail="${p.id}"><b>${esc(p.name)}</b></a>${p.lat===null||p.lat===undefined?' <span class="badge incomplete" title="Sem coordenadas">sem mapa</span>':''}</td>
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
$('#p-template').addEventListener('click',()=>download('modelo-val-mapa.csv','nome;municipio;uf;latitude;longitude;area_ha;culturas;armazenagem_t;volume_estimado_t;armazenagem_sc;volume_estimado_sc;relacionamento;consultor;telefone;ultimo_contato;observacoes\nFazenda Exemplo;Ijuí;RS;-28.3878;-53.9149;1200;soja, milho;3000;3900;;;ativo;Ana;(55) 99999-0000;2026-10-20;Produtor com armazenagem própria\nSítio Exemplo em sacas;Cruz Alta;RS;;;320;soja;;;8000;16000;em contato;Ana;;;Valores informados em sacas de 60 kg\n','text/csv'))
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
function closeModal(){$('#modal').hidden=true}
$('#modal').addEventListener('click',event=>{if(event.target.id==='modal')closeModal()})
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal()})
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
   <label class="field"><span>Latitude</span><input name="lat" inputmode="decimal" value="${producer.lat??''}"></label>
   <label class="field"><span>Longitude</span><input name="lng" inputmode="decimal" value="${producer.lng??''}"></label>
   <div class="field"><span>&nbsp;</span><button type="button" class="btn" id="geocode-btn">Localizar pelo município</button></div>
  </div>
  <div class="grid-3">
   <label class="field"><span>Área (ha)</span><input name="areaHa" inputmode="decimal" value="${producer.areaHa??''}"></label>
   <label class="field"><span>Armazenagem (<span data-unit-label>t</span>)</span><input name="storageCapacityT" inputmode="decimal" value="${inUnit(producer.storageCapacityT,unit)}"></label>
   <label class="field"><span>Volume estimado (<span data-unit-label>t</span>)</span><input name="estimatedVolumeT" inputmode="decimal" value="${inUnit(producer.estimatedVolumeT,unit)}" placeholder="vazio = área × 3 t"></label>
  </div>
  <div class="grid-3">
   <label class="field"><span>Unidade de volume</span><select name="volumeUnit"><option value="t" ${unit==='t'?'selected':''}>Toneladas (t)</option><option value="sc" ${unit==='sc'?'selected':''}>Sacas de 60 kg (sc)</option></select></label>
   <p class="hint" style="grid-column:span 2;align-self:end;margin:0">1 saca = 60 kg. O score usa toneladas; os valores em sacas são convertidos automaticamente (1.000 sc = 60 t).</p>
  </div>
  <div class="field"><span>Culturas</span><div class="cultures" style="gap:8px">${catalog.commodities.map(c=>`<label class="toggle"><input type="checkbox" name="cultures" value="${c.value}" ${(producer.cultures||[]).includes(c.value)?'checked':''}><span>${esc(c.label)}</span></label>`).join('')}</div></div>
  <div class="grid-3">
   <label class="field"><span>Relacionamento</span><select name="relationship">${options(catalog.relationships,producer.relationship||'prospect')}</select></label>
   <label class="field"><span>Consultor</span><input name="consultant" value="${esc(producer.consultant||'')}"></label>
   <label class="field"><span>Telefone</span><input name="phone" value="${esc(producer.phone||'')}"></label>
  </div>
  <label class="field"><span>Último contato</span><input name="lastContactAt" type="date" value="${producer.lastContactAt?producer.lastContactAt.slice(0,10):''}"></label>
  <label class="field"><span>Observações</span><textarea name="notes">${esc(producer.notes||'')}</textarea></label>
  <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button class="btn primary">${editing?'Salvar':'Cadastrar'}</button></div>
 </form>`)
 const form=$('#producer-form',body)
 $('[data-cancel]',form).onclick=closeModal
 form.volumeUnit.onchange=()=>{
  // Converte os valores já digitados para a nova unidade, para o usuário não precisar refazer a conta.
  const to=form.volumeUnit.value
  for(const name of ['storageCapacityT','estimatedVolumeT']){const raw=Number(String(form[name].value).replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));if(form[name].value&&Number.isFinite(raw))form[name].value=to==='sc'?String(Math.round(raw/SC_TONNES)):String(Number((raw*SC_TONNES).toFixed(2)))}
  $$('[data-unit-label]',form).forEach(el=>el.textContent=to)
  form.estimatedVolumeT.placeholder=to==='sc'?'vazio = área × 50 sc':'vazio = área × 3 t'
 }
 $$('[data-unit-label]',form).forEach(el=>el.textContent=unit);form.estimatedVolumeT.placeholder=unit==='sc'?'vazio = área × 50 sc':'vazio = área × 3 t'
 $('#geocode-btn',form).onclick=async()=>{
  const municipality=form.municipality.value.trim();if(!municipality)return toast('Informe o município primeiro.',true)
  const button=$('#geocode-btn',form);button.disabled=true;button.textContent='Localizando…'
  try{const {result}=await api(`/api/geocode?municipality=${encodeURIComponent(municipality)}&uf=${encodeURIComponent(form.uf.value)}`);if(!result)toast('Município não encontrado.',true);else{form.lat.value=result.lat.toFixed(5);form.lng.value=result.lng.toFixed(5);toast(`Localizado: ${result.label.split(',').slice(0,2).join(',')}`)}}
  catch(error){toast(error.message,true)}finally{button.disabled=false;button.textContent='Localizar pelo município'}
 }
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

// --- importação CSV ---------------------------------------------------------------
function parseCsv(text){
 const delimiter=(text.match(/;/g)||[]).length>=(text.match(/,/g)||[]).length?';':','
 const rows=[];let row=[];let cell='';let quoted=false
 for(let i=0;i<text.length;i++){
  const ch=text[i]
  if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}
  else if(ch==='"')quoted=true
  else if(ch===delimiter){row.push(cell);cell=''}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}
  else cell+=ch
 }
 if(cell||row.length){row.push(cell);rows.push(row)}
 return rows.filter(r=>r.some(c=>c.trim()))
}
const headerMap={nome:'name',name:'name',produtor:'name',municipio:'municipality',município:'municipality',cidade:'municipality',uf:'uf',estado:'uf',latitude:'lat',lat:'lat',longitude:'lng',lng:'lng',lon:'lng',area_ha:'areaHa',area:'areaHa','área':'areaHa','área (ha)':'areaHa',culturas:'cultures',cultura:'cultures',armazenagem_t:'storageCapacityT',armazenagem:'storageCapacityT',armazenagem_sc:'storageCapacitySc',armazenagem_sacas:'storageCapacitySc',volume_estimado_t:'estimatedVolumeT',volume:'estimatedVolumeT',volume_estimado_sc:'estimatedVolumeSc',volume_sacas:'estimatedVolumeSc',sacas:'estimatedVolumeSc',unidade:'volumeUnit',unidade_volume:'volumeUnit',potencial:'estimatedVolumeT',relacionamento:'relationship',status:'relationship',consultor:'consultant',telefone:'phone',ultimo_contato:'lastContactAt','último contato':'lastContactAt',observacoes:'notes','observações':'notes',id:'externalKey',codigo:'externalKey','código':'externalKey'}
const relationshipAlias={prospecto:'prospect',prospect:'prospect','em contato':'contact',contato:'contact',ativo:'active','cliente ativo':'active',cliente:'active',parceiro:'partner',partner:'partner',inativo:'inactive',inactive:'inactive'}
function csvToRows(text){
 const [header,...lines]=parseCsv(text.replace(/^﻿/,''))
 const keys=header.map(h=>headerMap[h.trim().toLowerCase()]||null)
 return lines.map(line=>{const row={};keys.forEach((key,index)=>{if(key&&line[index]!==undefined)row[key]=line[index].trim()});if(row.relationship)row.relationship=relationshipAlias[row.relationship.toLowerCase()]||row.relationship;return row})
}
function openImport(){
 const body=openModal(`<h2>Importar produtores (CSV)</h2>
  <p class="hint">Colunas reconhecidas: nome, município, uf, latitude, longitude, area_ha, culturas, armazenagem_t, volume_estimado_t (ou armazenagem_sc e volume_estimado_sc em sacas de 60 kg), relacionamento, consultor, telefone, ultimo_contato, observações. Produtores com mesmo nome e município são atualizados.</p>
  <form id="import-form">
   <label class="field"><span>Arquivo CSV</span><input type="file" name="file" accept=".csv,text/csv"></label>
   <label class="field"><span>ou cole o conteúdo</span><textarea name="text" placeholder="nome;municipio;uf;..."></textarea></label>
   <div id="import-preview" class="import-preview"></div>
   <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Cancelar</button><button class="btn primary">Importar</button></div>
  </form>`)
 const form=$('#import-form',body);$('[data-cancel]',form).onclick=closeModal
 let rows=[]
 const preview=()=>{$('#import-preview',form).innerHTML=rows.length?`<b>${rows.length} linha(s)</b> · primeira: ${esc(JSON.stringify(rows[0]))}`:''}
 form.file.onchange=async()=>{const file=form.file.files[0];if(file){rows=csvToRows(await file.text());preview()}}
 form.text.oninput=()=>{rows=csvToRows(form.text.value);preview()}
 form.onsubmit=event=>{
  event.preventDefault();if(!rows.length)return toast('Nenhuma linha para importar.',true)
  run(async()=>{const result=await api('/api/producers/import',{method:'POST',body:{rows}});toast(`${result.inserted} novo(s), ${result.updated} atualizado(s), ${result.rejected.length} rejeitado(s).`);if(result.rejected.length)console.table(result.rejected);if(result.rejected.length)alert(`Linhas rejeitadas:\n${result.rejected.slice(0,15).map(r=>`${r.line}: ${r.name||'(sem nome)'} — ${r.error}`).join('\n')}`)}).then(()=>{closeModal();renderMap.fitted=false})
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
function aggregates(){
 const {producers,scored,intents,interactions}=state.data
 const byId=new Map(scored.map(item=>[item.producerId,item]))
 const byUf=new Map();const byCulture=new Map();const byMunicipality=new Map()
 for(const p of producers){
  const s=byId.get(p.id)||{};const volume=s.potentialVolumeT||0
  const uf=p.uf||'—';const u=byUf.get(uf)||{producers:0,volume:0};u.producers++;u.volume+=volume;byUf.set(uf,u)
  const share=volume/Math.max(1,p.cultures.length)
  for(const c of p.cultures)byCulture.set(c,(byCulture.get(c)||0)+share)
  const key=`${p.municipality}${p.uf?`/${p.uf}`:''}`;const m=byMunicipality.get(key)||{municipality:key,producers:0,area:0,volume:0,high:0};m.producers++;m.area+=Number(p.areaHa)||0;m.volume+=volume;m.high+=s.priority?.level==='high'?1:0;byMunicipality.set(key,m)
 }
 const priorities=['high','medium','watch','incomplete'].map(level=>({level,label:{high:'Prioridade alta',medium:'Validar',watch:'Monitorar',incomplete:'Completar dados'}[level],count:scored.filter(s=>s.priority.level===level).length,volume:scored.filter(s=>s.priority.level===level).reduce((sum,s)=>sum+(s.potentialVolumeT||0),0)}))
 const relationships=state.data.catalog.relationships.map(r=>({...r,count:producers.filter(p=>p.relationship===r.value).length}))
 const intentStates=state.data.catalog.intentStatuses.map(s=>({...s,count:intents.filter(i=>i.status===s.value).length,volume:intents.filter(i=>i.status===s.value).reduce((sum,i)=>sum+Number(i.volumeT||0),0)}))
 return {byUf,byCulture,byMunicipality:[...byMunicipality.values()].sort((a,b)=>b.volume-a.volume),priorities,relationships,intentStates,interactions}
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
$('#pr-copy').addEventListener('click',async()=>{
 const {summary,scored}=state.data;const agg=aggregates()
 const text=[`VAL Mapa — resumo de ${new Date().toLocaleDateString('pt-BR')}`,'',`Produtores: ${summary.producers} (${summary.mapped} georreferenciados) em ${summary.municipalities} municípios`,`Área total: ${fmt(summary.totalAreaHa)} ha · Potencial: ${fmt(summary.potentialVolumeT)} t`,`Prioridade alta: ${summary.highPriority} · Intenções ativas: ${summary.activeIntents} (${summary.confirmedIntents} confirmadas) · Interações em 30 dias: ${summary.interactions30d}`,'','Onde está o potencial:',...agg.byMunicipality.slice(0,8).map(m=>`- ${m.municipality}: ${m.producers} produtores, ${fmt(m.volume)} t`),'','Prioridades da semana:',...scored.slice(0,10).map((s,i)=>`${i+1}. ${s.name} (${s.municipality}) — score ${s.score}, ${fmt(s.potentialVolumeT)} t — ${s.nextAction}`)].join('\n')
 try{await navigator.clipboard.writeText(text);toast('Resumo copiado para a área de transferência.')}catch{prompt('Copie o resumo:',text)}
})
function renderPresentation(){
 const {summary,scored}=state.data;const agg=aggregates()
 $('#pr-date').textContent=`Posição em ${new Date().toLocaleDateString('pt-BR',{dateStyle:'long'})} · ${summary.producers} produtores · regra mapa-rules-v1`
 $('#pr-kpis').innerHTML=kpiCards(summary)
 const ufs=[...agg.byUf.entries()].sort((a,b)=>b[1].volume-a[1].volume)
 chart('pr-chart-uf',{type:'bar',data:{labels:ufs.map(([uf])=>uf),datasets:[{label:'Potencial (t)',data:ufs.map(([,v])=>Math.round(v.volume)),backgroundColor:'#009f78',borderRadius:6}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}},animation:false})
 const cultures=[...agg.byCulture.entries()].sort((a,b)=>b[1]-a[1])
 chart('pr-chart-culture',{type:'doughnut',data:{labels:cultures.map(([c])=>labels.commodities[c]||c),datasets:[{data:cultures.map(([,v])=>Math.round(v)),backgroundColor:palette,borderWidth:2,borderColor:'#fff'}]},options:{cutout:'58%'}})
 $('#pr-municipalities tbody').innerHTML=agg.byMunicipality.slice(0,12).map(m=>`<tr><td>${esc(m.municipality)}</td><td class="num">${m.producers}</td><td class="num">${fmt(m.area)}</td><td class="num">${fmt(m.volume)}</td><td class="num">${m.high}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Sem dados.</td></tr>'
 $('#pr-top tbody').innerHTML=scored.slice(0,10).map((s,i)=>`<tr><td>${i+1}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.municipality)}/${esc(s.uf||'')}</td><td class="num">${fmt(s.potentialVolumeT)}</td><td class="num"><span class="score-pill" style="background:${priorityColor[s.priority.level]}">${s.score}</span></td><td class="wrap">${esc(s.nextAction)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">Sem dados.</td></tr>'
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
