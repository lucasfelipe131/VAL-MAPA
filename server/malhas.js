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

export async function municipalityMesh(ufInput,{fetchImpl=fetch,dataDir}={}){
 const uf=String(ufInput||'').toUpperCase()
 if(!/^[A-Z]{2}$/.test(uf))throw domainError('UF inválida.')
 if(memory.has(uf))return memory.get(uf)
 const file=dataDir?path.join(dataDir,'malhas',`${uf}.json`):null
 if(file&&fs.existsSync(file)){
  try{const cached=JSON.parse(fs.readFileSync(file,'utf8'));if(cached?.features?.length){memory.set(uf,cached);return cached}}catch{}
 }
 const [mesh,municipalities]=await Promise.all([
  fetchJson(`https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf}?intrarregiao=municipio&qualidade=minima&formato=application/vnd.geo+json`,fetchImpl),
  fetchJson(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,fetchImpl)
 ])
 const data=mergeMesh(uf,mesh,municipalities)
 if(!data.features.length)throw domainError('O IBGE não retornou a malha municipal desta UF.',502)
 memory.set(uf,data)
 if(file){try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data))}catch{}}
 return data
}
