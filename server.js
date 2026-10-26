import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto'
import {createStore} from './server/store.js'
import {geocodeMunicipality} from './server/geocode.js'
import {parseImportFile} from './server/import.js'
import {municipalityMesh} from './server/malhas.js'
import {normalizeProducer,normalizeIntent,normalizeMarketRef,normalizeInteraction,scoreProducers,summarize,distanceKm,domainError,tonnesToSacas,commodityLabels,relationshipLabels,intentStatusLabels,interactionKinds,ufs} from './server/rules.js'

const root=path.dirname(new URL(import.meta.url).pathname)
const port=Number(process.env.PORT||8080)
const accessPassword=String(process.env.MAPA_ACCESS_PASSWORD||'')
const sessionSecret=String(process.env.MAPA_SESSION_SECRET||'')||(accessPassword?createHmac('sha256','val-mapa').update(accessPassword).digest('hex'):'')
const sessionTtl=Number(process.env.MAPA_SESSION_TTL_SECONDS||43_200)
const store=createStore({databaseUrl:process.env.DATABASE_URL||'',dataDir:path.join(root,'.data')})
await store.migrate()

const catalog={
 commodities:Object.entries(commodityLabels).map(([value,label])=>({value,label})),
 relationships:Object.entries(relationshipLabels).map(([value,label])=>({value,label})),
 intentStatuses:Object.entries(intentStatusLabels).map(([value,label])=>({value,label})),
 interactionKinds:Object.entries(interactionKinds).map(([value,label])=>({value,label})),
 priceUnits:[{value:'BRL/sc_60kg',label:'R$/sc 60 kg'},{value:'BRL/t',label:'R$/t'}],
 ufs
}

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json','.csv':'text/csv; charset=utf-8'}
const json=(response,status,body,headers={})=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});response.end(JSON.stringify(body))}
const readBody=request=>new Promise((resolve,reject)=>{
 let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>6_000_000){reject(domainError('Corpo da requisição muito grande.',413));request.destroy()}})
 request.on('end',()=>{if(!raw)return resolve({});try{resolve(JSON.parse(raw))}catch{reject(domainError('JSON inválido.'))}})
 request.on('error',reject)
})

// --- sessão -----------------------------------------------------------------
const sign=value=>createHmac('sha256',sessionSecret).update(value).digest('base64url')
const issueSession=()=>{const payload=`${Date.now()+sessionTtl*1000}.${randomBytes(12).toString('base64url')}`;return `${payload}.${sign(payload)}`}
const validSession=token=>{
 if(!token)return false
 const parts=token.split('.');if(parts.length!==3)return false
 const payload=`${parts[0]}.${parts[1]}`;const expected=sign(payload);const given=parts[2]
 if(expected.length!==given.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(given)))return false
 return Number(parts[0])>Date.now()
}
const cookies=request=>Object.fromEntries(String(request.headers.cookie||'').split(';').map(part=>part.trim().split('=')).filter(([k])=>k).map(([k,...v])=>[k,decodeURIComponent(v.join('='))]))
const authenticated=request=>!accessPassword||validSession(cookies(request).mapa_session)
const loginAttempts=new Map()

// --- dados --------------------------------------------------------------------
async function bootstrap(){
 const [producers,intents,marketRefs,interactions]=await Promise.all(['producers','intents','market_refs','interactions'].map(name=>store.all(name)))
 const scored=scoreProducers({producers,intents,marketRefs,interactions})
 return {producers,intents,marketRefs,interactions,scored,summary:summarize({producers,scored,intents,interactions}),catalog,storage:store.mode,generatedAt:new Date().toISOString()}
}

const csvCell=value=>{const raw=value===null||value===undefined?'':String(value);return /[";\n]/.test(raw)?`"${raw.replace(/"/g,'""')}"`:raw}
async function exportCsv(){
 const {producers,scored}=await bootstrap()
 const byId=new Map(scored.map(item=>[item.producerId,item]))
 const header=['nome','municipio','uf','latitude','longitude','area_ha','culturas','armazenagem_t','volume_estimado_t','armazenagem_sc','volume_estimado_sc','unidade_informada','relacionamento','consultor','telefone','ultimo_contato','score','prioridade','proxima_acao']
 const lines=producers.map(p=>{const s=byId.get(p.id)||{};return [p.name,p.municipality,p.uf,p.lat,p.lng,p.areaHa,p.cultures.map(c=>commodityLabels[c]||c).join(' | '),p.storageCapacityT,p.estimatedVolumeT,tonnesToSacas(p.storageCapacityT),tonnesToSacas(p.estimatedVolumeT),p.volumeUnit==='sc'?'sacas':'toneladas',relationshipLabels[p.relationship]||p.relationship,p.consultant,p.phone,p.lastContactAt?p.lastContactAt.slice(0,10):'',s.score,s.priority?.label,s.nextAction].map(csvCell).join(';')})
 return `﻿${header.join(';')}\n${lines.join('\n')}\n`
}

async function importProducers(rows,{insertOnly=false}={}){
 if(!Array.isArray(rows))throw domainError('Envie uma lista de produtores.')
 if(rows.length>5000)throw domainError('Importe no máximo 5.000 linhas por vez.')
 const existing=await store.all('producers')
 const keyOf=p=>`${String(p.name).toLowerCase().trim()}|${String(p.municipality).toLowerCase().trim()}`
 const byKey=new Map(existing.map(p=>[keyOf(p),p]))
 const byExternal=new Map(existing.filter(p=>p.externalKey).map(p=>[p.externalKey,p]))
 const result={inserted:0,updated:0,skipped:0,rejected:[]}
 for(const [index,raw] of rows.entries()){
  try{
   const data=normalizeProducer(raw)
   const current=(data.externalKey&&byExternal.get(data.externalKey))||byKey.get(keyOf(data))
   if(current&&insertOnly){result.skipped++;continue}
   if(current){
    // Atualização preserva o que já existia quando a planilha não traz o campo.
    const merged={...current}
    for(const [key,value] of Object.entries(data)){const empty=value===null||value===undefined||value===''||(Array.isArray(value)&&!value.length);if(!empty||merged[key]===undefined||merged[key]===null||merged[key]==='')merged[key]=value}
    if(data.lat===null){merged.lat=current.lat;merged.lng=current.lng;merged.locationPrecision=current.locationPrecision}
    if(!raw.volumeUnit&&raw.storageCapacitySc==null&&raw.estimatedVolumeSc==null)merged.volumeUnit=current.volumeUnit||data.volumeUnit
    await store.update('producers',current.id,merged);result.updated++
   }
   else{const created=await store.insert('producers',data);byKey.set(keyOf(created),created);if(created.externalKey)byExternal.set(created.externalKey,created);result.inserted++}
  }catch(error){result.rejected.push({line:index+1,name:raw?.name||'',error:error.message})}
 }
 return result
}

async function seedExample(){
 const sample=JSON.parse(fs.readFileSync(path.join(root,'data','exemplo.json'),'utf8'))
 const ids=new Map()
 for(const producer of sample.producers){const created=await store.insert('producers',normalizeProducer(producer));ids.set(producer.key,created.id)}
 const day=86_400_000;const now=Date.now()
 const shift=(days)=>new Date(now+days*day).toISOString()
 const dateShift=days=>shift(days).slice(0,10)
 for(const intent of sample.intents)await store.insert('intents',normalizeIntent({...intent,producerId:ids.get(intent.producer),deliveryStart:dateShift(intent.deliveryInDays),deliveryEnd:dateShift(intent.deliveryInDays+20),observedAt:shift(-intent.observedDaysAgo)}))
 for(const ref of sample.marketRefs)await store.insert('market_refs',normalizeMarketRef({...ref,observedAt:shift(-ref.observedDaysAgo)}))
 for(const interaction of sample.interactions)await store.insert('interactions',normalizeInteraction({...interaction,producerId:ids.get(interaction.producer),occurredAt:shift(-interaction.daysAgo)}))
 return {producers:sample.producers.length}
}

// --- importação automática (data/import/*.json) ---------------------------------
// Cada arquivo traz {batch, defaults, rows}. O lote só entra uma vez: se já houver
// produtor com a chave externa do lote, nada é refeito. Coordenadas aproximadas
// por município recebem um pequeno deslocamento determinístico para não se sobrepor.
const jitter=(seed,amplitude)=>{let h=2166136261;for(const ch of seed){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return ((h>>>0)/4294967295-0.5)*2*amplitude}
async function autoImport(){
 const dir=path.join(root,'data','import')
 if(!fs.existsSync(dir))return
 const existing=await store.all('producers')
 for(const file of fs.readdirSync(dir).filter(name=>name.endsWith('.json')).sort()){
  try{
   const batch=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'))
   const prefix=`${batch.batch||file.replace(/\.json$/,'')}:`
   if(existing.some(p=>String(p.externalKey||'').startsWith(prefix)))continue
   const rows=(batch.rows||[]).map(row=>{
    const merged={...(batch.defaults||{}),...row}
    const key=`${prefix}${String(merged.externalKey||merged.name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`
    if(batch.approximateLocation&&merged.lat!==undefined&&merged.lng!==undefined&&row.lat===undefined){merged.lat=Number(merged.lat)+jitter(key,0.035);merged.lng=Number(merged.lng)+jitter(`${key}|lng`,0.045);merged.locationPrecision='municipality'}
    return {...merged,externalKey:key}
   })
   // Somente insere: o lote nunca sobrescreve ajustes feitos pela equipe (pin exato, área, notas).
   const result=await importProducers(rows,{insertOnly:true})
   console.log(`Importação automática ${file}: ${result.inserted} novo(s), ${result.skipped} já existente(s), ${result.rejected.length} rejeitado(s)`)
   if(result.rejected.length)console.warn(result.rejected.slice(0,10))
  }catch(error){console.error(`Falha na importação automática de ${file}:`,error.message)}
 }
}
await autoImport()

// --- rotas --------------------------------------------------------------------
async function api(request,response,url){
 const method=request.method;const segments=url.pathname.split('/').filter(Boolean)
 const resource=segments[1];const id=segments[2]
 if(resource==='session'){
  if(method==='GET')return json(response,200,{protected:Boolean(accessPassword),authenticated:authenticated(request)})
  if(method==='POST'){
   if(!accessPassword)return json(response,200,{authenticated:true})
   const ip=request.socket.remoteAddress||'?';const attempts=loginAttempts.get(ip)||{count:0,until:0}
   if(attempts.until>Date.now())throw domainError('Muitas tentativas. Aguarde alguns minutos.',429)
   const body=await readBody(request);const given=Buffer.from(String(body.password||''));const expected=Buffer.from(accessPassword)
   if(given.length!==expected.length||!timingSafeEqual(given,expected)){
    attempts.count++;if(attempts.count>=8){attempts.until=Date.now()+10*60_000;attempts.count=0}
    loginAttempts.set(ip,attempts);throw domainError('Senha incorreta.',401)
   }
   loginAttempts.delete(ip)
   return json(response,200,{authenticated:true},{'Set-Cookie':`mapa_session=${issueSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionTtl}${request.headers['x-forwarded-proto']==='https'?'; Secure':''}`})
  }
  if(method==='DELETE')return json(response,200,{authenticated:!accessPassword},{'Set-Cookie':'mapa_session=; Path=/; HttpOnly; Max-Age=0'})
 }
 if(!authenticated(request))throw domainError('Acesso não autorizado.',401)

 if(resource==='bootstrap'&&method==='GET')return json(response,200,await bootstrap())
 if(resource==='export.csv'&&method==='GET'){response.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="val-mapa-produtores-${new Date().toISOString().slice(0,10)}.csv"`});return response.end(await exportCsv())}
 if(resource==='geocode'&&method==='GET'){
  const municipality=String(url.searchParams.get('municipality')||'').trim();const uf=String(url.searchParams.get('uf')||'').trim().toUpperCase()
  if(!municipality)throw domainError('Informe o município.')
  return json(response,200,{result:await geocodeMunicipality(municipality,uf)})
 }
 if(resource==='malhas'&&method==='GET'){
  try{
   const data=await municipalityMesh(id,{dataDir:path.join(root,'.data')})
   return json(response,200,data,{'Cache-Control':'private, max-age=86400'})
  }catch(error){console.error(`Malha municipal ${id}:`,error.message);throw error.statusCode?error:domainError(`Falha ao obter a malha do IBGE: ${error.message}`,502)}
 }
 if(resource==='nearby'&&method==='GET'){
  const lat=Number(url.searchParams.get('lat'));const lng=Number(url.searchParams.get('lng'));const radius=Math.min(1000,Math.max(1,Number(url.searchParams.get('radiusKm')||50)))
  if(!Number.isFinite(lat)||!Number.isFinite(lng))throw domainError('Informe o centro da busca.')
  const {scored}=await bootstrap()
  const items=scored.filter(item=>item.lat!==null&&item.lat!==undefined).map(item=>({...item,distanceKm:Number(distanceKm({lat,lng},item).toFixed(1))})).filter(item=>item.distanceKm<=radius).sort((a,b)=>b.score-a.score||a.distanceKm-b.distanceKm)
  return json(response,200,{center:{lat,lng},radiusKm:radius,count:items.length,potentialVolumeT:Math.round(items.reduce((sum,item)=>sum+(item.potentialVolumeT||0),0)),items})
 }
 if(resource==='producers'){
  if(method==='POST'&&id==='import')return json(response,200,await importProducers((await readBody(request)).rows))
  if(method==='POST'&&(id==='import-file'||id==='preview-file')){
   const body=await readBody(request)
   if(!body.contentBase64)throw domainError('Envie o arquivo em base64.')
   const buffer=Buffer.from(String(body.contentBase64),'base64')
   if(buffer.length>8_000_000)throw domainError('Arquivo acima de 8 MB.')
   const parsed=parseImportFile({filename:body.filename||'',buffer,defaults:body.defaults||{},externalKeyPrefix:body.batch?String(body.batch).slice(0,60):''})
   if(id==='preview-file')return json(response,200,{sheet:parsed.sheet,headerLine:parsed.headerLine,fields:parsed.fields,count:parsed.producers.length,skipped:parsed.skipped,sample:parsed.producers.slice(0,5)})
   const result=await importProducers(parsed.producers)
   return json(response,200,{...result,sheet:parsed.sheet,headerLine:parsed.headerLine,fields:parsed.fields,skipped:parsed.skipped})
  }
  if(method==='POST')return json(response,201,await store.insert('producers',normalizeProducer(await readBody(request))))
  if(method==='PUT'&&id){
   const current=await store.get('producers',id);if(!current)throw domainError('Produtor não encontrado.',404)
   const data=normalizeProducer(await readBody(request))
   // A edição pela tela não envia a chave externa do lote importado; ela precisa sobreviver.
   return json(response,200,await store.update('producers',id,{...data,externalKey:data.externalKey||current.externalKey||''}))
  }
  if(method==='DELETE'&&id){
   if(!await store.remove('producers',id))throw domainError('Produtor não encontrado.',404)
   await store.removeWhere('intents','producerId',id);await store.removeWhere('interactions','producerId',id)
   return json(response,200,{removed:true})
  }
 }
 if(resource==='intents'){
  if(method==='POST'){const data=normalizeIntent(await readBody(request));if(!await store.get('producers',data.producerId))throw domainError('Produtor não encontrado.',404);return json(response,201,await store.insert('intents',data))}
  if(method==='PATCH'&&id){
   const current=await store.get('intents',id);if(!current)throw domainError('Intenção não encontrada.',404)
   const body=await readBody(request);const status=String(body.status||'')
   if(!intentStatusLabels[status])throw domainError('Estado inválido.')
   const allowed={draft:['monitoring','confirmed','cancelled'],monitoring:['confirmed','cancelled'],confirmed:['negotiating','cancelled'],negotiating:['closed','cancelled'],closed:[],cancelled:[]}
   if(!allowed[current.status].includes(status))throw domainError(`Não é possível mudar de "${intentStatusLabels[current.status]}" para "${intentStatusLabels[status]}".`)
   const confidence=status==='confirmed'?Math.max(80,Number(current.confidence)):Number(current.confidence)
   return json(response,200,await store.update('intents',id,{...current,status,confidence,observedAt:new Date().toISOString()}))
  }
  if(method==='DELETE'&&id){if(!await store.remove('intents',id))throw domainError('Intenção não encontrada.',404);return json(response,200,{removed:true})}
 }
 if(resource==='market'){
  if(method==='POST')return json(response,201,await store.insert('market_refs',normalizeMarketRef(await readBody(request))))
  if(method==='DELETE'&&id){if(!await store.remove('market_refs',id))throw domainError('Cotação não encontrada.',404);return json(response,200,{removed:true})}
 }
 if(resource==='interactions'){
  if(method==='POST'){
   const data=normalizeInteraction(await readBody(request));const producer=await store.get('producers',data.producerId)
   if(!producer)throw domainError('Produtor não encontrado.',404)
   const created=await store.insert('interactions',data)
   if(!producer.lastContactAt||new Date(producer.lastContactAt)<new Date(data.occurredAt))await store.update('producers',producer.id,{...producer,lastContactAt:data.occurredAt})
   return json(response,201,created)
  }
  if(method==='DELETE'&&id){if(!await store.remove('interactions',id))throw domainError('Interação não encontrada.',404);return json(response,200,{removed:true})}
 }
 if(resource==='example'&&method==='POST')return json(response,200,await seedExample())
 if(resource==='reset'&&method==='POST'){const body=await readBody(request);if(body.confirm!=='APAGAR TUDO')throw domainError('Confirmação inválida.');await store.clear();return json(response,200,{cleared:true})}
 throw domainError('Rota não encontrada.',404)
}

// Versão dos ativos: hash do CSS e do JS. O index.html referencia /styles.css?v=HASH e /app.js?v=HASH,
// então cada publicação força o navegador a buscar os arquivos novos; o restante revalida por ETag.
const assetVersion=createHmac('sha256','val-mapa-assets').update(['styles.css','app.js'].map(name=>fs.readFileSync(path.join(root,'public',name))).reduce((acc,buf)=>Buffer.concat([acc,buf]),Buffer.alloc(0))).digest('hex').slice(0,10)
const indexHtml=()=>fs.readFileSync(path.join(root,'public','index.html'),'utf8').replace('href="/styles.css"',`href="/styles.css?v=${assetVersion}"`).replace('src="/app.js"',`src="/app.js?v=${assetVersion}"`)
function serveStatic(request,response,url){
 const requested=url.pathname==='/'?'/index.html':url.pathname
 const file=path.normalize(path.join(root,'public',requested))
 if(requested==='/index.html'||!file.startsWith(path.join(root,'public'))||!fs.existsSync(file)||fs.statSync(file).isDirectory()){
  response.writeHead(200,{'Content-Type':mime['.html'],'Cache-Control':'no-cache, must-revalidate'});return response.end(indexHtml())
 }
 const stat=fs.statSync(file);const etag=`W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
 if(request.headers['if-none-match']===etag){response.writeHead(304,{ETag:etag});return response.end()}
 const versioned=url.searchParams.get('v')===assetVersion
 const longLived=versioned||requested.startsWith('/vendor/')||requested.startsWith('/brand/')
 response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':longLived?'public, max-age=604800':'no-cache, must-revalidate',ETag:etag})
 fs.createReadStream(file).pipe(response)
}

http.createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost')
 try{
  if(url.pathname==='/live')return json(response,200,{status:'ok',service:'val-mapa'})
  if(url.pathname==='/health')return json(response,200,{status:'ok',service:'val-mapa',storage:await store.health(),protected:Boolean(accessPassword)})
  if(url.pathname.startsWith('/api/'))return await api(request,response,url)
  if(request.method!=='GET')return json(response,405,{error:'Método não permitido.'})
  return serveStatic(request,response,url)
 }catch(error){
  const status=error.statusCode||500
  if(status>=500)console.error(error)
  return json(response,status,{error:status>=500?'Erro interno no servidor.':error.message})
 }
}).listen(port,'0.0.0.0',()=>console.log(`VAL Mapa disponível na porta ${port} (armazenamento: ${store.mode}${accessPassword?', acesso protegido':', acesso aberto'})`))
