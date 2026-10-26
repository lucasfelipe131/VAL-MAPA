// Motor de decisão do VAL Mapa — mapa-rules-v1.
// Derivado do sog-rules-v1 da VAL Grãos: score 0–100 explicável, com motivos,
// alertas e próxima ação. Nenhuma ação comercial é executada automaticamente.

export const commodityLabels={soja:'Soja',milho:'Milho',trigo:'Trigo',sorgo:'Sorgo',feijao:'Feijão',arroz:'Arroz',cevada:'Cevada',algodao:'Algodão',cafe:'Café',cana:'Cana-de-açúcar',pecuaria:'Pecuária',outros:'Outros'}
export const relationshipLabels={prospect:'Prospecto',contact:'Em contato',active:'Cliente ativo',partner:'Parceiro',inactive:'Inativo'}
export const intentStatusLabels={draft:'Sinal',monitoring:'Monitorando',confirmed:'Confirmada',negotiating:'Negociando',closed:'Fechada',cancelled:'Cancelada'}
export const interactionKinds={visit:'Visita',call:'Ligação',message:'Mensagem',meeting:'Reunião',event:'Evento'}
export const ufs=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

const commodityCodes=new Set(Object.keys(commodityLabels))
const relationshipCodes=new Set(Object.keys(relationshipLabels))
const intentStatuses=new Set(Object.keys(intentStatusLabels))
const interactionCodes=new Set(Object.keys(interactionKinds))
const priceUnits=new Set(['BRL/sc_60kg','BRL/t'])

export const domainError=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode})
const text=(value,max=240)=>String(value??'').normalize('NFKC').trim().slice(0,max)
const number=value=>{
 if(value===null||value===undefined||value==='')return null
 const parsed=Number(String(value).replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'))
 return Number.isFinite(parsed)?parsed:null
}
const isoDate=value=>{
 if(!value)return null
 const parsed=new Date(value)
 return Number.isNaN(parsed.getTime())?null:parsed.toISOString()
}
const dateOnly=value=>{
 if(!value)return null
 const raw=text(value,10)
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw
 const br=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text(value,10))
 return br?`${br[3]}-${br[2]}-${br[1]}`:null
}
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value))
const slug=value=>text(value,240).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const choice=(value,allowed,fallback,message)=>{
 const selected=slug(value).replace(/\s+/g,'_')
 if(!selected&&fallback)return fallback
 if(!allowed.has(selected))throw domainError(message)
 return selected
}
const cultureList=value=>{
 const raw=Array.isArray(value)?value:String(value??'').split(/[;,|/]/)
 const codes=raw.map(item=>slug(item).replace(/\s+/g,'_')).filter(Boolean).map(item=>{
  if(commodityCodes.has(item))return item
  const alias={'soja':'soja','milho':'milho','trigo':'trigo','feijao':'feijao','arroz':'arroz','algodao':'algodao','cafe':'cafe','cana':'cana','cana_de_acucar':'cana','gado':'pecuaria','boi':'pecuaria','pecuaria':'pecuaria','sorgo':'sorgo','cevada':'cevada'}[item]
  return alias||'outros'
 })
 return [...new Set(codes)]
}

export function normalizeProducer(input={}){
 const name=text(input.name,180)
 if(!name)throw domainError('Informe o nome do produtor.')
 const municipality=text(input.municipality,140)
 if(!municipality)throw domainError('Informe o município do produtor.')
 const uf=text(input.uf,2).toUpperCase()
 if(uf&&!ufs.includes(uf))throw domainError('A UF informada é inválida.')
 const lat=number(input.lat);const lng=number(input.lng)
 if((lat===null)!==(lng===null))throw domainError('Informe latitude e longitude juntas ou deixe ambas vazias.')
 if(lat!==null&&(lat<-34.5||lat>6||lng<-74.5||lng>-28))throw domainError('As coordenadas precisam estar dentro do Brasil.')
 const areaHa=number(input.areaHa);if(areaHa!==null&&areaHa<0)throw domainError('A área não pode ser negativa.')
 const storageT=number(input.storageCapacityT);if(storageT!==null&&storageT<0)throw domainError('A armazenagem não pode ser negativa.')
 const volumeT=number(input.estimatedVolumeT);if(volumeT!==null&&volumeT<0)throw domainError('O volume estimado não pode ser negativo.')
 const lastContactAt=input.lastContactAt?isoDate(input.lastContactAt):null
 if(input.lastContactAt&&!lastContactAt)throw domainError('A data do último contato é inválida.')
 return {
  name,municipality,uf,lat,lng,areaHa,
  cultures:cultureList(input.cultures),
  storageCapacityT:storageT,estimatedVolumeT:volumeT,
  relationship:choice(input.relationship,relationshipCodes,'prospect','O status de relacionamento é inválido.'),
  consultant:text(input.consultant,120),phone:text(input.phone,40),
  lastContactAt,notes:text(input.notes,3000),
  externalKey:text(input.externalKey,120)
 }
}

export function normalizeIntent(input={}){
 const producerId=text(input.producerId,120)
 if(!producerId)throw domainError('Selecione o produtor desta intenção.')
 const commodity=choice(input.commodity,commodityCodes,null,'Selecione uma cultura válida.')
 const direction=choice(input.direction,new Set(['sell','buy']),'sell','A direção é inválida.')
 const volumeT=number(input.volumeT)
 if(volumeT===null||volumeT<=0)throw domainError('Informe o volume em toneladas maior que zero.')
 const targetPrice=number(input.targetPrice)
 if(targetPrice!==null&&targetPrice<=0)throw domainError('O preço-alvo precisa ser maior que zero.')
 const priceUnit=text(input.priceUnit)||'BRL/sc_60kg'
 if(!priceUnits.has(priceUnit))throw domainError('A unidade de preço é inválida.')
 const deliveryStart=dateOnly(input.deliveryStart);const deliveryEnd=dateOnly(input.deliveryEnd)
 if(input.deliveryStart&&!deliveryStart)throw domainError('A data inicial da janela é inválida.')
 if(input.deliveryEnd&&!deliveryEnd)throw domainError('A data final da janela é inválida.')
 if(deliveryStart&&deliveryEnd&&deliveryEnd<deliveryStart)throw domainError('A janela termina antes de começar.')
 const confidence=number(input.confidence)??50
 if(confidence<0||confidence>100)throw domainError('A confiança precisa estar entre 0 e 100.')
 const status=choice(input.status,intentStatuses,'draft','O estado da intenção é inválido.')
 if(status==='confirmed'&&confidence<80)throw domainError('Uma intenção confirmada exige confiança mínima de 80%.')
 const observedAt=input.observedAt?isoDate(input.observedAt):new Date().toISOString()
 if(!observedAt)throw domainError('A data da intenção é inválida.')
 return {producerId,commodity,direction,volumeT,targetPrice,priceUnit,deliveryStart,deliveryEnd,deliveryLocation:text(input.deliveryLocation,240),status,confidence:Math.round(confidence),observedAt,notes:text(input.notes,2000)}
}

export function normalizeMarketRef(input={}){
 const commodity=choice(input.commodity,commodityCodes,null,'Selecione uma cultura válida para a cotação.')
 const price=number(input.price)
 if(price===null||price<=0)throw domainError('Informe uma cotação maior que zero.')
 const priceUnit=text(input.priceUnit)||'BRL/sc_60kg'
 if(!priceUnits.has(priceUnit))throw domainError('A unidade da cotação é inválida.')
 const region=text(input.region,240);if(!region)throw domainError('Informe a praça da cotação.')
 const sourceName=text(input.sourceName,240);if(!sourceName)throw domainError('Identifique a fonte da cotação.')
 const observedAt=input.observedAt?isoDate(input.observedAt):new Date().toISOString()
 if(!observedAt)throw domainError('A data da cotação é inválida.')
 if(new Date(observedAt).getTime()>Date.now()+3_600_000)throw domainError('A cotação não pode estar no futuro.')
 return {commodity,price,priceUnit,region,sourceName,observedAt,notes:text(input.notes,1000)}
}

export function normalizeInteraction(input={}){
 const producerId=text(input.producerId,120)
 if(!producerId)throw domainError('Selecione o produtor da interação.')
 const kind=choice(input.kind,interactionCodes,'visit','O tipo de interação é inválido.')
 const occurredAt=input.occurredAt?isoDate(input.occurredAt):new Date().toISOString()
 if(!occurredAt)throw domainError('A data da interação é inválida.')
 const outcome=choice(input.outcome,new Set(['positive','neutral','negative']),'neutral','O resultado é inválido.')
 return {producerId,kind,occurredAt,outcome,notes:text(input.notes,2000)}
}

// --- score ---------------------------------------------------------------

const pricePerTonne=(price,unit)=>unit==='BRL/sc_60kg'?Number(price)/0.06:Number(price)
const freshnessFor=(observedAt,now)=>{
 const hours=Math.max(0,(now.getTime()-new Date(observedAt).getTime())/3_600_000)
 if(hours<=24)return {label:'atual',state:'fresh',score:10}
 if(hours<=72)return {label:'recente',state:'attention',score:7}
 if(hours<=168)return {label:'no limite',state:'limit',score:3}
 return {label:'vencida',state:'expired',score:0}
}
const daysUntil=(value,now)=>value?Math.ceil((new Date(`${value}T23:59:59`).getTime()-now.getTime())/86_400_000):null
const daysSince=(value,now)=>value?Math.max(0,(now.getTime()-new Date(value).getTime())/86_400_000):null
export const priorityFor=score=>score>=75?{level:'high',label:'Prioridade alta'}:score>=55?{level:'medium',label:'Validar'}:score>=35?{level:'watch',label:'Monitorar'}:{level:'incomplete',label:'Completar dados'}
const relationshipReadiness={prospect:4,contact:8,active:14,partner:17,inactive:2}
const statusReadiness={draft:2,monitoring:4,confirmed:8,negotiating:10}
const percentile=(value,values)=>{
 if(value===null||!values.length)return 0
 const below=values.filter(item=>item<value).length
 return below/Math.max(1,values.length-1)
}

export function scoreProducers({producers=[],intents=[],marketRefs=[],interactions=[]}={},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const volumes=producers.map(p=>p.estimatedVolumeT??(p.areaHa!==null&&p.areaHa!==undefined?Number(p.areaHa)*3:null)).filter(v=>v!==null&&Number.isFinite(v))
 const activeRefs=marketRefs.map(ref=>({...ref,_fresh:freshnessFor(ref.observedAt,now)}))
 return producers.map(producer=>{
  const reasons=[];const warnings=[]
  const volume=producer.estimatedVolumeT??(producer.areaHa!==null&&producer.areaHa!==undefined?Number(producer.areaHa)*3:null)
  // Bloco 1 — potencial (0–30)
  let potential=0
  if(volume!==null&&Number.isFinite(volume)){
   potential=Math.round(8+percentile(volume,volumes)*17)
   reasons.push(producer.estimatedVolumeT!=null?`Volume estimado de ${fmt(volume)} t supera ${Math.round(percentile(volume,volumes)*100)}% da carteira`:`Potencial estimado pela área (${fmt(producer.areaHa)} ha)`)
  }else warnings.push('Sem área nem volume estimado; o potencial não pode ser comparado.')
  if(producer.storageCapacityT)potential+=5
  // Bloco 2 — relacionamento e prontidão (0–25)
  let readiness=relationshipReadiness[producer.relationship]||0
  const contactDays=daysSince(producer.lastContactAt,now)
  if(contactDays===null)warnings.push('Sem registro de último contato.')
  else if(contactDays<=30)readiness+=5
  else if(contactDays<=90)readiness+=2
  else warnings.push(`Último contato há ${Math.floor(contactDays)} dias; reconfirme a relação.`)
  const producerIntents=intents.filter(item=>item.producerId===producer.id&&!['closed','cancelled'].includes(item.status))
  const intent=producerIntents.sort((a,b)=>(statusReadiness[b.status]||0)-(statusReadiness[a.status]||0)||new Date(b.observedAt)-new Date(a.observedAt))[0]||null
  if(intent){
   readiness+=statusReadiness[intent.status]||0
   reasons.push(intent.status==='confirmed'||intent.status==='negotiating'?`Intenção de ${intent.direction==='sell'?'venda':'compra'} de ${commodityLabels[intent.commodity]} confirmada (${fmt(intent.volumeT)} t)`:`Sinal de ${intent.direction==='sell'?'venda':'compra'} de ${commodityLabels[intent.commodity]} ainda em acompanhamento`)
  }else reasons.push('Sem intenção registrada; o produtor entra como potencial a prospectar')
  readiness=Math.min(25,readiness)
  // Bloco 3 — mercado e preço (0–30)
  let market=0;let priceGapPercent=null;let marketReference=null
  if(intent){
   const quote=activeRefs.filter(ref=>ref.commodity===intent.commodity).sort((a,b)=>Number(a._fresh.state==='expired')-Number(b._fresh.state==='expired')||new Date(b.observedAt)-new Date(a.observedAt))[0]
   if(quote){
    marketReference={id:quote.id,price:quote.price,priceUnit:quote.priceUnit,region:quote.region,sourceName:quote.sourceName,observedAt:quote.observedAt,freshness:quote._fresh.label}
    market=5+quote._fresh.score
    if(intent.targetPrice){
     const target=pricePerTonne(intent.targetPrice,intent.priceUnit);const ref=pricePerTonne(quote.price,quote.priceUnit)
     priceGapPercent=(intent.direction==='sell'?ref-target:target-ref)/target*100
     market+=quote._fresh.state==='expired'?2:priceGapPercent>=0?15:priceGapPercent>=-2?11:priceGapPercent>=-5?7:2
     reasons.push(priceGapPercent>=0?`Cotação ${quote._fresh.label} em ${quote.region} atingiu o preço-alvo`:`Cotação ${quote._fresh.label} está ${Math.abs(priceGapPercent).toFixed(1).replace('.',',')}% abaixo do preço-alvo`)
    }else{market+=3;warnings.push('Há cotação, mas falta o preço-alvo do produtor.')}
    if(quote._fresh.state==='expired')warnings.push('Cotação vencida; atualize a referência antes de negociar.')
   }else warnings.push(`Sem cotação registrada para ${commodityLabels[intent.commodity]}.`)
  }
  // Bloco 4 — janela (0–15)
  let timing=0;const remaining=intent?daysUntil(intent.deliveryStart||intent.deliveryEnd,now):null
  if(remaining!==null){
   timing=remaining<0?0:remaining<=14?15:remaining<=30?12:remaining<=60?8:remaining<=120?4:2
   reasons.push(remaining<0?'Janela de entrega já venceu':`Janela de entrega em ${remaining} dia${remaining===1?'':'s'}`)
   if(remaining<0)warnings.push('Atualize a janela de entrega antes de negociar.')
  }else if(intent)warnings.push('Intenção sem janela de entrega.')
  if(producer.lat===null||producer.lat===undefined)warnings.push('Produtor sem coordenadas; não aparece no mapa.')
  let score=clamp(Math.round(potential+readiness+market+timing),0,100)
  if(producer.relationship==='inactive')score=Math.min(score,40)
  if(intent&&(intent.status==='draft'||intent.confidence<60))score=Math.min(score,54)
  if(remaining!==null&&remaining<0)score=Math.min(score,54)
  const priority=priorityFor(score)
  const nextAction=!intent
   ?(producer.relationship==='prospect'?'Agendar primeiro contato e levantar culturas, área e intenção de venda.':'Registrar a intenção comercial da safra atual com o produtor.')
   :remaining!==null&&remaining<0?'Atualizar a janela e reconfirmar volume com o produtor.'
   :intent.status==='draft'||intent.confidence<60?'Validar intenção, volume, preço e janela diretamente com o produtor.'
   :!marketReference||marketReference.freshness==='vencida'?'Atualizar a cotação da praça antes de avançar.'
   :priority.level==='high'?'Contatar agora e preparar a condição comercial com base na cotação.'
   :priority.level==='medium'?'Preparar cenários e alinhar a próxima conversa.'
   :'Monitorar preço e janela; revisar com a próxima cotação.'
  const lastInteraction=interactions.filter(item=>item.producerId===producer.id).sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt))[0]||null
  return {
   producerId:producer.id,name:producer.name,municipality:producer.municipality,uf:producer.uf,lat:producer.lat,lng:producer.lng,
   cultures:producer.cultures,relationship:producer.relationship,relationshipLabel:relationshipLabels[producer.relationship],
   potentialVolumeT:volume===null?null:Number(volume.toFixed(1)),areaHa:producer.areaHa,
   score,priority,blocks:{potential:Math.min(30,potential),readiness,market:Math.min(30,market),timing},
   reasons,warnings,nextAction,intent:intent?{id:intent.id,commodity:intent.commodity,commodityLabel:commodityLabels[intent.commodity],direction:intent.direction,volumeT:intent.volumeT,targetPrice:intent.targetPrice,priceUnit:intent.priceUnit,status:intent.status,statusLabel:intentStatusLabels[intent.status],confidence:intent.confidence,deliveryStart:intent.deliveryStart,deliveryEnd:intent.deliveryEnd}:null,
   marketReference,priceGapPercent:priceGapPercent===null?null:Number(priceGapPercent.toFixed(2)),
   lastInteractionAt:lastInteraction?.occurredAt||null,rulesVersion:'mapa-rules-v1',generatedAt:now.toISOString()
  }
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'pt-BR'))
}

export function summarize({producers=[],scored=[],intents=[],interactions=[]}={},now=new Date()){
 const active=intents.filter(item=>!['closed','cancelled'].includes(item.status))
 const thirtyDays=now.getTime()-30*86_400_000
 const totalVolume=scored.reduce((sum,item)=>sum+(item.potentialVolumeT||0),0)
 return {
  producers:producers.length,
  mapped:producers.filter(p=>p.lat!==null&&p.lat!==undefined).length,
  municipalities:new Set(producers.map(p=>`${slug(p.municipality)}|${p.uf}`)).size,
  totalAreaHa:Math.round(producers.reduce((sum,p)=>sum+(Number(p.areaHa)||0),0)),
  potentialVolumeT:Math.round(totalVolume),
  activeIntents:active.length,
  confirmedIntents:active.filter(item=>['confirmed','negotiating'].includes(item.status)).length,
  highPriority:scored.filter(item=>item.priority.level==='high').length,
  interactions30d:interactions.filter(item=>new Date(item.occurredAt).getTime()>=thirtyDays).length
 }
}

export function distanceKm(a,b){
 const rad=v=>v*Math.PI/180
 const dLat=rad(b.lat-a.lat);const dLng=rad(b.lng-a.lng)
 const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2
 return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))
}

function fmt(value){return Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:0})}
