// VAL Geomap — motor geo: imóveis rurais (CAR + SIGEF), busca por matrícula e por nome,
// potencial por imóvel calibrado pelo IBGE e vínculo de áreas a produtores.
//
// Módulo independente: não altera produtores, intenções, interações nem o motor mapa-rules-v1.
// Os vínculos ficam na coleção própria `geo_links`. A base (data/geo/imoveis.ndjson.gz) é gerada
// por scripts/geo-build.mjs e só é carregada na primeira chamada a /api/geo (não atrasa o /live).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { classificar, piorNivel, porte, modulosPorMunicipio, NIVEIS } from './geo-socioambiental.js'
import { createFontesMunicipio, areaHa, pontoCentral } from './geo-municipio.js'
import { municipalityMesh } from './malhas.js'
import { createEmpresas, formatarCnpj, GRUPOS } from './geo-empresas.js'
import { montarProspectos, filtrarProspectos, primeirosNomes, nomeProdutor } from './geo-prospeccao.js'
import { createGeoIA } from './geo-ia.js'

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
// vira [sao, jose, joao, costa, beber]. Partículas (de, da, dos…), números e palavras que não identificam a pessoa
// ("Família Seibt", "Grupo Jaeger", "Genor Brum Filho") saem dos dois lados.
const GENERICOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'fazenda', 'faz', 'fda', 'sitio', 'estancia', 'granja', 'chacara', 'parte', 'gleba', 'lote', 'area', 'parcela', 'remanescente', 'imovel', 'rural', 'agropecuaria', 'ltda', 'me', 'epp', 'sa', 'outros', 'outro', 'espolio', 'e/ou', 'matricula', 'mat', 'n',
  'familia', 'grupo', 'irmaos', 'irmao', 'herdeiros', 'herdeiro', 'sucessao', 'sucessores', 'condominio', 'cia', 'filho', 'filha', 'neto', 'neta', 'junior', 'jr', 'sobrinho'])
export const slugNome = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const tokensNome = s => slugNome(s).split(' ').filter(t => t.length >= 2 && !GENERICOS.has(t) && !/^\d+$/.test(t))

// Distância de edição (com troca de letras vizinhas), parando cedo acima de `max`.
function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let ant2 = null, ant = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let menor = i
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (ant2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, ant2[j - 2] + 1)
      cur.push(v); if (v < menor) menor = v
    }
    if (menor > max) return max + 1
    ant2 = ant; ant = cur
  }
  return ant[b.length]
}
// Quanto uma palavra buscada vale contra uma palavra do registro: 1 = igual ou prefixo ("Edel" acha "Edelmar");
// 0,9 = grafia parecida ("Franscisco" ≈ "Francisco", "Ceolim" ≈ "Ceolin"): mesma inicial, 5+ letras, 1 letra de
// diferença (2 com 8+ letras). 0 = não casa.
export function casarPalavra(w, x) {
  if (x === w || (w.length >= 4 && x.startsWith(w))) return 1
  // registro uma letra mais curto ("Edelma" para "Edelmar"); com mais, já é outro nome ("Back" não é "Backes")
  if (x.length >= 4 && w.startsWith(x) && w.length - x.length === 1) return 0.9
  if (w.length >= 5 && x.length >= 5 && w[0] === x[0]) {
    const max = Math.min(w.length, x.length) >= 8 ? 2 : 1
    if (distancia(w, x, max) <= max) return 0.9
  }
  return 0
}
// Compara a busca com o nome do registro: quais palavras casaram, se alguma só pela grafia parecida, e a pontuação
// (fração das palavras buscadas, com bônus se aparecem na ordem).
export function compararNome(consulta, nome) {
  const q = Array.isArray(consulta) ? consulta : tokensNome(consulta)
  const t = Array.isArray(nome) ? nome : tokensNome(nome)
  const casou = q.map(() => 0)
  if (!q.length || !t.length) return { s: 0, casou, aproximado: false }
  let soma = 0, achou = 0, ultimo = -1, emOrdem = 0
  q.forEach((w, k) => {
    let melhor = 0, onde = -1
    for (let i = 0; i < t.length && melhor < 1; i++) { const v = casarPalavra(w, t[i]); if (v > melhor) { melhor = v; onde = i } }
    if (melhor) { casou[k] = melhor; soma += melhor; achou++; if (onde > ultimo) emOrdem++; ultimo = onde }
  })
  if (!achou) return { s: 0, casou, aproximado: false }
  const s = Math.round(Math.min(1, (soma / q.length) * (0.9 + 0.1 * (emOrdem / achou))) * 100) / 100
  return { s, casou, aproximado: casou.some(v => v > 0 && v < 1) }
}
export const pontuarNome = (consulta, nome) => compararNome(consulta, nome).s

// Documentos: lista fechada de tipos, até 10 MB, nome sem caminho nem caracteres de controle
export const MAX_DOC = 10 * 1024 * 1024
export const TIPOS_DOC = { pdf: 'application/pdf', kml: 'application/vnd.google-earth.kml+xml', kmz: 'application/vnd.google-earth.kmz', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip' }
export const CATEGORIAS_DOC = ['matricula', 'car', 'kml', 'laudo', 'contrato', 'outro']
export const nomeArquivo = s => (String(s || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 150) || 'documento')
export function lerBinario(request, max) {
  return new Promise((resolve, reject) => {
    const partes = []; let total = 0, parou = false
    request.on('data', c => { if (parou) return; total += c.length; if (total > max) { parou = true; reject(Object.assign(new Error(`Arquivo maior que ${Math.round(max / 1048576)} MB.`), { statusCode: 413 })); request.resume(); return } partes.push(c) })
    request.on('end', () => { if (!parou) resolve(Buffer.concat(partes)) })
    request.on('error', reject)
  })
}
const ORDEM_REL = { nome: 0, parecido: 1, parcial: 2, sobrenome: 3 }
const SOBRENOME_RARO = 40   // registros na base com a palavra; acima disso um sobrenome sozinho não identifica

// Ponto dentro de Polygon/MultiPolygon GeoJSON (furos descontados).
function anelContem(pt, anel) { let d = false; for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) { const [xi, yi] = anel[i], [xj, yj] = anel[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) d = !d } return d }
export function contemPonto(g, pt) {
  if (!g) return false
  const polis = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  return polis.some(p => anelContem(pt, p[0]) && !p.slice(1).some(h => anelContem(pt, h)))
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
// Base em um ou vários arquivos (um por região): dataDir com imoveis*.ndjson.gz, ou dataFile único.
// No servidor a carga é assíncrona e em partes (o app segue respondendo); nos testes, síncrona. O mesmo código
// roda nos dois modos porque as etapas são geradores que param de tempos em tempos (yield).
const gunzipAsync = promisify(zlib.gunzip)
const rodarSync = gen => { let r; while (!(r = gen.next()).done); return r.value }
const pausa = () => new Promise(resolve => setImmediate(resolve))
async function rodarAsync(gen) { let r; while (!(r = gen.next()).done) await pausa(); return r.value }
// percorre a base descompactada: 1ª linha = cabeçalho; depois "props TAB geometria". A geometria fica como fatia
// do próprio buffer (sem cópia e fora do heap do V8), convertida em texto só quando vai para o navegador.
function* lerBuffer(buf, acc) {
  let ini = 0, n = 0, primeira = true
  while (ini < buf.length) {
    let fim = buf.indexOf(10, ini); if (fim < 0) fim = buf.length
    if (primeira) { acc.cabs.push(JSON.parse(buf.toString('utf8', ini, fim))); primeira = false }
    else {
      const tab = buf.indexOf(9, ini)
      if (tab > ini && tab < fim) {
        const r = JSON.parse(buf.toString('utf8', ini, tab))
        acc.geom.set(r.id, buf.subarray(tab + 1, fim))
        acc.imoveis.push(r)
      }
    }
    ini = fim + 1
    if (++n % 5000 === 0) yield
  }
}
// cabeçalhos de várias regiões viram um só
export function juntarCabecalhos(cabs) {
  if (cabs.length === 1) return cabs[0]
  const c = { v: 1, geradoEm: cabs.map(x => x.geradoEm || '').sort().pop(), regiao: '', fontes: [], municipios: {}, mercado: {}, contagem: {}, camadas: null, regioes: [] }
  for (const x of cabs) {
    Object.assign(c.municipios, x.municipios); Object.assign(c.mercado, x.mercado)
    for (const [k, v] of Object.entries(x.contagem || {})) c.contagem[k] = (c.contagem[k] || 0) + v
    for (const f of x.fontes || []) if (!/^Gerado por/.test(f) && !c.fontes.includes(f)) c.fontes.push(f)
    c.camadas ||= x.camadas || null
    c.regioes.push(x.regiao)
  }
  const n = Object.keys(c.municipios).length
  c.regiao = Object.keys(c.municipios).every(k => k.startsWith('43')) ? `Rio Grande do Sul: ${n} municípios em ${cabs.length} regiões` : `${n} municípios em ${cabs.length} regiões`
  return c
}

export function createGeoIntel({ dataFile, dataDir, store, domainError, aquecer = false, malhasDir = dataDir ? path.join(dataDir, '..', 'malhas') : null, fetchImpl = fetch, clienteIA = null }) {
  // dados da ficha calculados antes (scripts/geo-municipios.mjs), embarcados ao lado da base
  const lerPre = nome => { try { return dataDir ? JSON.parse(fs.readFileSync(path.join(dataDir, `municipios-${nome}.json`), 'utf8')) : null } catch { return null } }
  const pre = { relevo: lerPre('relevo')?.itens || null, credito: lerPre('credito'), estrutura: lerPre('estrutura') }
  // armazéns de empresas e cooperativas (CONAB), para a camada do mapa (scripts/geo-estrutura.mjs)
  const armazensPontos = (() => { try { return dataDir ? fs.readFileSync(path.join(dataDir, 'armazens-rs.json'), 'utf8') : null } catch { return null } })()
  const estruturaDe = cod => pre.estrutura?.itens?.[cod] || null
  const fontes = createFontesMunicipio({ fetchImpl, domainError, pre })
  // nomes ligados às áreas, de cadastros públicos (scripts/geo-nomes.mjs): responsáveis por embargos do IBAMA,
  // produtores com armazém próprio (CONAB) e empresas do agro (CNPJ da Receita)
  const lerJson = nome => { try { return dataDir ? JSON.parse(fs.readFileSync(path.join(dataDir, nome), 'utf8')) : null } catch { return null } }
  const responsaveis = lerJson('embargos-responsaveis.json')
  const armazensPF = lerJson('produtores-armazem.json')
  const armazensEmp = (() => { try { return armazensPontos ? JSON.parse(armazensPontos).pontos : [] } catch { return [] } })()
  const empresas = createEmpresas({ arquivo: dataDir ? path.join(dataDir, 'empresas-rs.json.gz') : null, tokens: tokensNome, comparar: compararNome, casar: casarPalavra, nomeMunicipio: c => base?.cab.municipios[c] || c })
  // limite do município (malha do IBGE embarcada em data/malhas): área, centro e amostras de relevo
  async function geometriaMunicipio(cod) {
    if (!malhasDir || !fs.existsSync(path.join(malhasDir, 'RS.json'))) return null   // sem a malha embarcada (testes): a ficha sai sem a área do município
    const malha = await municipalityMesh('RS', { bundledDir: malhasDir, fetchImpl })
    return malha.features.find(f => f.properties.code === cod)?.geometry || null
  }
  let base = null, carregando = null
  const CELULA = 0.05   // grade de ~5 km para busca por janela do mapa
  const arquivos = () => (dataDir
    ? (fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter(n => /^imoveis.*\.ndjson\.gz$/.test(n)).sort().map(n => path.join(dataDir, n)) : [])
    : (dataFile && fs.existsSync(dataFile) ? [dataFile] : []))
  const semBase = () => domainError('Base geo não encontrada. Gere com scripts/geo-build.mjs.', 503)

  function carregar() {   // síncrona: testes e scripts
    if (base) return base
    const lista = arquivos(); if (!lista.length) throw semBase()
    const t0 = Date.now(), acc = { cabs: [], imoveis: [], geom: new Map() }
    for (const f of lista) rodarSync(lerBuffer(zlib.gunzipSync(fs.readFileSync(f)), acc))
    return (base = rodarSync(montar(acc, t0)))
  }
  function carregarAsync() {   // servidor: em partes, sem travar as outras requisições
    if (base) return Promise.resolve(base)
    if (!carregando) {
      carregando = (async () => {
        const lista = arquivos(); if (!lista.length) throw semBase()
        const t0 = Date.now(), acc = { cabs: [], imoveis: [], geom: new Map() }
        for (const f of lista) await rodarAsync(lerBuffer(await gunzipAsync(await fs.promises.readFile(f)), acc))
        const b = await rodarAsync(montar(acc, t0))
        return (base ||= b)
      })()
      carregando.catch(() => { carregando = null })
    }
    return carregando
  }
  // no servidor: carrega a base logo depois de subir e, em seguida, monta os produtores da base (empresas incluídas)
  if (aquecer) setTimeout(() => carregarAsync().then(() => setTimeout(() => { try { prospectos() } catch (e) { console.error('Produtores da base:', e.message) } }, 500)).catch(e => console.error('Motor geo:', e.message)), 1500)

  function* montar(acc, t0) {
    const cab = juntarCabecalhos(acc.cabs), imoveis = acc.imoveis, geom = acc.geom
    const mercado = Object.fromEntries(Object.entries(cab.mercado || {}).map(([nome, c]) => [nome, mercadoMunicipio(c)]))
    const mercadoPorCodigo = Object.fromEntries(Object.entries(cab.municipios).map(([cod, nome]) => [cod, mercado[nome]]))
    calibrar(imoveis, mercadoPorCodigo)
    yield
    const porId = new Map(imoveis.map(r => [r.id, r]))
    const porMat = new Map(), grade = new Map(), freq = new Map(), porToken = new Map()   // porToken: palavra → registros (índice da busca por nome)
    let cont = 0
    for (const r of imoveis) {
      if (++cont % 10000 === 0) yield
      r.municipio = cab.municipios[r.mun] || ''
      r.mats = normMats(r.mat)
      for (const m of r.mats) { if (!porMat.has(m)) porMat.set(m, []); porMat.get(m).push(r) }
      r.tok = tokensNome(r.nome)
      for (const w of new Set(r.tok)) { freq.set(w, (freq.get(w) || 0) + 1); let l = porToken.get(w); if (!l) porToken.set(w, (l = [])); l.push(r) }   // em quantos registros cada palavra aparece
      if (r.sa || /suspens/i.test(r.st || '')) r.risco = classificar(r.sa, r.st)   // triagem socioambiental (só quem tem algo)
      const [w, s, e, n] = r.b
      for (let x = Math.floor(w / CELULA); x <= Math.floor(e / CELULA); x++)
        for (let y = Math.floor(s / CELULA); y <= Math.floor(n / CELULA); y++) {
          const k = `${x}|${y}`; if (!grade.has(k)) grade.set(k, []); grade.get(k).push(r)
        }
    }
    // parcelas de cada CAR (para expandir vínculos e mostrar)
    for (const r of imoveis) if (r.lk && porId.has(r.lk)) (porId.get(r.lk).parcelas ||= []).push(r.id)
    const moduloHa = modulosPorMunicipio(imoveis)   // tamanho do módulo fiscal (ha) em cada município
    const b = { cab, mercado, mercadoPorCodigo, imoveis, porId, porMat, grade, freq, porToken, geom, moduloHa, carregadoEm: new Date().toISOString(), ms: Date.now() - t0 }
    console.log(`Motor geo: ${imoveis.length} imóveis de ${acc.cabs.length} arquivo(s) carregados em ${b.ms} ms`)
    return b
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
      produtores: vinc ? (vinc.get(r.id) || []) : [],
      socioambiental: r.risco || null, moduloFiscalHa: b.moduloHa[r.mun] || null, porte: porte(modulosDe(r))
    }
  }
  // módulos fiscais do imóvel: o do CAR; para parcela SIGEF, a área ÷ módulo do município
  const modulosDe = r => (r.mf > 0 ? r.mf : base.moduloHa[r.mun] ? (r.a || 0) / base.moduloHa[r.mun] : 0)
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
  // Busca pelo nome em toda a base. O município (do cadastro ou escolhido) só ordena: o produtor pode ter terra no
  // vizinho. Com `estrito`, filtra. Relação com o registro:
  //   nome      todas as palavras, iguais         parecido  todas, alguma com grafia parecida
  //   parcial   o primeiro nome e parte do resto  sobrenome sem o primeiro nome (parente, ou a área da família);
  //   só o último sobrenome casando (igual) entra quando ele é raro na base (até SOBRENOME_RARO registros): o do
  //   meio ("de Souza") e os comuns ("Machado") trazem gente de outras famílias. Uma palavra só ("Família Seibt"
  //   vira "seibt") é tratada como sobrenome quando é comum, para entrar no limite.
  function buscarNome(texto, municipio, minimo = 0.66, { estrito = false } = {}) {
    const b = carregar(), cod = codigoDe(b, municipio), q = tokensNome(texto)
    if (!q.length) return { tokens: q, itens: [], municipio: cod }
    const ultimo = q[q.length - 1], ultimoRaro = (b.freq.get(ultimo) || 0) <= SOBRENOME_RARO
    const achados = []
    // candidatos: só os registros com alguma palavra que casa com uma palavra buscada (mesma inicial, então dá para
    // filtrar o vocabulário antes de comparar); evita percorrer a base inteira a cada busca
    const candidatos = new Set()
    for (const w of q) for (const [x, lista] of b.porToken) if (x[0] === w[0] && casarPalavra(w, x)) for (const r of lista) candidatos.add(r)
    for (const r of candidatos) {
      if (estrito && cod && r.mun !== cod) continue
      if (!r.tok.length) continue
      const c = compararNome(q, r.tok)
      // pelo menos uma palavra igual: só grafia parecida ("Backes" ≈ "Backer") costuma ser outra família
      if (!c.s || !c.casou.some(v => v === 1)) continue
      const n = c.casou.filter(Boolean).length, primeiro = c.casou[0] > 0
      let relacao = null
      if (n === q.length) relacao = q.length === 1 && !ultimoRaro ? 'sobrenome' : c.aproximado ? 'parecido' : 'nome'
      else if (c.s >= minimo && n >= 2) relacao = primeiro ? 'parcial' : 'sobrenome'
      else if (q.length >= 2 && !primeiro && ultimoRaro && r.tok.includes(ultimo)) relacao = 'sobrenome'
      if (relacao) achados.push({ r, s: c.s, relacao, noMunicipio: !cod || r.mun === cod })
    }
    // parcela SIGEF cujo CAR também apareceu: mostra só o CAR (a parcela vai junto)
    const ids = new Set(achados.map(a => a.r.id))
    const itens = achados.filter(a => !(a.r.dup && ids.has(a.r.lk)))
      .sort((x, y) => ORDEM_REL[x.relacao] - ORDEM_REL[y.relacao] || (y.noMunicipio - x.noMunicipio) || y.s - x.s || (y.r.lav || y.r.a) - (x.r.lav || x.r.a))
    // sobrenome comum ("Machado", "Batista") pode trazer centenas: fica com os primeiros
    let nSob = 0
    const limitados = itens.filter(a => a.relacao !== 'sobrenome' || ++nSob <= 80)
    return { tokens: q, itens: limitados.slice(0, 300), municipio: cod, sobrenomeCortado: nSob > 80 ? nSob : 0 }
  }

  // Imóveis no ponto (o que contém o ponto) e perto dele (até `raioKm`, pelo ponto interno), para o ponto do cadastro.
  function buscarPonto(lng, lat, raioKm = 1.5) {
    const b = carregar()
    const dLat = raioKm / 111, dLng = raioKm / (111 * Math.cos(lat * Math.PI / 180))
    const { itens } = naJanela([lng - dLng, lat - dLat, lng + dLng, lat + dLat], 5000)
    const km = r => { const dx = (r.c[0] - lng) * 111 * Math.cos(lat * Math.PI / 180), dy = (r.c[1] - lat) * 111; return Math.hypot(dx, dy) }
    const dentro = [], perto = []
    for (const r of itens) {
      const contem = r.b[0] <= lng && lng <= r.b[2] && r.b[1] <= lat && lat <= r.b[3] && contemPonto(JSON.parse(b.geom.get(r.id)), [lng, lat])
      if (contem) dentro.push({ r, km: 0 })
      else { const d = km(r); if (d <= raioKm) perto.push({ r, km: d }) }
    }
    const idsDentro = new Set(dentro.map(x => x.r.id))
    return {
      dentro: dentro.sort((x, y) => (x.r.dup - y.r.dup) || y.r.a - x.r.a),
      perto: perto.filter(x => !(x.r.dup && idsDentro.has(x.r.lk))).sort((x, y) => x.km - y.km).slice(0, 15)
    }
  }

  // Sugestões de áreas para um produtor do VAL: pelo nome (região toda, o município dele primeiro) e pelo ponto do
  // cadastro (quando o ponto foi marcado no mapa). Nunca vincula sozinho: o ponto pode estar na sede, num silo ou
  // na área de outro dono, e o nome pode ser de parente.
  async function sugestoes(producer, jaVinculados = new Set()) {
    const fora = x => !jaVinculados.has(x.r.id)
    const nome = buscarNome(producer.name, producer.municipality).itens.filter(fora)
    const lat = producer.lat === null || producer.lat === '' ? NaN : Number(producer.lat), lng = producer.lng === null || producer.lng === '' ? NaN : Number(producer.lng)
    // ponto aproximado (centro do município) não diz nada sobre a terra
    const temPonto = Number.isFinite(lat) && Number.isFinite(lng) && producer.locationPrecision !== 'municipality'
    const ponto = temPonto ? buscarPonto(lng, lat) : { dentro: [], perto: [] }
    const nomeFortes = nome.filter(x => x.relacao === 'nome' || x.relacao === 'parecido')
    // a melhor pista: nome completo ou parecido; senão o CAR em que o ponto cai (se não for só a sede); senão sobrenome raro
    const carNoPonto = ponto.dentro.find(x => !x.r.dup && fora(x) && (x.r.a || 0) >= 10)
    const melhor = nomeFortes[0] ? { ...nomeFortes[0], motivo: 'nome' } : carNoPonto ? { ...carNoPonto, motivo: 'ponto' } : nome[0] ? { ...nome[0], motivo: 'nome' } : null
    return { nome: nome.slice(0, 40), dentro: ponto.dentro.filter(fora), perto: ponto.perto.filter(fora), temPonto, melhor }
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
    // porte pela soma dos módulos fiscais das áreas; triagem socioambiental pelo pior imóvel
    const modulos = ids.reduce((s, id) => s + modulosDe(base.porId.get(id)), 0)
    const motivos = ids.flatMap(id => { const r = base.porId.get(id); return (r.risco?.motivos || []).map(m => ({ ...m, imovelId: id, imovel: r.nome || r.car || r.parcela || id })) })
      .sort((a, b) => NIVEIS[b.nivel] - NIVEIS[a.nivel])
    const socioambiental = { nivel: piorNivel(ids.map(id => base.porId.get(id).risco?.nivel || 'ok')), motivos, imoveisAnalisados: ids.length, camadas: base.cab.camadas || null }
    return { producerId, vinculos: links.map(l => ({ ...l, imovel: base.porId.has(l.imovelId) ? resumo(base.porId.get(l.imovelId), vinc) : null })), imoveisContados: ids.length, potencial: soma, porte: porte(modulos), socioambiental }
  }

  // Panorama do estado: por município, contagens, área do CAR, lavoura estimada, alertas e potencial do IBGE.
  // Uma passada pela base, guardada junto com ela (os vínculos entram por requisição, porque mudam).
  function panorama() {
    const b = carregar()
    if (b.panorama) return b.panorama
    const m = new Map(Object.entries(b.cab.municipios).map(([cod, nome]) => [cod, { codigoIbge: cod, municipio: nome, car: 0, sigef: 0, areaCarHa: 0, lavouraHa: 0, criticos: 0, atencao: 0 }]))
    for (const r of b.imoveis) {
      const x = m.get(r.mun); if (!x) continue
      if (r.f !== 'CAR') { x.sigef++; continue }
      x.car++; x.areaCarHa += r.a || 0; x.lavouraHa += r.lav || 0
      if (r.risco?.nivel === 'critico') x.criticos++
      else if (r.risco?.nivel === 'atencao') x.atencao++
    }
    for (const x of m.values()) {
      const mm = b.mercado[x.municipio]
      Object.assign(x, { areaCarHa: Math.round(x.areaCarHa), lavouraHa: Math.round(x.lavouraHa), lavouraVeraoHa: mm ? Math.round(mm.verao) : 0, potencialAnoBomT: mm ? arred(mm.potBom) : 0, potencialMediaT: mm ? arred(mm.potMed) : 0, moduloFiscalHa: b.moduloHa[x.codigoIbge] || null })
    }
    return (b.panorama = [...m.values()])
  }

  // Ficha do município, parte local (sem rede): território em hectares, porte, situação do CAR e o quadro
  // socioambiental somado dos imóveis (embargos, terras indígenas, unidades de conservação, supressão por ano).
  // Áreas socioambientais são as que caem DENTRO de imóveis do CAR: cadastros sobrepostos podem contar duas vezes.
  function fichaMunicipio(cod) {
    const b = carregar(), nome = b.cab.municipios[cod]
    if (!nome) return null
    b.fichas ||= new Map()
    if (b.fichas.has(cod)) return b.fichas.get(cod)
    const r1 = v => Math.round(v * 10) / 10
    const t = { car: 0, carHa: 0, consolidadaHa: 0, lavouraHa: 0, sigef: 0, sigefHa: 0, assentamentos: 0 }
    const situacao = new Map(), portes = {}, em = new Map(), ti = new Map(), uc = new Map(), desm = new Map()
    const comAlgo = { embargo: 0, ti: 0, uc: 0, supressao: 0, critico: 0, atencao: 0 }
    for (const r of b.imoveis) {
      if (r.mun !== cod) continue
      if (r.f !== 'CAR') { t.sigef++; t.sigefHa += r.a || 0; continue }
      t.car++; t.carHa += r.a || 0; t.consolidadaHa += r.ac || 0; t.lavouraHa += r.lav || 0
      if (r.tp === 'AST') t.assentamentos++
      situacao.set(r.st || 'Sem informação', (situacao.get(r.st || 'Sem informação') || 0) + 1)
      const c = porte(modulosDe(r))?.classe || 'sem'
      portes[c] ||= { imoveis: 0, areaHa: 0 }; portes[c].imoveis++; portes[c].areaHa += r.a || 0
      if (r.risco?.nivel === 'critico') comAlgo.critico++; else if (r.risco?.nivel === 'atencao') comAlgo.atencao++
      const sa = r.sa; if (!sa) continue
      if (sa.em) comAlgo.embargo++
      for (const [orgao, numero, data, ha, st, des] of sa.em || []) {
        const k = `${orgao}|${numero}`, x = em.get(k) || { orgao, numero, data, situacao: st || '', desembargado: /^(s|sim|desembargad)/i.test(String(des || '').trim()), haNosImoveis: 0, imoveis: 0 }
        x.haNosImoveis += ha; x.imoveis++; em.set(k, x)
      }
      if (sa.ti) comAlgo.ti++
      for (const [n, ha, fase] of sa.ti || []) { const x = ti.get(n) || { nome: n, fase, ha: 0, imoveis: 0 }; x.ha += ha; x.imoveis++; ti.set(n, x) }
      if (sa.uc) comAlgo.uc++
      for (const [n, ha, grupo, esfera, cat] of sa.uc || []) { const x = uc.get(n) || { nome: n, grupo, esfera, categoria: cat, ha: 0, imoveis: 0 }; x.ha += ha; x.imoveis++; uc.set(n, x) }
      if (sa.d) comAlgo.supressao++
      for (const [ano, ha] of sa.d || []) { const x = desm.get(ano) || { ano, ha: 0, imoveis: 0 }; x.ha += ha; x.imoveis++; desm.set(ano, x) }
    }
    for (const v of Object.values(portes)) v.areaHa = Math.round(v.areaHa)
    const embargos = [...em.values()].map(x => ({ ...x, haNosImoveis: r1(x.haNosImoveis) })).sort((x, y) => x.desembargado - y.desembargado || String(y.data).localeCompare(String(x.data)))
    const supressao = [...desm.values()].map(x => ({ ...x, ha: r1(x.ha) })).sort((x, y) => y.ano - x.ano)
    const somaHa = (lista, f = x => x.ha) => r1(lista.reduce((s, x) => s + f(x), 0))
    const f = {
      codigoIbge: cod, municipio: nome, moduloFiscalHa: b.moduloHa[cod] || null,
      territorio: { imoveisCar: t.car, areaCarHa: Math.round(t.carHa), areaConsolidadaHa: Math.round(t.consolidadaHa), lavouraEstimadaHa: Math.round(t.lavouraHa),
        parcelasSigef: t.sigef, areaSigefHa: Math.round(t.sigefHa), assentamentos: t.assentamentos, lavouraVeraoIbgeHa: Math.round(b.mercado[nome]?.verao || 0) },
      portes,
      situacaoCar: [...situacao].map(([situacao, imoveis]) => ({ situacao, imoveis })).sort((x, y) => y.imoveis - x.imoveis),
      socioambiental: {
        imoveisCritico: comAlgo.critico, imoveisAtencao: comAlgo.atencao,
        embargos: { imoveis: comAlgo.embargo, ativos: embargos.filter(x => !x.desembargado).length, desembargados: embargos.filter(x => x.desembargado).length, haNosImoveis: somaHa(embargos, x => x.haNosImoveis), lista: embargos.slice(0, 30) },
        terrasIndigenas: { imoveis: comAlgo.ti, lista: [...ti.values()].map(x => ({ ...x, ha: r1(x.ha) })).sort((x, y) => y.ha - x.ha) },
        unidadesConservacao: { imoveis: comAlgo.uc, lista: [...uc.values()].map(x => ({ ...x, ha: r1(x.ha) })).sort((x, y) => y.ha - x.ha) },
        supressao: { imoveis: comAlgo.supressao, depoisDe2020Ha: somaHa(supressao.filter(x => x.ano >= 2021)), de2009a2020Ha: somaHa(supressao.filter(x => x.ano >= 2009 && x.ano <= 2020)), porAno: supressao }
      },
      camadas: b.cab.camadas || null
    }
    b.fichas.set(cod, f)
    return f
  }

  // ---------------------------------------------------------------------------------------------
  // Produtores da base (camada de prospecção) e nomes ligados a cada área
  // ---------------------------------------------------------------------------------------------
  function prospectos() {
    const b = carregar()
    if (b.prospectos) return b.prospectos
    const t0 = Date.now(), emp = empresas.carregar()
    // primeiros nomes: os que mais abrem nome de sócio pessoa no CNPJ do agro no RS
    const cont = new Map(), soma = n => { const w = slugNome(n).split(' ')[0]; if (w) cont.set(w, (cont.get(w) || 0) + 1) }
    if (emp) for (const lista of Object.values(emp.socios)) for (const s of lista) if (s[1] === 'F') soma(s[0])
    const primeiros = primeirosNomes([...cont].filter(([, n]) => n >= 3).map(([w]) => w))
    // o armazém de pessoa física da CONAB (sem nome) vai para o produtor da área onde fica
    b.prospectos = montarProspectos({ imoveis: b.imoveis, armazensPF: armazensPF?.pontos || [], localizar: (lng, lat) => buscarPonto(lng, lat, 0.05).dentro.map(x => x.r), empresas: emp?.itens || [], tokens: tokensNome, primeiros })
    b.prospectos.primeiros = primeiros
    console.log(`Produtores da base: ${b.prospectos.lista.length} (${b.prospectos.lista.filter(p => p.ponto).length} com pin) em ${Date.now() - t0} ms`)
    return b.prospectos
  }
  // quem já é do VAL: área vinculada a um produtor, ou o mesmo nome no mesmo município
  async function clientes() {
    const b = carregar(), vinc = await mapaVinculos(), produtores = await store.all('producers')
    const porMun = new Map(), nomes = new Map()
    for (const p of produtores) {
      nomes.set(p.id, p.name)
      const t = tokensNome(p.name); if (t.length < 2) continue
      const cod = codigoDe(b, p.municipality); if (!porMun.has(cod)) porMun.set(cod, []); porMun.get(cod).push({ id: p.id, t })
    }
    const clienteDe = x => {
      for (const id of x.areas) { const v = vinc.get(id); if (v?.length) return { id: v[0], nome: nomes.get(v[0]) || '', por: 'área vinculada' } }
      const t = tokensNome(x.nome)
      for (const p of porMun.get(x.mun) || []) if (compararNome(p.t, t).casou.every(v => v === 1)) return { id: p.id, nome: nomes.get(p.id) || '', por: 'mesmo nome no município' }
      return null
    }
    return { vinc, nomes, clienteDe, produtores }
  }
  function resumoProspecto(p, cliente) {
    return {
      id: p.id, nome: p.nome, tipo: p.tipo, municipio: base.cab.municipios[p.mun] || '', codigoIbge: p.mun, ponto: p.ponto,
      areaHa: p.areaHa, lavouraHa: p.lavouraHa, potencialT: p.potT, armazemT: p.armazemT, areas: p.areas.length, fontes: p.fontes, risco: p.risco,
      empresas: p.empresas.map(e => ({ cnpj: formatarCnpj(e.cnpj), id: e.cnpj, razaoSocial: e.razao, capitalSocial: e.capital, grupo: GRUPOS[e.grupo] || '', socio: e.socio || '' })),
      cliente: cliente || null
    }
  }
  const lerFiltrosProspecto = (b, sp) => {
    const num = k => { const v = Number(sp.get(k)); return Number.isFinite(v) && v > 0 ? v : 0 }
    const bb = String(sp.get('bbox') || '').split(',').map(Number)
    return {
      municipios: String(sp.get('municipio') || '').split(',').map(s => s.trim()).filter(Boolean).map(m => codigoDe(b, m)),
      bbox: bb.length === 4 && bb.every(Number.isFinite) ? bb : null, tipo: ['pessoa', 'empresa'].includes(sp.get('tipo')) ? sp.get('tipo') : '',
      areaMin: num('areaMin'), potMin: num('potMin'), fonte: ['sigef', 'conab', 'cnpj'].includes(sp.get('fonte')) ? sp.get('fonte') : '',
      naoClientes: sp.get('naoClientes') === '1', soClientes: sp.get('soClientes') === '1', semCritico: sp.get('semCritico') === '1', comPonto: sp.get('comPonto') === '1',
      nome: String(sp.get('nome') || '').slice(0, 80), ordenar: String(sp.get('ordenar') || '')
    }
  }
  // distância em km entre [lng, lat] e lat/lng
  const kmEntre = (c, lat, lng) => { const dx = (c[0] - lng) * 111.32 * Math.cos(lat * Math.PI / 180), dy = (c[1] - lat) * 110.57; return Math.hypot(dx, dy) }
  function maisPerto(pontos, c, filtro = () => true) {
    let melhor = null
    for (const p of pontos) { if (!filtro(p)) continue; const d = kmEntre(c, p[0], p[1]); if (!melhor || d < melhor.km) melhor = { km: d, p } }
    return melhor
  }
  // Mais sobre um imóvel: nomes ligados à área em cadastros públicos, valor estimado da terra e armazéns perto
  async function detalheImovel(id, ctx = null) {
    const b = carregar(), r = b.porId.get(id); if (!r) return null
    const { vinc, nomes: nomesVal, clienteDe } = ctx || await clientes()
    const pros = prospectos()
    const rel = [r, ...(r.parcelas || []).map(x => b.porId.get(x)), r.lk ? b.porId.get(r.lk) : null].filter(Boolean)
    const nomes = [], vistos = new Set()
    const add = n => { const k = `${slugNome(n.nome)}|${n.fonte}`; if (n.nome && !vistos.has(k)) { vistos.add(k); nomes.push(n) } }
    for (const id2 of vinc.get(r.id) || []) add({ nome: nomesVal.get(id2) || '', fonte: 'VAL', detalhe: 'produtor do VAL com esta área vinculada', producerId: id2 })
    for (const x of rel) {
      if (x.f !== 'CAR' && x.nome) {
        const n = nomeProdutor(x.nome, pros.primeiros)
        add({ nome: n?.nome || x.nome, fonte: 'SIGEF', detalhe: `${x.id === r.id ? 'nome da parcela' : 'parcela SIGEF ligada a este imóvel'}: “${x.nome}”`, pessoa: Boolean(n), imovelId: x.id })
      }
      for (const em of x.sa?.em || []) {
        const resp = responsaveis?.itens?.[`${em[0]}|${em[1]}`]
        if (resp) add({ nome: resp.nome, fonte: 'IBAMA', detalhe: `responsável pelo embargo ${em[1]}${resp.data ? ` de ${resp.data.split('-').reverse().join('/')}` : ''}${resp.imovel ? ` (imóvel “${resp.imovel}”)` : ''}`, pessoa: resp.pessoa === 'pessoa', cnpj: resp.cnpj ? formatarCnpj(resp.cnpj) : '' })
      }
    }
    // empresas do município com o mesmo nome (razão social ou sócio)
    const comEmpresa = []
    for (const n of nomes.filter(n => n.fonte !== 'VAL').slice(0, 6)) for (const e of empresas.comNome(n.nome, r.mun, 3)) if (!comEmpresa.some(x => x.id === e.id)) comEmpresa.push({ ...e, porNome: n.nome })
    const lead = pros.porArea.get(r.id) || rel.map(x => pros.porArea.get(x.id)).find(Boolean) || null
    const vtn = estruturaDe(r.mun)?.vtn
    const valorTerra = vtn?.lavouraBoa ? { reais: Math.round((r.lav || 0) * vtn.lavouraBoa + Math.max(0, (r.a || 0) - (r.lav || 0)) * (vtn.silviculturaOuPastagemNatural || vtn.preservacao || 0)), ano: vtn.ano, lavouraBoaHa: vtn.lavouraBoa, campoHa: vtn.silviculturaOuPastagemNatural || null, informadoPor: vtn.informadoPor } : null
    const [lng, lat] = r.c
    const armEmp = maisPerto(armazensEmp, r.c), armCoop = maisPerto(armazensEmp, r.c, p => p[4] === 'coop')
    const arm = m => m && { km: Math.round(m.km * 10) / 10, nome: m.p[5] || '', capacidadeT: m.p[2], dono: m.p[4] || 'produtor', ponto: [m.p[1], m.p[0]] }
    return {
      id: r.id, nomes, empresas: comEmpresa.slice(0, 6), produtorDaBase: lead ? resumoProspecto(lead, clienteDe(lead)) : null,
      valorTerra, armazemMaisPerto: arm(armEmp), cooperativaMaisPerto: arm(armCoop),
      fontes: { embargos: responsaveis?.fonte || null, empresas: empresas.info()?.fonte || null, terra: pre.estrutura?.fontes?.vtn || null },
      aviso: 'O CAR não publica o nome do dono. Os nomes aqui são pistas de cadastros públicos ligados à área: confirme com o produtor ou a matrícula.',
      lat, lng
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Consultas da pesquisa com IA (só leitura). Saída compacta: vai para o modelo como resultado de ferramenta.
  // ---------------------------------------------------------------------------------------------
  const r1 = v => Math.round(v * 10) / 10
  function compacto(r, vinc, nomesVal) {
    const pc = porte(modulosDe(r))
    return {
      id: r.id, fonte: r.f, nome: r.nome || '', municipio: r.municipio, areaHa: r1(r.a || 0), lavouraHa: r1(r.lav || 0), potencialAnoBomT: arred(r.pot?.bom || 0),
      ...(r.f === 'CAR' ? { situacaoCar: r.st || '', tipo: r.tp || '' } : { dentroDeCar: r.dup ? r.lk : '' }), ...(r.mat ? { matricula: r.mat } : {}),
      porte: pc ? `${pc.rotulo} (${pc.modulos} MF)` : '', risco: r.risco ? { nivel: r.risco.nivel, motivo: r.risco.motivos?.[0]?.texto || '' } : { nivel: 'ok' },
      produtoresVal: (vinc.get(r.id) || []).map(id => nomesVal.get(id) || id)
    }
  }
  const lerMunicipios = (b, lista) => {
    const pedidos = (Array.isArray(lista) ? lista : lista ? [lista] : []).map(String).filter(Boolean)
    const cods = pedidos.map(m => codigoDe(b, m)), faltam = pedidos.filter((m, i) => !b.cab.municipios[cods[i]])
    return { cods: new Set(cods.filter(c => b.cab.municipios[c])), faltam }
  }
  async function filtrarImoveis(f = {}) {
    const b = carregar(), { vinc, nomes } = await clientes()
    const { cods, faltam } = lerMunicipios(b, f.municipios)
    if (faltam.length && !cods.size) return { erro: `Município fora da base (RS): ${faltam.join(', ')}` }
    const nomeQ = f.nome_contem ? tokensNome(f.nome_contem) : [], sit = f.situacao_car ? slugNome(f.situacao_car) : ''
    const perto = f.perto_de && Number.isFinite(f.perto_de.lat) && Number.isFinite(f.perto_de.lng) ? { ...f.perto_de, raio: Math.min(50, f.perto_de.raio_km || 5) } : null
    const out = []
    const soma = { areaHa: 0, lavouraHa: 0, potencialAnoBomT: 0 }
    for (const r of b.imoveis) {
      if (cods.size && !cods.has(r.mun)) continue
      if (f.fonte && f.fonte !== 'todos' && r.f !== f.fonte) continue
      if (r.dup && !f.incluir_parcelas_dentro_de_car) continue
      if (f.area_min_ha && !((r.a || 0) >= f.area_min_ha)) continue
      if (f.area_max_ha && !((r.a || 0) <= f.area_max_ha)) continue
      if (f.lavoura_min_ha && !((r.lav || 0) >= f.lavoura_min_ha)) continue
      if (f.porte && porte(modulosDe(r))?.classe !== f.porte) continue
      if (sit && !slugNome(r.st || '').includes(sit)) continue
      if (f.risco) { const n = r.risco?.nivel || 'ok'; if (f.risco === 'sem_critico' ? n === 'critico' : n !== f.risco) continue }
      if (f.vinculado_val === true && !vinc.has(r.id)) continue
      if (f.vinculado_val === false && vinc.has(r.id)) continue
      if (nomeQ.length && !compararNome(nomeQ, r.tok).casou.every(v => v > 0)) continue
      if (perto && kmEntre(r.c, perto.lat, perto.lng) > perto.raio) continue
      out.push(r); soma.areaHa += r.a || 0; soma.lavouraHa += r.lav || 0; soma.potencialAnoBomT += r.pot?.bom || 0
    }
    const ord = { area: (x, y) => (y.a || 0) - (x.a || 0), potencial: (x, y) => (y.pot?.bom || 0) - (x.pot?.bom || 0), risco: (x, y) => (NIVEIS[y.risco?.nivel || 'ok'] - NIVEIS[x.risco?.nivel || 'ok']) || (y.a || 0) - (x.a || 0) }[f.ordenar] || ((x, y) => (y.lav || 0) - (x.lav || 0))
    out.sort(ord)
    return { total: out.length, soma: { areaHa: Math.round(soma.areaHa), lavouraHa: Math.round(soma.lavouraHa), potencialAnoBomT: arred(soma.potencialAnoBomT) }, ...(faltam.length ? { municipiosNaoEncontrados: faltam } : {}),
      itens: out.slice(0, Math.min(50, f.limite || 20)).map(r => compacto(r, vinc, nomes)) }
  }
  async function buscarNomeGeral({ nome, municipio = '' }) {
    const b = carregar(), ctx = await clientes(), cod = municipio ? codigoDe(b, municipio) : ''
    const imoveis = buscarNome(nome, municipio).itens.slice(0, 15).map(x => ({ ...compacto(x.r, ctx.vinc, ctx.nomes), relacaoComONome: x.relacao }))
    const q = tokensNome(nome)
    const val = ctx.produtores.filter(p => { const c = compararNome(q, tokensNome(p.name)); return c.casou.length && c.casou.every(v => v > 0) }).slice(0, 10).map(p => ({ id: p.id, nome: p.name, municipio: p.municipality }))
    const pros = prospectos().lista.filter(p => (!cod || p.mun === cod) && compararNome(q, tokensNome(p.nome)).casou.every(v => v === 1)).slice(0, 15).map(p => resumoProspecto(p, ctx.clienteDe(p)))
    const emp = empresas.buscar({ q: nome, municipios: cod ? [cod] : [], limite: 10 })
    const emb = Object.entries(responsaveis?.itens || {}).filter(([, e]) => (!cod || e.municipio === cod) && compararNome(q, tokensNome(e.nome)).casou.every(v => v === 1)).slice(0, 10)
      .map(([k, e]) => ({ termo: k.split('|')[1], nome: e.nome, municipio: b.cab.municipios[e.municipio] || e.municipio, data: e.data, descricao: e.descricao.slice(0, 200) }))
    return { imoveisPeloNomeDaArea: imoveis, produtoresDaBase: pros, empresas: emp ? emp.itens.map(e => ({ ...e, socios: (e.socios || []).slice(0, 8) })) : 'base de empresas não carregada', produtoresVal: val, embargosIbama: emb }
  }
  function mercadoCompacto(nome) {
    const m = base.mercado[nome]; if (!m) return null
    const cu = c => ({ areaHa: Math.round(c.area), tHaAnoBom: Math.round(c.bom * 100) / 100, tHaMedia: Math.round(c.med * 100) / 100 })
    return { soja: cu(m.soja), milho: cu(m.milho), trigo: cu(m.trigo), lavouraVeraoHa: Math.round(m.verao), producaoAnoBomT: arred(m.potBom) }
  }
  async function fichaCompleta({ municipio, partes = [] }) {
    const b = carregar(), cod = codigoDe(b, municipio), nome = b.cab.municipios[cod]
    if (!nome) return { erro: `Município fora da base (RS): ${municipio}` }
    const f = fichaMunicipio(cod), sa = f.socioambiental, pros = prospectos().porMun.get(cod) || []
    const out = {
      codigoIbge: cod, municipio: nome, moduloFiscalHa: f.moduloFiscalHa, territorio: f.territorio, portes: f.portes, situacaoCar: f.situacaoCar.slice(0, 6),
      socioambiental: { imoveisCritico: sa.imoveisCritico, imoveisAtencao: sa.imoveisAtencao, embargosAtivos: sa.embargos.ativos, embargosDesembargados: sa.embargos.desembargados, terrasIndigenas: sa.terrasIndigenas.lista.slice(0, 5), unidadesConservacao: sa.unidadesConservacao.lista.slice(0, 5), supressaoDepoisDe2020Ha: sa.supressao.depoisDe2020Ha, supressao2009a2020Ha: sa.supressao.de2009a2020Ha },
      mercadoIbge: mercadoCompacto(nome), estrutura: estruturaDe(cod), empresasDoAgro: empresas.resumoMunicipio(cod),
      produtoresDaBase: { total: pros.length, comPin: pros.filter(p => p.ponto).length, pessoas: pros.filter(p => p.tipo === 'pessoa').length, empresas: pros.filter(p => p.tipo === 'empresa').length }
    }
    const g = partes.some(p => p === 'chuva' || p === 'relevo') ? await geometriaMunicipio(cod).catch(() => null) : null
    for (const p of new Set(partes)) {
      try {
        if (p === 'culturas') out.culturas = await fontes.culturas(cod)
        else if (p === 'credito') out.credito = await fontes.credito(cod)
        else if (p === 'embargos') out.embargosIbama = await fontes.embargos(cod)
        else if ((p === 'chuva' || p === 'relevo') && g) out[p] = await fontes[p](cod, g)
      } catch (e) { out[p] = { erro: e.message } }
    }
    return out
  }
  // métricas por município para ranking (mesmas fontes da ficha e do panorama)
  const METRICAS_MUN = {
    potencial_ano_bom_t: x => x.pan.potencialAnoBomT, lavoura_verao_ibge_ha: x => x.pan.lavouraVeraoHa, lavoura_estimada_car_ha: x => x.pan.lavouraHa, area_car_ha: x => x.pan.areaCarHa,
    imoveis_car: x => x.pan.car, parcelas_sigef: x => x.pan.sigef, imoveis_risco_critico: x => x.pan.criticos, imoveis_atencao: x => x.pan.atencao, imoveis_vinculados_val: x => x.vinc,
    armazem_capacidade_t: x => x.e?.armazens?.capacidadeT ?? null, armazem_sobre_producao_pct: x => (x.e?.armazens?.capacidadeT && x.pan.potencialAnoBomT ? Math.round(x.e.armazens.capacidadeT / x.pan.potencialAnoBomT * 1000) / 10 : null),
    vtn_lavoura_boa_rs_ha: x => x.e?.vtn?.lavouraBoa ?? null, bovinos: x => x.e?.pecuaria?.bovinos ?? null, leite_mil_litros: x => x.e?.pecuaria?.leiteMilLitros ?? null,
    estabelecimentos_censo_agro: x => x.e?.censo?.estab ?? null, tratores: x => x.e?.censo?.tratores ?? null, area_irrigada_ha: x => x.e?.censo?.areaIrrigadaHa ?? null,
    km_porto_rio_grande: x => x.e?.logistica?.kmPortoRioGrande ?? null, km_ferrovia: x => x.e?.logistica?.kmTrilho ?? null,
    empresas_agro: x => x.emp?.total ?? null, produtores_da_base: x => x.pros, custeio_ultima_safra_reais: x => x.custeio
  }
  async function rankingMunicipios({ metrica, ordem = 'desc', limite = 15, municipios = [] }) {
    const b = carregar(), f = METRICAS_MUN[metrica]
    if (!f) return { erro: `Métrica desconhecida. Use uma de: ${Object.keys(METRICAS_MUN).join(', ')}` }
    const { cods } = lerMunicipios(b, municipios), vincPorMun = new Map()
    for (const l of await vinculos()) { const r = b.porId.get(l.imovelId); if (r) { if (!vincPorMun.has(r.mun)) vincPorMun.set(r.mun, new Set()); vincPorMun.get(r.mun).add(r.id) } }
    const pros = prospectos(), cred = pre.credito?.itens || {}
    const ultimaSafra = Object.values(cred).flatMap(m => Object.keys(m)).sort().pop()
    const linhas = panorama().filter(p => !cods.size || cods.has(p.codigoIbge)).map(pan => {
      const x = { pan, e: estruturaDe(pan.codigoIbge), vinc: vincPorMun.get(pan.codigoIbge)?.size || 0, pros: pros.porMun.get(pan.codigoIbge)?.length || 0,
        emp: metrica === 'empresas_agro' ? empresas.resumoMunicipio(pan.codigoIbge) : null,
        custeio: metrica === 'custeio_ultima_safra_reais' ? Math.round(Object.values(cred[pan.codigoIbge]?.[ultimaSafra] || {}).reduce((s, v) => s + v[1], 0)) : null }
      return { codigoIbge: pan.codigoIbge, municipio: pan.municipio, valor: f(x), potencialAnoBomT: pan.potencialAnoBomT, lavouraVeraoHa: pan.lavouraVeraoHa }
    }).filter(l => l.valor !== null && l.valor !== undefined)
    linhas.sort((a, c) => (ordem === 'asc' ? a.valor - c.valor : c.valor - a.valor))
    return { metrica, ...(metrica === 'custeio_ultima_safra_reais' ? { safra: ultimaSafra } : {}), municipiosComDado: linhas.length, itens: linhas.slice(0, Math.min(60, limite)) }
  }
  async function buscarEmpresasIA(f = {}) {
    const b = carregar(), { cods } = lerMunicipios(b, f.municipios)
    const r = empresas.buscar({ q: f.nome || '', municipios: [...cods], grupos: f.grupos || [], capitalMin: f.capital_min || 0, cooperativa: typeof f.cooperativa === 'boolean' ? f.cooperativa : null, produz: typeof f.produz === 'boolean' ? f.produz : null, ordenar: f.ordenar || 'capital', limite: Math.min(40, f.limite || 15) })
    if (!r) return { erro: 'A base de empresas (CNPJ) ainda não foi gerada neste servidor.' }
    return { total: r.total, fonte: empresas.info()?.fonte, itens: r.itens.map(e => ({ ...e, socios: (e.socios || []).slice(0, 10) })) }
  }
  async function produtoresBaseIA(f = {}) {
    const b = carregar(), { cods } = lerMunicipios(b, f.municipios), ctx = await clientes()
    const lista = filtrarProspectos(prospectos().lista, { municipios: [...cods], tipo: f.tipo || '', areaMin: f.area_min_ha || 0, potMin: f.potencial_min_t || 0, fonte: f.fonte || '', naoClientes: f.so_nao_clientes === true, soClientes: f.so_clientes === true, semCritico: f.sem_risco_critico === true, nome: f.nome || '', ordenar: f.ordenar || '' }, { clienteDe: ctx.clienteDe })
    return { total: lista.length, comPin: lista.filter(x => x.p.ponto).length, itens: lista.slice(0, Math.min(50, f.limite || 20)).map(x => { const s = resumoProspecto(x.p, x.cliente); delete s.ponto; return s }) }
  }
  async function produtoresValIA(f = {}) {
    const b = carregar(), links = await vinculos(), produtores = await store.all('producers')
    const { cods } = lerMunicipios(b, f.municipios), q = f.nome ? tokensNome(f.nome) : []
    const nAreas = new Map(); for (const l of links) nAreas.set(l.producerId, (nAreas.get(l.producerId) || 0) + 1)
    const lista = produtores.filter(p => (!cods.size || cods.has(codigoDe(b, p.municipality))) && (!q.length || compararNome(q, tokensNome(p.name)).casou.every(v => v > 0)) && (f.sem_area_vinculada !== true || !nAreas.get(p.id)))
    return { total: lista.length, itens: lista.slice(0, Math.min(60, f.limite || 30)).map(p => ({ id: p.id, nome: p.name, municipio: p.municipality, relacionamento: p.relationship || '', consultor: p.consultant || '', areaDeclaradaHa: p.areaHa ?? null, volumeEstimado: p.estimatedVolumeT ?? null, unidade: p.volumeUnit || 't', areasVinculadas: nAreas.get(p.id) || 0 })) }
  }
  async function imovelIA({ id }) {
    const b = carregar(), r = b.porId.get(String(id)); if (!r) return { erro: 'Imóvel não encontrado.' }
    const ctx = await clientes(), d = await detalheImovel(r.id, ctx)
    return { ...compacto(r, ctx.vinc, ctx.nomes), modulosFiscais: r.mf || null, codigoCar: r.car || '', parcelaSigef: r.parcela || '', codigoIncra: r.incra || '', potencialT: { soja: arred(r.pot?.soja || 0), milho: arred(r.pot?.milho || 0), trigo: arred(r.pot?.trigo || 0) },
      motivosSocioambientais: r.risco?.motivos || [], parcelasDentro: (r.parcelas || []).length, nomesLigados: d.nomes, empresasComOMesmoNome: d.empresas, produtorDaBase: d.produtorDaBase, valorTerraEstimado: d.valorTerra, armazemMaisPerto: d.armazemMaisPerto, cooperativaMaisPerto: d.cooperativaMaisPerto }
  }
  // referências citadas na resposta da IA → dados para os chips e pins da tela
  async function referencias({ i = [], m = [], e = [], p = [], v = [] }) {
    const b = carregar(), vinc = await mapaVinculos(), ctx = p.length ? await clientes() : null, produtores = v.length ? await store.all('producers') : []
    return {
      i: Object.fromEntries(i.filter(id => b.porId.has(id)).slice(0, 200).map(id => [id, resumo(b.porId.get(id), vinc)])),
      m: Object.fromEntries(m.map(c => codigoDe(b, c)).filter(c => b.cab.municipios[c]).map(c => [c, { codigoIbge: c, municipio: b.cab.municipios[c] }])),
      e: Object.fromEntries(e.map(c => [c, empresas.porCnpj(c)]).filter(([, x]) => x).map(([c, x]) => [c, { ...x, socios: x.socios.slice(0, 6) }])),
      p: Object.fromEntries(p.map(id => prospectos().porId.get(id)).filter(Boolean).map(x => [x.id, resumoProspecto(x, ctx.clienteDe(x))])),
      v: Object.fromEntries(produtores.filter(x => v.includes(x.id)).map(x => [x.id, { id: x.id, nome: x.name, municipio: x.municipality, lat: x.lat ?? null, lng: x.lng ?? null }]))
    }
  }
  const ia = createGeoIA({ cliente: clienteIA, consultas: { filtrarImoveis, buscarNomeGeral, fichaCompleta, rankingMunicipios, buscarEmpresas: buscarEmpresasIA, produtoresBase: produtoresBaseIA, produtoresVal: produtoresValIA, imovel: imovelIA, referencias, metricas: Object.keys(METRICAS_MUN), grupos: GRUPOS } })

  // --- rotas /api/geo/... (todas exigem sessão, como o resto da API) -------------------------
  async function handle({ request, response, url, segments, json, readBody }) {
    const method = request.method, rota = segments[2] || '', id = segments[3] ? decodeURIComponent(segments[3]) : ''
    await carregarAsync()   // primeira chamada espera a carga (em partes); as demais seguem direto
    if (rota === 'status' && method === 'GET') {
      const b = carregar()
      return json(response, 200, { carregado: true, ms: b.ms, geradoEm: b.cab.geradoEm, regiao: b.cab.regiao, fontes: b.cab.fontes, contagem: b.cab.contagem, municipios: b.cab.municipios, camadas: b.cab.camadas || null })
    }
    if (rota === 'panorama' && method === 'GET') {
      const b = carregar(), vinc = new Map()
      for (const l of await vinculos()) { const r = b.porId.get(l.imovelId); if (r) { if (!vinc.has(r.mun)) vinc.set(r.mun, new Set()); vinc.get(r.mun).add(r.id) } }
      return json(response, 200, { regiao: b.cab.regiao, itens: panorama().map(x => { const e = estruturaDe(x.codigoIbge); return { ...x, imoveisVinculados: vinc.get(x.codigoIbge)?.size || 0, armazemT: e?.armazens?.capacidadeT || 0, vtnLavouraBoa: e?.vtn?.lavouraBoa || null } }) })
    }
    if (rota === 'armazens' && method === 'GET') {
      if (!armazensPontos) throw domainError('Camada de armazéns não gerada (scripts/geo-estrutura.mjs).', 503)
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=86400' })
      return response.end(armazensPontos)
    }
    // ficha do município: a parte local responde na hora; as de fora (culturas, chuva, relevo) vêm em rotas próprias
    if (rota === 'municipio' && method === 'GET' && id) {
      const b = carregar(), cod = codigoDe(b, id)
      if (!b.cab.municipios[cod]) throw domainError('Município fora da base.', 404)
      const parte = segments[4] || ''
      if (!parte) {
        const f = fichaMunicipio(cod), g = await geometriaMunicipio(cod).catch(() => null)
        const vinc = new Set(); for (const l of await vinculos()) { const r = b.porId.get(l.imovelId); if (r?.mun === cod) vinc.add(r.id) }
        const areaMun = g ? Math.round(areaHa(g)) : null
        const pan = panorama().find(x => x.codigoIbge === cod)
        const pros = prospectos().porMun.get(cod) || []
        return json(response, 200, { ...f, territorio: { ...f.territorio, areaMunicipioHa: areaMun, carSobreMunicipioPct: areaMun ? Math.round(f.territorio.areaCarHa / areaMun * 1000) / 10 : null }, imoveisVinculados: vinc.size,
          producaoAnoBomT: pan?.potencialAnoBomT || 0, estrutura: estruturaDe(cod), fontesEstrutura: pre.estrutura?.fontes || null,
          empresas: empresas.resumoMunicipio(cod), produtoresBase: { total: pros.length, comPin: pros.filter(p => p.ponto).length, pessoas: pros.filter(p => p.tipo === 'pessoa').length, empresas: pros.filter(p => p.tipo === 'empresa').length, comArmazem: pros.filter(p => p.fontes.conab).length } })
      }
      if (parte === 'culturas') return json(response, 200, await fontes.culturas(cod), { 'Cache-Control': 'private, max-age=3600' })
      if (parte === 'embargos') return json(response, 200, await fontes.embargos(cod), { 'Cache-Control': 'private, max-age=1800' })
      if (parte === 'credito') return json(response, 200, await fontes.credito(cod), { 'Cache-Control': 'private, max-age=3600' })
      if (parte === 'chuva' || parte === 'relevo') {
        const g = await geometriaMunicipio(cod).catch(() => null)
        if (!g) throw domainError('Limite do município indisponível agora.', 503)
        return json(response, 200, await fontes[parte](cod, g), { 'Cache-Control': `private, max-age=${parte === 'relevo' ? 86400 : 1800}` })
      }
      throw domainError('Parte da ficha desconhecida.', 404)
    }
    if (rota === 'municipios' && method === 'GET') {
      const b = carregar(), pan = new Map(panorama().map(x => [x.codigoIbge, x]))
      const linhas = Object.entries(b.cab.municipios).map(([cod, nome]) => {
        const m = b.mercado[nome], doMun = pan.get(cod)
        return { codigoIbge: cod, municipio: nome, imoveisCar: doMun.car, parcelasSigef: doMun.sigef,
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
    if (rota === 'imoveis' && method === 'GET' && id && segments[4] === 'detalhe') {
      const d = await detalheImovel(id); if (!d) throw domainError('Imóvel não encontrado.', 404)
      return json(response, 200, d)
    }
    // produtores da base: a camada de prospecção (pins por município, com filtros)
    if (rota === 'produtores-base' && method === 'GET' && !id) {
      const b = carregar(), f = lerFiltrosProspecto(b, url.searchParams)
      if (!f.municipios.length && !f.bbox && !f.nome) throw domainError('Escolha um município ou aproxime o mapa.', 422)
      const ctx = await clientes(), lista = filtrarProspectos(prospectos().lista, f, { clienteDe: ctx.clienteDe })
      const limite = Math.min(6000, Number(url.searchParams.get('limite') || 3000))
      return json(response, 200, { total: lista.length, comPin: lista.filter(x => x.p.ponto).length, clientes: lista.filter(x => x.cliente).length,
        fontes: { sigef: 'INCRA, SIGEF (nome da parcela)', conab: armazensPF?.fonte || null, cnpj: empresas.info()?.fonte || null }, itens: lista.slice(0, limite).map(x => resumoProspecto(x.p, x.cliente)) })
    }
    if (rota === 'produtores-base' && method === 'GET' && id) {
      const b = carregar(), p = prospectos().porId.get(id); if (!p) throw domainError('Produtor da base não encontrado.', 404)
      const ctx = await clientes()
      return json(response, 200, { ...resumoProspecto(p, ctx.clienteDe(p)), imoveis: p.areas.slice(0, 80).map(a => resumo(b.porId.get(a), ctx.vinc)), armazens: p.armazens, empresasDetalhe: p.empresas.map(e => empresas.porCnpj(e.cnpj)).filter(Boolean) })
    }
    if (rota === 'empresas' && method === 'GET') {
      const b = carregar()
      if (id) { const e = empresas.porCnpj(id); if (!e) throw domainError('Empresa não encontrada na base do agro.', 404); return json(response, 200, e) }
      const muns = String(url.searchParams.get('municipio') || '').split(',').map(s => s.trim()).filter(Boolean).map(m => codigoDe(b, m))
      const r = empresas.buscar({ q: String(url.searchParams.get('q') || '').slice(0, 80), municipios: muns, grupos: String(url.searchParams.get('grupo') || '').split(',').filter(Boolean), capitalMin: Number(url.searchParams.get('capitalMin') || 0), limite: Number(url.searchParams.get('limite') || 30) })
      if (!r) throw domainError('Base de empresas não gerada (scripts/geo-nomes.mjs --empresas).', 503)
      return json(response, 200, { ...r, fonte: empresas.info()?.fonte })
    }
    // pesquisa com IA: GET diz se está ligada; POST responde em eventos (passos e resposta final)
    if (rota === 'ia' && method === 'GET') return json(response, 200, ia.status())
    if (rota === 'ia' && method === 'POST') {
      const body = await readBody(request)
      return ia.responder(request, response, body)
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
      const res = rota === 'matricula' ? buscarMatricula(url.searchParams.get('numero') || '', municipio)
        : buscarNome(url.searchParams.get('q') || '', municipio, Number(url.searchParams.get('minimo') || 0.66), { estrito: url.searchParams.get('estrito') === '1' })
      const vinc = await mapaVinculos()
      const comGeo = url.searchParams.get('geometria') === '1'
      const itens = res.itens.map(x => (x.r ? { ...resumo(x.r, vinc), pontuacao: x.s, confianca: confianca(x.s), relacao: x.relacao, noMunicipio: x.noMunicipio } : resumo(x, vinc)))
      const soma = itens.reduce((s, i) => ({ areaHa: s.areaHa + (i.areaHa || 0), lavouraHa: s.lavouraHa + i.lavouraHa, anoBom: s.anoBom + i.potencialT.anoBom }), { areaHa: 0, lavouraHa: 0, anoBom: 0 })
      const corpo = { busca: rota === 'matricula' ? { numeros: res.numeros, municipio } : { palavras: res.tokens, municipio, sobrenomeCortado: res.sobrenomeCortado || 0 }, total: itens.length, soma: { areaHa: Math.round(soma.areaHa), lavouraHa: Math.round(soma.lavouraHa), potencialAnoBomT: arred(soma.anoBom) }, itens }
      if (!comGeo) return json(response, 200, corpo)
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      const feats = itens.slice(0, 300).map(i => `{"type":"Feature","id":${JSON.stringify(i.id)},"properties":${JSON.stringify(i)},"geometry":${base.geom.get(i.id)}}`)
      return response.end(`${JSON.stringify(corpo).slice(0, -1)},"geojson":{"type":"FeatureCollection","features":[${feats.join(',')}]}}`)
    }
    // item de sugestão: resumo do imóvel + por que apareceu
    const item = (x, vinc, motivo) => x && ({ ...resumo(x.r, vinc), relacao: x.relacao || null, pontuacao: x.s ?? null, noMunicipio: x.noMunicipio ?? null, km: x.km == null ? null : Math.round(x.km * 100) / 100, motivo: motivo || x.motivo || null })
    if (rota === 'ponto' && method === 'GET') {
      const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng')), raio = Math.min(5, Math.max(0.1, Number(url.searchParams.get('raio') || 1.5)))
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw domainError('Informe lat e lng.')
      const p = buscarPonto(lng, lat, raio), vinc = await mapaVinculos()
      return json(response, 200, { dentro: p.dentro.map(x => item(x, vinc, 'ponto')), perto: p.perto.map(x => item(x, vinc, 'perto')) })
    }
    if (rota === 'sugestoes' && method === 'GET') {
      carregar()
      const producerId = String(url.searchParams.get('producerId') || '')
      const [links, vinc] = [await vinculos(), await mapaVinculos()]
      const doProdutor = id => new Set(links.filter(l => l.producerId === id).flatMap(l => [l.imovelId, ...(base.porId.get(l.imovelId)?.parcelas || [])]))
      if (producerId) {
        const p = await store.get('producers', producerId); if (!p) throw domainError('Produtor não encontrado.', 404)
        const s = await sugestoes(p, doProdutor(producerId))
        return json(response, 200, { producerId, temPonto: s.temPonto, melhor: item(s.melhor, vinc), nome: s.nome.map(x => item(x, vinc, 'nome')), dentro: s.dentro.map(x => item(x, vinc, 'ponto')), perto: s.perto.map(x => item(x, vinc, 'perto')) })
      }
      // todos os produtores: a melhor pista de cada um, para completar o cadastro
      const produtores = (await store.all('producers')).slice(0, 1000), itens = []
      for (const p of produtores) {
        const ja = doProdutor(p.id), s = await sugestoes(p, ja)
        itens.push({ producerId: p.id, name: p.name, municipality: p.municipality, areaHa: p.areaHa ?? null, areasVinculadas: links.filter(l => l.producerId === p.id).length,
          temPonto: s.temPonto, melhor: item(s.melhor, vinc), nNome: s.nome.length, nNomeForte: s.nome.filter(x => x.relacao === 'nome' || x.relacao === 'parecido').length, nNoPonto: s.dentro.length })
      }
      return json(response, 200, { itens })
    }
    // --- relatórios ---------------------------------------------------------------------------
    if (rota === 'relatorio' && id === 'produtor' && method === 'GET') {
      const producerId = String(url.searchParams.get('producerId') || '')
      const p = await store.get('producers', producerId); if (!p) throw domainError('Produtor não encontrado.', 404)
      const b = carregar()
      const [pot, interacoes, intencoes, documentos] = await Promise.all([
        potencialProdutor(producerId), store.all('interactions'), store.all('intents'), store.files ? store.files.list(producerId) : []
      ])
      const cod = codigoDe(b, p.municipality), nomeMun = b.cab.municipios[cod] || p.municipality || ''
      const porData = (x, y) => String(y.occurredAt || y.createdAt || '').localeCompare(String(x.occurredAt || x.createdAt || ''))
      return json(response, 200, {
        geradoEm: new Date().toISOString(), base: { regiao: b.cab.regiao, geradoEm: b.cab.geradoEm, fontes: b.cab.fontes, camadas: b.cab.camadas || null },
        produtor: p, ...pot,
        municipio: { nome: nomeMun, codigoIbge: cod && cod !== '__nenhum__' ? cod : '', mercado: b.mercado[nomeMun] || null, moduloFiscalHa: b.moduloHa[cod] || null },
        interacoes: interacoes.filter(x => x.producerId === producerId).sort(porData),
        intencoes: intencoes.filter(x => x.producerId === producerId).sort(porData),
        documentos
      })
    }
    if (rota === 'relatorio' && id === 'municipio' && method === 'GET') {
      const b = carregar(), cod = codigoDe(b, String(url.searchParams.get('municipio') || ''))
      const nome = b.cab.municipios[cod]; if (!nome) throw domainError('Município fora da base de imóveis.', 404)
      const [links, vinc, produtores] = [await vinculos(), await mapaVinculos(), await store.all('producers')]
      const doMun = b.imoveis.filter(r => r.mun === cod), contam = doMun.filter(r => !r.dup)
      const vinculados = new Set(contaveis(links.map(l => l.imovelId)).filter(x => b.porId.get(x).mun === cod))
      const soma = (lista, f) => lista.reduce((s, r) => s + (f(r) || 0), 0)
      const lavouraHa = soma(contam, r => r.lav), potBom = soma(contam, r => r.pot.bom), potMed = soma(contam, r => r.pot.med)
      const lavVinc = soma([...vinculados].map(x => b.porId.get(x)), r => r.lav), potVinc = soma([...vinculados].map(x => b.porId.get(x)), r => r.pot.bom)
      // porte dos imóveis do CAR (Lei 8.629/93)
      const portes = {}
      for (const r of doMun) if (r.f === 'CAR') { const c = porte(modulosDe(r))?.classe || 'sem'; portes[c] ||= { imoveis: 0, areaHa: 0, lavouraHa: 0 }; portes[c].imoveis++; portes[c].areaHa += r.a || 0; portes[c].lavouraHa += r.lav || 0 }
      for (const v of Object.values(portes)) { v.areaHa = Math.round(v.areaHa); v.lavouraHa = Math.round(v.lavouraHa) }
      // maiores imóveis sem produtor do VAL: onde está o potencial ainda não atendido
      const oportunidades = contam.filter(r => r.f === 'CAR' && !vinc.has(r.id)).sort((x, y) => y.lav - x.lav).slice(0, 25).map(r => resumo(r, vinc))
      const comAlerta = contam.filter(r => r.risco && r.risco.nivel !== 'ok')
      const alertas = comAlerta.sort((x, y) => NIVEIS[y.risco.nivel] - NIVEIS[x.risco.nivel] || y.a - x.a).slice(0, 40).map(r => resumo(r, vinc))
      const idsProdutoresComArea = new Set(links.filter(l => vinculados.has(l.imovelId) || b.porId.get(l.imovelId)?.mun === cod).map(l => l.producerId))
      const carteira = produtores.filter(p => slugNome(p.municipality) === slugNome(nome) || idsProdutoresComArea.has(p.id))
        .map(p => ({ id: p.id, nome: p.name, municipio: p.municipality, relacionamento: p.relationship || '', consultor: p.consultant || '', areaHa: p.areaHa ?? null, volume: p.estimatedVolumeT ?? null, unidade: p.volumeUnit || 't', comArea: idsProdutoresComArea.has(p.id) }))
        .sort((x, y) => (y.areaHa || 0) - (x.areaHa || 0))
      return json(response, 200, {
        geradoEm: new Date().toISOString(), base: { regiao: b.cab.regiao, geradoEm: b.cab.geradoEm, fontes: b.cab.fontes, camadas: b.cab.camadas || null },
        municipio: { nome, codigoIbge: cod, mercado: b.mercado[nome] || null, moduloFiscalHa: b.moduloHa[cod] || null },
        imoveis: { car: doMun.filter(r => r.f === 'CAR').length, sigef: doMun.filter(r => r.f === 'SIGEF').length, carComNome: doMun.filter(r => r.f === 'CAR' && r.nome).length,
          areaCarHa: Math.round(soma(doMun.filter(r => r.f === 'CAR'), r => r.a)), lavouraHa: Math.round(lavouraHa), potencialAnoBomT: arred(potBom), potencialMediaT: arred(potMed) },
        cobertura: { imoveisVinculados: vinculados.size, lavouraHa: Math.round(lavVinc), potencialAnoBomT: arred(potVinc), percentual: potBom > 0 ? Math.round(potVinc / potBom * 1000) / 10 : 0 },
        portes, carteira, oportunidades,
        socioambiental: { critico: comAlerta.filter(r => r.risco.nivel === 'critico').length, atencao: comAlerta.filter(r => r.risco.nivel === 'atencao').length, imoveis: alertas }
      })
    }

    // --- documentos do produtor (matrícula, KML, laudos) ---------------------------------------
    if (rota === 'documentos') {
      if (!store.files) throw domainError('Armazenamento de documentos indisponível.', 501)
      if (method === 'GET' && !id) {
        const producerId = String(url.searchParams.get('producerId') || ''); if (!producerId) throw domainError('Informe o produtor.')
        return json(response, 200, { itens: await store.files.list(producerId) })
      }
      if (method === 'POST' && !id) {
        const producerId = String(url.searchParams.get('producerId') || '')
        if (!producerId || !await store.get('producers', producerId)) throw domainError('Produtor não encontrado.', 404)
        const nome = nomeArquivo(url.searchParams.get('nome')), ext = (nome.match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase() || ''
        if (!TIPOS_DOC[ext]) throw domainError(`Tipo de arquivo não aceito (.${ext || '?'}). Aceitos: ${Object.keys(TIPOS_DOC).join(', ')}.`, 415)
        const conteudo = await lerBinario(request, MAX_DOC)
        if (!conteudo.length) throw domainError('Arquivo vazio.')
        const categoria = CATEGORIAS_DOC.includes(url.searchParams.get('categoria')) ? url.searchParams.get('categoria') : 'outro'
        const descricao = String(url.searchParams.get('descricao') || '').slice(0, 200)
        return json(response, 201, await store.files.put({ producerId, nome, ext, mime: TIPOS_DOC[ext], categoria, descricao }, conteudo))
      }
      if (method === 'GET' && id) {
        const d = await store.files.get(id); if (!d) throw domainError('Documento não encontrado.', 404)
        // sempre download (nunca abre no próprio site), com o tipo da lista fechada
        response.writeHead(200, { 'Content-Type': TIPOS_DOC[d.ext] || 'application/octet-stream', 'Content-Length': d.content.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.nome)}`,
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store' })
        return response.end(d.content)
      }
      if (method === 'DELETE' && id) {
        if (!await store.files.remove(id)) throw domainError('Documento não encontrado.', 404)
        return json(response, 200, { removed: true })
      }
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

  return { handle, carregar, carregarAsync, buscarMatricula, buscarNome, buscarPonto, sugestoes, naJanela, potencialProdutor, prospectos, detalheImovel, ia,
    consultas: { filtrarImoveis, buscarNomeGeral, fichaCompleta, rankingMunicipios, buscarEmpresas: buscarEmpresasIA, produtoresBase: produtoresBaseIA, produtoresVal: produtoresValIA, imovel: imovelIA, referencias } }
}
