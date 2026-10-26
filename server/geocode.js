// Geocodificação de municípios via Nominatim (OpenStreetMap), com cache em memória
// e limite de 1 requisição por segundo, conforme a política de uso do serviço.
const cache=new Map()
let last=0
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

export async function geocodeMunicipality(municipality,uf){
 const query=[municipality,uf,'Brasil'].filter(Boolean).join(', ')
 const key=query.toLowerCase()
 if(cache.has(key))return cache.get(key)
 const wait=1100-(Date.now()-last)
 if(wait>0)await sleep(wait)
 last=Date.now()
 const url=new URL('https://nominatim.openstreetmap.org/search')
 url.searchParams.set('q',query);url.searchParams.set('format','json');url.searchParams.set('limit','1');url.searchParams.set('countrycodes','br')
 const response=await fetch(url,{headers:{'User-Agent':'VAL-Mapa/1.0 (mapeamento de produtores)','Accept-Language':'pt-BR'},signal:AbortSignal.timeout(10_000)})
 if(!response.ok)throw Object.assign(new Error('Serviço de geocodificação indisponível.'),{statusCode:502})
 const [hit]=await response.json()
 const result=hit?{lat:Number(hit.lat),lng:Number(hit.lon),label:hit.display_name}:null
 cache.set(key,result)
 return result
}
