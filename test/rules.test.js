import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeProducer,normalizeIntent,normalizeMarketRef,scoreProducers,summarize,distanceKm,priorityFor} from '../server/rules.js'

const now=new Date('2026-10-26T12:00:00Z')
const day=86_400_000
const iso=days=>new Date(now.getTime()+days*day).toISOString()
const dateOnly=days=>iso(days).slice(0,10)

test('normalizeProducer aceita números em formato brasileiro e culturas por texto',()=>{
 const producer=normalizeProducer({name:'  Fazenda Teste ',municipality:'Ijuí',uf:'rs',lat:'-28,38',lng:'-53,91',areaHa:'1.250,5',cultures:'Soja; Milho, gado'})
 assert.equal(producer.name,'Fazenda Teste')
 assert.equal(producer.uf,'RS')
 assert.equal(producer.lat,-28.38)
 assert.equal(producer.areaHa,1250.5)
 assert.deepEqual(producer.cultures,['soja','milho','pecuaria'])
 assert.equal(producer.relationship,'prospect')
})

test('normalizeProducer rejeita coordenadas incompletas ou fora do Brasil',()=>{
 assert.throws(()=>normalizeProducer({name:'A',municipality:'B',lat:-28}),/latitude e longitude juntas/)
 assert.throws(()=>normalizeProducer({name:'A',municipality:'B',lat:40,lng:-3}),/dentro do Brasil/)
 assert.throws(()=>normalizeProducer({name:'',municipality:'B'}),/nome/)
})

test('normalizeIntent exige confiança mínima para intenção confirmada',()=>{
 assert.throws(()=>normalizeIntent({producerId:'x',commodity:'soja',volumeT:10,status:'confirmed',confidence:50}),/80%/)
 const intent=normalizeIntent({producerId:'x',commodity:'soja',volumeT:'1.200',targetPrice:'128,5',deliveryStart:'10/11/2026',deliveryEnd:'2026-11-30',status:'confirmed',confidence:90})
 assert.equal(intent.volumeT,1200)
 assert.equal(intent.targetPrice,128.5)
 assert.equal(intent.deliveryStart,'2026-11-10')
})

test('normalizeMarketRef exige praça e fonte',()=>{
 assert.throws(()=>normalizeMarketRef({commodity:'soja',price:120,region:'',sourceName:'x'}),/praça/)
 assert.throws(()=>normalizeMarketRef({commodity:'soja',price:120,region:'Ijuí',sourceName:''}),/fonte/)
})

test('scoreProducers prioriza intenção confirmada com cotação atual e janela próxima',()=>{
 const producers=[
  {id:'a',name:'Alta',municipality:'Ijuí',uf:'RS',lat:-28.3,lng:-53.9,areaHa:1000,cultures:['soja'],storageCapacityT:1000,estimatedVolumeT:3000,relationship:'active',lastContactAt:iso(-3)},
  {id:'b',name:'Baixa',municipality:'Ijuí',uf:'RS',lat:null,lng:null,areaHa:100,cultures:['soja'],storageCapacityT:null,estimatedVolumeT:300,relationship:'prospect',lastContactAt:null},
  {id:'c',name:'Inativa',municipality:'Cruz Alta',uf:'RS',lat:-28.6,lng:-53.6,areaHa:5000,cultures:['soja'],storageCapacityT:5000,estimatedVolumeT:15000,relationship:'inactive',lastContactAt:iso(-200)}
 ]
 const intents=[{id:'i1',producerId:'a',commodity:'soja',direction:'sell',volumeT:1200,targetPrice:128,priceUnit:'BRL/sc_60kg',deliveryStart:dateOnly(10),deliveryEnd:dateOnly(30),status:'confirmed',confidence:90,observedAt:iso(-1)}]
 const marketRefs=[{id:'m1',commodity:'soja',price:130,priceUnit:'BRL/sc_60kg',region:'Ijuí',sourceName:'Coop',observedAt:iso(-0.2)}]
 const scored=scoreProducers({producers,intents,marketRefs,interactions:[]},{now})
 assert.equal(scored[0].producerId,'a')
 assert.equal(scored[0].priority.level,'high')
 assert.ok(scored[0].priceGapPercent>0)
 assert.match(scored[0].nextAction,/Contatar agora/)
 const low=scored.find(item=>item.producerId==='b')
 assert.ok(low.warnings.some(w=>/coordenadas/.test(w)))
 assert.ok(low.score<55)
 const inactive=scored.find(item=>item.producerId==='c')
 assert.ok(inactive.score<=40,'produtor inativo fica limitado a 40 pontos')
 assert.equal(scored[0].rulesVersion,'mapa-rules-v1')
})

test('scoreProducers limita sinal não confirmado e janela vencida',()=>{
 const producers=[{id:'a',name:'A',municipality:'X',uf:'PR',lat:-25,lng:-50,areaHa:900,cultures:['trigo'],storageCapacityT:null,estimatedVolumeT:2800,relationship:'active',lastContactAt:iso(-2)}]
 const draft=scoreProducers({producers,intents:[{id:'i',producerId:'a',commodity:'trigo',direction:'sell',volumeT:900,targetPrice:1500,priceUnit:'BRL/t',deliveryStart:dateOnly(5),deliveryEnd:null,status:'draft',confidence:40,observedAt:iso(-1)}],marketRefs:[{id:'m',commodity:'trigo',price:1600,priceUnit:'BRL/t',region:'X',sourceName:'Moinho',observedAt:iso(-0.1)}]},{now})[0]
 assert.ok(draft.score<=54)
 assert.match(draft.nextAction,/Validar intenção/)
 const expired=scoreProducers({producers,intents:[{id:'i',producerId:'a',commodity:'trigo',direction:'sell',volumeT:900,targetPrice:1500,priceUnit:'BRL/t',deliveryStart:dateOnly(-10),deliveryEnd:null,status:'confirmed',confidence:90,observedAt:iso(-1)}],marketRefs:[]},{now})[0]
 assert.ok(expired.score<=54)
 assert.ok(expired.warnings.some(w=>/janela/.test(w)))
})

test('summarize conta produtores mapeados, municípios e prioridade alta',()=>{
 const producers=[{id:'a',municipality:'Ijuí',uf:'RS',lat:-28,lng:-53,areaHa:100},{id:'b',municipality:'ijui',uf:'RS',lat:null,lng:null,areaHa:50}]
 const scored=[{potentialVolumeT:300,priority:{level:'high'}},{potentialVolumeT:150,priority:{level:'watch'}}]
 const summary=summarize({producers,scored,intents:[],interactions:[{occurredAt:iso(-3)},{occurredAt:iso(-60)}]},now)
 assert.equal(summary.producers,2);assert.equal(summary.mapped,1);assert.equal(summary.municipalities,1)
 assert.equal(summary.totalAreaHa,150);assert.equal(summary.potentialVolumeT,450);assert.equal(summary.highPriority,1);assert.equal(summary.interactions30d,1)
})

test('distanceKm e priorityFor',()=>{
 const km=distanceKm({lat:-28.3878,lng:-53.9149},{lat:-28.6387,lng:-53.6063})
 assert.ok(km>35&&km<45,`distância Ijuí–Cruz Alta ~41 km, obtido ${km}`)
 assert.equal(priorityFor(80).level,'high');assert.equal(priorityFor(60).level,'medium');assert.equal(priorityFor(40).level,'watch');assert.equal(priorityFor(10).level,'incomplete')
})
