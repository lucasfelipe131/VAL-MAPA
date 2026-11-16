// VAL Mapa — motor geo: imóveis rurais (CAR + SIGEF), busca por matrícula e por nome,
// potencial por imóvel calibrado pelo IBGE e vínculo de áreas a produtores.
//
// Módulo independente: não altera produtores, intenções, interações nem o motor mapa-rules-v1.
// Os vínculos ficam na coleção própria `geo_links`. A base (data/geo/regiao-slg.ndjson.gz) é gerada
// por scripts/geo-build.mjs e só é carregada na primeira chamada a /api/geo (não atrasa o /live).
import fs from 'node:fs'
import zlib from 'node:zlib'

// ---------------------------------------------------------------------------------------------
// Funções puras (testadas em test/geo-inteligencia.test.js)
// ---------------------------------------------------------------------------------------------
const soDig = s => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '')

// Números de matrícula comparáveis. Cobre o que aparece no SIGEF e nos cartórios:
// "12.345" → 12345; "R.6-0986" e "AV-2/986" (registro/averbação da matrícula 986) → 986; "M-1.234" → 1234;
// listas com vírgula, ponto e vírgula, " e ", espaço ("33561 33562") ou hífen entre duas matrículas ("5215-5350").
export function normMats(value) {
  return String(value ?? '').replace(/\([^)]*\)/g, ' ').split(/[;,|\n]+|\s+e\s+/i).flatMap(tok => {
    let s = tok.trim().replace(/[–—]/g, '-').replace(/^(matr[ií]cula|mat\.?)\s*[-.:nº°]*\s*/i, '')
    if (/^(r|av)\b|^(r|av)[.\-\d]/i.test(s)) s = s.split(/[-/]/).pop()
    else if (/^m\s*[-.]/i.test(s)) s = s.replace(/^m\s*[-.]\s*/i, '')
    s = s.trim()
    const partes = /^\d[\d.]*\s*-\s*\d[\d.]*$/.test(s) ? s.split('-')
      : /^\d[\d.]*(\s+\d[\d.]*)+$/.test(s) ? s.split(/\s+/)
        : s.split(/\s*\/\s*/)
    return partes.map(soDig).filter(x => x.length >= 1 && x.length <= 9)
  })
}

// Nomes: sem acento, minúsculas, sem palavras genéricas de imóvel. "Fazenda São José – Gleba 2 – João Costa Beber"
// vira [sao, jose, joao, costa, beber]. Partículas (de, da, dos…) e números saem.
const GENERICOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'fazenda', 'faz', 'fda', 'sitio', 'estancia', 'granja', 'chacara', 'parte', 'gleba', 'lote', 'area', 'parcela', 'remanescente', 'imovel', 'rural', 'agropecuaria', 'ltda', 'me', 'epp', 'sa', 'outros', 'outro', 'espolio', 'e/ou', 'matricula', 'mat', 'n'])
export const slugNome = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const tokensNome = s => slugNome(s).split(' ').filter(t => t.length >= 2 && !GENERICOS.has(t) && !/^\d+$/.test(t))

// Pontuação de um nome de imóvel contra a busca: fração das palavras buscadas que aparecem (igual ou, com 4+
// letras, como prefixo: "Franscisco" ≈ "Francisco" não; "Edel" acha "Edelmar"), com bônus se aparecem na ordem.
export function pontuarNome(consulta, nome) {
  const q = Array.isArray(consulta) ? consulta : tokensNome(consulta)
  if (!q.length) return 0
  const t = Array.isArray(nome) ? nome : tokensNome(nome)
  if (!t.length) return 0
  let achou = 0, ultimo = -1, emOrdem = 0
  for (const w of q) {
    const i = t.findIndex(x => x === w || (w.length >= 4 && x.startsWith(w)) || (x.length >= 4 && w.startsWith(x) && w.length - x.length <= 2))
    if (i >= 0) { achou++; if (i > ultimo) emOrdem++; ultimo = i }
  }
  if (!achou) return 0
  const base = achou / q.length
  return Math.round(Math.min(1, base * (0.9 + 0.1 * (emOrdem / achou))) * 100) / 100
}
export const confianca = s => (s >= 0.99 ? 'alta' : s >= 0.66 ? 'média' : 'baixa')

// Potencial por imóvel calibrado pelo IBGE. Para cada município:
//   área-base do imóvel = área consolidada do CAR (se declarada; senão a área total)
//   fator = lavoura de verão do IBGE ÷ soma das áreas-base dos imóveis do CAR (teto 100%) — a consolidada inclui pastagem
//   lavoura estimada = área-base × fator; potencial = lavoura × (soja, milho e trigo na proporção plantada no município)
// Parcelas SIGEF ligadas a um CAR não somam (a terra já está no CAR).
export function mercadoMunicipio(c) {
  if (!c) return null
  const cu = k => ({ area: c[k][0], bom: c[k][1], med: c[k][2], seca: c[k][3], custeio2425: { ha: c[k][4], rsha: c[k][5] }, custeio2526: { ha: c[k][6], rsha: c[k][7] }, julOut2025: c[k][8], julOut2026: c[k][9] })
  const soja = cu('soja'), milho = cu('milho'), trigo = cu('trigo'), verao = soja.area + milho.area
  const pot = q => soja.area * soja[q] + milho.area * milho[q] + trigo.area * trigo[q]
  return { soja, milho, trigo, verao, potBom: pot('bom'), potMed: pot('med'), thaBom: pot('bom') / verao, thaMed: pot('med') / verao }
}
export function calibrar(imoveis, mercadoPorCodigo) {
  const existe = new Set(imoveis.map(r => r.id))
  const soma = new Map()
  for (const r of imoveis) {
    r.dup = Boolean(r.lk && existe.has(r.lk))
    r.base = r.ac > 0 ? Math.min(r.ac, r.a || r.ac) : (r.a || 0)
    if (!r.dup) soma.set(r.mun, (soma.get(r.mun) || 0) + r.base)
  }
  const porId = new Map(imoveis.map(r => [r.id, r]))
  for (const r of imoveis) {
    if (r.dup) continue
    const m = mercadoPorCodigo[r.mun], s = soma.get(r.mun) || 0
    r.fator = m && s > 0 ? Math.min(1, m.verao / s) : 1
    r.lav = r.base * r.fator
    r.pot = potencialDe(r.lav, m)
  }
  // parcela SIGEF dentro de um CAR: a parte dela na lavoura do CAR, proporcional à área. Fica fora da soma do
  // município (a terra já está no CAR), mas é o que vale quando só a parcela é do produtor.
  for (const r of imoveis) {
    if (!r.dup) continue
    const car = porId.get(r.lk), m = mercadoPorCodigo[r.mun]
    r.fator = car.fator
    r.lav = car.a > 0 ? Math.min(car.lav, car.lav * (r.a || 0) / car.a) : 0
    r.pot = potencialDe(r.lav, m)
  }
}
export function potencialDe(lavouraHa, m) {
  if (!m || !lavouraHa) return { bom: 0, med: 0, soja: 0, milho: 0, trigo: 0 }
  const fr = k => m[k].area / m.verao
  const soja = lavouraHa * fr('soja') * m.soja.bom, milho = lavouraHa * fr('milho') * m.milho.bom, trigo = lavouraHa * fr('trigo') * m.trigo.bom
  return { bom: soja + milho + trigo, med: lavouraHa * m.thaMed, soja, milho, trigo }
}
const arred = v => Math.round(v)

// ---------------------------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------------------------
export function createGeoIntel({ dataFile, store, domainError }) {
  let base = null
  const CELULA = 0.05   // grade de ~5 km para busca por janela do mapa

  function carregar() {
    if (base) return base
    if (!fs.existsSync(dataFile)) throw domainError('Base geo não encontrada. Gere com scripts/geo-build.mjs.', 503)
    const t0 = Date.now()
    const linhas = zlib.gunzipSync(fs.readFileSync(dataFile)).toString('utf8').split('\n')
    const cab = JSON.parse(linhas[0])
    const mercado = Object.fromEntries(Object.entries(cab.mercado || {}).map(([nome, c]) => [nome, mercadoMunicipio(c)]))
    const mercadoPorCodigo = Object.fromEntries(Object.entries(cab.municipios).map(([cod, nome]) => [cod, mercado[nome]]))
    const imoveis = [], geom = new Map()
    for (let i = 1; i < linhas.length; i++) {
      const tab = linhas[i].indexOf('\t'); if (tab < 0) continue
      const r = JSON.parse(linhas[i].slice(0, tab))
      geom.set(r.id, linhas[i].slice(tab + 1))     // geometria fica como texto: memória menor, resposta sem re-serializar
      imoveis.push(r)
    }
    calibrar(imoveis, mercadoPorCodigo)
    const porId = new Map(imoveis.map(r => [r.id, r]))
    const porMat = new Map(), grade = new Map()
    for (const r of imoveis) {
      r.municipio = cab.municipios[r.mun] || ''
      r.mats = normMats(r.mat)
      for (const m of r.mats) { if (!porMat.has(m)) porMat.set(m, []); porMat.get(m).push(r) }
      r.tok = tokensNome(r.nome)
      const [w, s, e, n] = r.b
      for (let x = Math.floor(w / CELULA); x <= Math.floor(e / CELULA); x++)
        for (let y = Math.floor(s / CELULA); y <= Math.floor(n / CELULA); y++) {
          const k = `${x}|${y}`; if (!grade.has(k)) grade.set(k, []); grade.get(k).push(r)
        }
    }
    // parcelas de cada CAR (para expandir vínculos e mostrar)
    for (const r of imoveis) if (r.lk && porId.has(r.lk)) (porId.get(r.lk).parcelas ||= []).push(r.id)
    base = { cab, mercado, mercadoPorCodigo, imoveis, porId, porMat, grade, geom, carregadoEm: new Date().toISOString(), ms: Date.now() - t0 }
    console.log(`Motor geo: ${imoveis.length} imóveis carregados em ${base.ms} ms`)
    return base
  }

  const codigoDe = (b, municipio) => {
    if (!municipio) return ''
    if (/^\d{7}$/.test(municipio)) return municipio
    const s = slugNome(municipio)
    return Object.entries(b.cab.municipios).find(([, nome]) => slugNome(nome) === s)?.[0] || '__nenhum__'
  }
  // Resumo enviado ao navegador (sem geometria). `vinc` = produtores vinculados.
  function resumo(r, vinc) {
    const b = base
    const car = r.dup ? b.porId.get(r.lk) : null
    return {
      id: r.id, fonte: r.f, nome: r.nome || '', matricula: r.mat || '', cns: r.cns || '', municipio: r.municipio, codigoIbge: r.mun,
      areaHa: r.a, areaConsolidadaHa: r.ac || 0, lavouraHa: Math.round(r.lav * 100) / 100, fator: Math.round(r.fator * 1000) / 1000,
      potencialT: { anoBom: arred(r.pot.bom), media: arred(r.pot.med), soja: arred(r.pot.soja), milho: arred(r.pot.milho), trigo: arred(r.pot.trigo) },
      car: r.car || (car ? car.car : ''), parcela: r.parcela || '', codigoIncra: r.incra || '', situacao: r.st || '', modulosFiscais: r.mf || null, tipo: r.tp || '',
      dentroDoCar: r.dup ? r.lk : '', parcelas: r.parcelas || [], ponto: r.c, bbox: r.b,
      produtores: vinc ? (vinc.get(r.id) || []) : []
    }
  }
  const feature = (r, vinc) => `{"type":"Feature","id":${JSON.stringify(r.id)},"properties":${JSON.stringify(resumo(r, vinc))},"geometry":${base.geom.get(r.id)}}`

  async function vinculos() { return store.all('geo_links') }
  // quem está vinculado a cada imóvel; vincular o CAR vincula também as parcelas dele (o inverso não: a parcela é só uma parte)
  async function mapaVinculos() {
    const m = new Map()
    for (const l of await vinculos()) {
      for (const id of [l.imovelId, ...(base.porId.get(l.imovelId)?.parcelas || [])]) {
        if (!m.has(id)) m.set(id, []); if (!m.get(id).includes(l.producerId)) m.get(id).push(l.producerId)
      }
    }
    return m
  }
  // imóveis que contam no potencial: a parcela SIGEF sai quando o CAR dela também está vinculado (senão conta a parte dela)
  const contaveis = ids => { const s = new Set(ids.filter(id => base.porId.has(id))); return [...s].filter(id => { const r = base.porId.get(id); return !(r.dup && s.has(r.lk)) }) }

  function buscarMatricula(numero, municipio) {
    const b = carregar(), cod = codigoDe(b, municipio), nums = normMats(numero)
    const vistos = new Set(), out = []
    for (const n of nums) for (const r of b.porMat.get(n) || []) if ((!cod || r.mun === cod) && !vistos.has(r.id)) { vistos.add(r.id); out.push(r) }
    return { numeros: nums, itens: out.sort((x, y) => (x.dup - y.dup) || (x.f === 'CAR' ? -1 : 1) - (y.f === 'CAR' ? -1 : 1) || y.a - x.a) }
  }
  function buscarNome(texto, municipio, minimo = 0.66) {
    const b = carregar(), cod = codigoDe(b, municipio), q = tokensNome(texto)
    if (!q.length) return { tokens: q, itens: [] }
    const achados = []
    for (const r of b.imoveis) {
      if (cod && r.mun !== cod) continue
      if (!r.tok.length) continue
      const s = pontuarNome(q, r.tok)
      if (s >= minimo && (q.length === 1 || s * q.length >= 2 || s >= 0.99)) {
        // sem o primeiro nome buscado, é parente ou outra pessoa da família: "mesmo sobrenome"
        const primeiro = q.length >= 2 && pontuarNome([q[0]], r.tok) > 0
        achados.push({ r, s, relacao: s >= 0.99 ? 'nome' : q.length >= 2 && !primeiro ? 'sobrenome' : 'parcial' })
      }
    }
    // parcela SIGEF cujo CAR também apareceu: mostra só o CAR (a parcela vai junto)
    const ids = new Set(achados.map(a => a.r.id))
    const ordemRel = { nome: 0, parcial: 1, sobrenome: 2 }
    const itens = achados.filter(a => !(a.r.dup && ids.has(a.r.lk))).sort((x, y) => ordemRel[x.relacao] - ordemRel[y.relacao] || y.s - x.s || (y.r.lav || y.r.a) - (x.r.lav || x.r.a))
    return { tokens: q, itens: itens.slice(0, 300) }
  }
  function naJanela(bbox, limite = 3000) {
    const b = carregar()
    const [w, s, e, n] = bbox
    const vistos = new Set(), out = []
    for (let x = Math.floor(w / CELULA); x <= Math.floor(e / CELULA); x++)
      for (let y = Math.floor(s / CELULA); y <= Math.floor(n / CELULA); y++)
        for (const r of b.grade.get(`${x}|${y}`) || []) {
          if (vistos.has(r.id)) continue; vistos.add(r.id)
          if (r.b[2] < w || r.b[0] > e || r.b[3] < s || r.b[1] > n) continue
          out.push(r)
        }
    out.sort((x, y) => (x.dup - y.dup) || y.a - x.a)
    return { total: out.length, itens: out.slice(0, limite) }
  }
  async function potencialProdutor(producerId) {
    carregar()
    const links = (await vinculos()).filter(l => l.producerId === producerId)
    const ids = contaveis(links.map(l => l.imovelId))
    const soma = { lavouraHa: 0, areaHa: 0, anoBom: 0, media: 0, soja: 0, milho: 0, trigo: 0 }
    for (const id of ids) {
      const r = base.porId.get(id)
      soma.areaHa += r.a || 0; soma.lavouraHa += r.lav; soma.anoBom += r.pot.bom; soma.media += r.pot.med
      soma.soja += r.pot.soja; soma.milho += r.pot.milho; soma.trigo += r.pot.trigo
    }
    for (const k of Object.keys(soma)) soma[k] = k.endsWith('Ha') ? Math.round(soma[k] * 100) / 100 : arred(soma[k])
    const vinc = await mapaVinculos()
    return { producerId, vinculos: links.map(l => ({ ...l, imovel: base.porId.has(l.imovelId) ? resumo(base.porId.get(l.imovelId), vinc) : null })), imoveisContados: ids.length, potencial: soma }
  }

  // --- rotas /api/geo/... (todas exigem sessão, como o resto da API) -------------------------
  async function handle({ request, response, url, segments, json, readBody }) {
    const method = request.method, rota = segments[2] || '', id = segments[3] ? decodeURIComponent(segments[3]) : ''
    if (rota === 'status' && method === 'GET') {
      const b = carregar()
      return json(response, 200, { carregado: true, ms: b.ms, geradoEm: b.cab.geradoEm, regiao: b.cab.regiao, fontes: b.cab.fontes, contagem: b.cab.contagem, municipios: b.cab.municipios })
    }
    if (rota === 'municipios' && method === 'GET') {
      const b = carregar()
      const linhas = Object.entries(b.cab.municipios).map(([cod, nome]) => {
        const m = b.mercado[nome], doMun = b.imoveis.filter(r => r.mun === cod)
        return { codigoIbge: cod, municipio: nome, imoveisCar: doMun.filter(r => r.f === 'CAR').length, parcelasSigef: doMun.filter(r => r.f === 'SIGEF').length,
          lavouraVeraoHa: m?.verao || 0, graoTHaAnoBom: m ? Math.round(m.thaBom * 100) / 100 : 0, graoTHaMedia: m ? Math.round(m.thaMed * 100) / 100 : 0,
          producaoAnoBomT: m ? arred(m.potBom) : 0, producaoMediaT: m ? arred(m.potMed) : 0, mercado: m }
      })
      return json(response, 200, { itens: linhas }, { 'Cache-Control': 'private, max-age=3600' })
    }
    if (rota === 'imoveis' && method === 'GET' && !id) {
      const bbox = String(url.searchParams.get('bbox') || '').split(',').map(Number)
      if (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))) throw domainError('Informe bbox=oeste,sul,leste,norte.')
      if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 1.2) throw domainError('Aproxime o mapa para ver os imóveis (janela muito grande).', 422)
      const { total, itens } = naJanela(bbox, Math.min(5000, Number(url.searchParams.get('limite') || 3000)))
      const vinc = await mapaVinculos()
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      return response.end(`{"type":"FeatureCollection","total":${total},"features":[${itens.map(r => feature(r, vinc)).join(',')}]}`)
    }
    if (rota === 'imoveis' && method === 'GET' && id) {
      const b = carregar(), r = b.porId.get(id); if (!r) throw domainError('Imóvel não encontrado.', 404)
      const vinc = await mapaVinculos()
      const rel = [r.lk, ...(r.parcelas || [])].filter(x => x && b.porId.has(x)).map(x => b.porId.get(x))
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      return response.end(`{"type":"FeatureCollection","features":[${[r, ...rel].map(x => feature(x, vinc)).join(',')}]}`)
    }
    if ((rota === 'matricula' || rota === 'nome') && method === 'GET') {
      const municipio = String(url.searchParams.get('municipio') || '')
      const res = rota === 'matricula' ? buscarMatricula(url.searchParams.get('numero') || '', municipio) : buscarNome(url.searchParams.get('q') || '', municipio, Number(url.searchParams.get('minimo') || 0.66))
      const vinc = await mapaVinculos()
      const comGeo = url.searchParams.get('geometria') === '1'
      const itens = res.itens.map(x => (x.r ? { ...resumo(x.r, vinc), pontuacao: x.s, confianca: confianca(x.s), relacao: x.relacao } : resumo(x, vinc)))
      const soma = itens.reduce((s, i) => ({ areaHa: s.areaHa + (i.areaHa || 0), lavouraHa: s.lavouraHa + i.lavouraHa, anoBom: s.anoBom + i.potencialT.anoBom }), { areaHa: 0, lavouraHa: 0, anoBom: 0 })
      const corpo = { busca: rota === 'matricula' ? { numeros: res.numeros, municipio } : { palavras: res.tokens, municipio }, total: itens.length, soma: { areaHa: Math.round(soma.areaHa), lavouraHa: Math.round(soma.lavouraHa), potencialAnoBomT: arred(soma.anoBom) }, itens }
      if (!comGeo) return json(response, 200, corpo)
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      const feats = itens.slice(0, 300).map(i => `{"type":"Feature","id":${JSON.stringify(i.id)},"properties":${JSON.stringify(i)},"geometry":${base.geom.get(i.id)}}`)
      return response.end(`${JSON.stringify(corpo).slice(0, -1)},"geojson":{"type":"FeatureCollection","features":[${feats.join(',')}]}}`)
    }
    if (rota === 'vinculos') {
      if (method === 'GET' && !id) {
        const producerId = String(url.searchParams.get('producerId') || '')
        if (producerId) return json(response, 200, await potencialProdutor(producerId))
        carregar()
        return json(response, 200, { itens: await vinculos() })
      }
      if (method === 'POST' && !id) {
        const b = carregar(), body = await readBody(request)
        const producerId = String(body.producerId || '')
        if (!producerId || !await store.get('producers', producerId)) throw domainError('Produtor não encontrado.', 404)
        const pedidos = (Array.isArray(body.imovelIds) ? body.imovelIds : [body.imovelId]).map(String).filter(Boolean)
        if (!pedidos.length) throw domainError('Informe os imóveis.')
        if (pedidos.length > 500) throw domainError('Vincule no máximo 500 imóveis por vez.')
        const atuais = (await vinculos()).filter(l => l.producerId === producerId)
        const jaTem = new Set(atuais.map(l => l.imovelId)), criados = []
        for (const imovelId of pedidos) {
          const r = b.porId.get(imovelId); if (!r) throw domainError(`Imóvel não encontrado: ${imovelId}`, 404)
          if (jaTem.has(imovelId)) continue
          criados.push(await store.insert('geo_links', { producerId, imovelId, fonte: r.f, municipio: r.municipio, codigoIbge: r.mun, nome: r.nome || '', matricula: r.mat || '', areaHa: r.a, origem: String(body.origem || 'tela').slice(0, 40), busca: String(body.busca || '').slice(0, 160) }))
          jaTem.add(imovelId)
        }
        return json(response, 201, { criados: criados.length, ...(await potencialProdutor(producerId)) })
      }
      if (method === 'DELETE' && id) {
        if (!await store.remove('geo_links', id)) throw domainError('Vínculo não encontrado.', 404)
        return json(response, 200, { removed: true })
      }
    }
    throw domainError('Rota não encontrada.', 404)
  }

  return { handle, carregar, buscarMatricula, buscarNome, naJanela, potencialProdutor }
}
