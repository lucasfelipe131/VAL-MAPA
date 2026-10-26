// Malha municipal oficial do IBGE por UF, com nomes dos municípios.
// Fontes: API de malhas v3 (geometria, qualidade mínima) e API de localidades v1 (nomes).
// Cache em memória e em disco (dataDir) para não repetir o download a cada abertura.
import fs from 'node:fs'
import path from 'node:path'
import {domainError} from './rules.js'

const memory=new Map()
export const slugName=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()

async function fetchJson(url,fetchImpl){
 const response=await fetchImpl(url,{headers:{'Accept':'application/vnd.geo+json, application/json, */*','User-Agent':'VAL-Mapa/1.0 (mapeamento de produtores)'},signal:AbortSignal.timeout(45_000)})
 if(!response.ok)throw domainError(`IBGE respondeu ${response.status} para ${url}`,502)
 return response.json()
}

export function mergeMesh(uf,mesh,municipalities){
 const names=new Map((municipalities||[]).map(item=>[String(item.id),item.nome]))
 const features=(mesh?.features||[]).map(feature=>{
  const code=String(feature.properties?.codarea||feature.properties?.CD_MUN||feature.id||'')
  const name=names.get(code)||String(feature.properties?.name||feature.properties?.NM_MUN||'')
  return {type:'Feature',geometry:feature.geometry,properties:{code,name,slug:slugName(name)}}
 })
 return {type:'FeatureCollection',uf,features,fetchedAt:new Date().toISOString()}
}

const ibgeStateCodes={AC:12,AL:27,AP:16,AM:13,BA:29,CE:23,DF:53,ES:32,GO:52,MA:21,MT:51,MS:50,MG:31,PA:15,PB:25,PR:41,PE:26,PI:22,RJ:33,RN:24,RS:43,RO:11,RR:14,SC:42,SP:35,SE:28,TO:17}

// Ordem das fontes: arquivo embarcado (data/malhas/UF.json) → cache em disco → malha IBGE
// publicada no GitHub (geodata-br) → APIs do IBGE. A primeira que responder vence.
export async function municipalityMesh(ufInput,{fetchImpl=fetch,dataDir,bundledDir}={}){
 const uf=String(ufInput||'').toUpperCase()
 if(!ibgeStateCodes[uf])throw domainError('UF inválida.')
 if(memory.has(uf))return memory.get(uf)
 const readFile=file=>{try{if(file&&fs.existsSync(file)){const cached=JSON.parse(fs.readFileSync(file,'utf8'));if(cached?.features?.length)return cached}}catch{}return null}
 const bundled=readFile(bundledDir?path.join(bundledDir,`${uf}.json`):null)
 if(bundled){memory.set(uf,bundled);return bundled}
 const cacheFile=dataDir?path.join(dataDir,'malhas',`${uf}.json`):null
 const cached=readFile(cacheFile)
 if(cached){memory.set(uf,cached);return cached}
 const errors=[]
 let data=null
 try{
  const geo=await fetchJson(`https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-${ibgeStateCodes[uf]}-mun.json`,fetchImpl)
  data=mergeMesh(uf,{features:(geo.features||[]).map(f=>({...f,properties:{codarea:f.properties?.id,name:f.properties?.name}}))},[])
  data.source='IBGE via github.com/tbrugz/geodata-br'
 }catch(error){errors.push(`GitHub: ${error.cause?.message||error.message}`)}
 if(!data?.features?.length){
  try{
   const [mesh,municipalities]=await Promise.all([
    fetchJson(`https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf}?intrarregiao=municipio&qualidade=minima&formato=application/vnd.geo+json`,fetchImpl),
    fetchJson(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,fetchImpl)
   ])
   data=mergeMesh(uf,mesh,municipalities);data.source='IBGE (API de malhas v3)'
  }catch(error){errors.push(`IBGE: ${error.cause?.message||error.message}`)}
 }
 if(!data?.features?.length)throw domainError(`Malha municipal de ${uf} indisponível (${errors.join('; ')}).`,502)
 memory.set(uf,data)
 if(cacheFile){try{fs.mkdirSync(path.dirname(cacheFile),{recursive:true});fs.writeFileSync(cacheFile,JSON.stringify(data))}catch{}}
 return data
}
