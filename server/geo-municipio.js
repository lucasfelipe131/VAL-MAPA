// VAL Geomap — ficha do município: dados de fora, buscados quando alguém abre a ficha e guardados em memória.
//   · culturas: IBGE, Produção Agrícola Municipal (SIDRA, tabela 5457), os dois anos mais recentes publicados;
//   · chuva: precipitação diária dos últimos 12 meses no centro do município e a normal de cada mês;
//   · relevo: altitude amostrada dentro do município e a declividade em classes da Embrapa.
// As contas (resumo*, areaHa, pontosDentro) são puras e testadas em test/geo-municipio.test.js.
import { contem, caixa } from './geo-socioambiental.js'

// ---------------------------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------------------------
const RAIO = 6378137   // WGS 84, metros
const rad = g => g * Math.PI / 180
const polis = g => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])
// área de um anel na esfera (m²), mesma fórmula do turf/d3
function anelM2(anel) {
  let s = 0
  for (let i = 0; i < anel.length - 1; i++) { const [x1, y1] = anel[i], [x2, y2] = anel[i + 1]; s += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2))) }
  return Math.abs(s * RAIO * RAIO / 2)
}
export const areaHa = g => polis(g).reduce((t, p) => t + anelM2(p[0] || []) - p.slice(1).reduce((h, a) => h + anelM2(a), 0), 0) / 1e4
const haCaixa = b => Math.max(0, b[2] - b[0]) * 111320 * Math.cos(rad((b[1] + b[3]) / 2)) * Math.max(0, b[3] - b[1]) * 110570 / 1e4

// ~alvo pontos numa grade regular dentro do polígono (centro das células); devolve também o passo em metros
export function pontosDentro(g, alvo = 60) {
  const b = caixa(g), area = areaHa(g)
  if (!(area > 0)) return { pts: [], passoM: 0 }
  let k = Math.max(3, Math.ceil(Math.sqrt(alvo * haCaixa(b) / area)))
  for (let tent = 0; tent < 4; tent++) {
    const dx = (b[2] - b[0]) / k, dy = (b[3] - b[1]) / k, pts = []
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const pt = [b[0] + (i + 0.5) * dx, b[1] + (j + 0.5) * dy]; if (contem(g, pt)) pts.push(pt) }
    if (pts.length >= Math.min(alvo * 0.6, 12) || tent === 3) return { pts: pts.slice(0, Math.ceil(alvo * 1.4)), passoM: Math.round(dy * 110570) }
    k = Math.ceil(k * 1.5)   // município estreito: adensa a grade
  }
}
// um ponto dentro do município perto do centro da caixa (o centro pode cair fora em município de forma irregular)
export function pontoCentral(g) {
  const b = caixa(g), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
  if (contem(g, c)) return c
  const { pts } = pontosDentro(g, 40)
  return pts.sort((p, q) => Math.hypot(p[0] - c[0], p[1] - c[1]) - Math.hypot(q[0] - c[0], q[1] - c[1]))[0] || c
}

// ---------------------------------------------------------------------------------------------
// Relevo: altitude e declividade (classes da Embrapa, Santos et al., Sistema Brasileiro de Classificação de Solos)
// Cada amostra traz a altitude do ponto e de dois vizinhos a `d` metros (leste e norte): declividade local.
// ---------------------------------------------------------------------------------------------
export const CLASSES_DECLIVIDADE = [
  { classe: 'plano', rotulo: 'Plano', ate: 3 }, { classe: 'suave', rotulo: 'Suave ondulado', ate: 8 },
  { classe: 'ondulado', rotulo: 'Ondulado', ate: 20 }, { classe: 'forte', rotulo: 'Forte ondulado', ate: 45 },
  { classe: 'montanhoso', rotulo: 'Montanhoso ou escarpado', ate: Infinity }
]
export const LIMITE_MECANIZACAO = 12   // % de declividade: até aqui a lavoura mecanizada trabalha sem restrição relevante
export function resumoRelevo(amostras) {
  const ok = (amostras || []).filter(a => Number.isFinite(a.h))
  if (!ok.length) return null
  const hs = ok.map(a => a.h).sort((x, y) => x - y)
  const decl = ok.filter(a => Number.isFinite(a.he) && Number.isFinite(a.hn) && a.d > 0).map(a => Math.hypot((a.he - a.h) / a.d, (a.hn - a.h) / a.d) * 100)
  const classes = CLASSES_DECLIVIDADE.map(c => ({ ...c, ate: Number.isFinite(c.ate) ? c.ate : null, pct: 0 }))
  for (const v of decl) { const i = CLASSES_DECLIVIDADE.findIndex(c => v < c.ate); classes[i < 0 ? classes.length - 1 : i].pct++ }
  for (const c of classes) c.pct = decl.length ? Math.round(c.pct / decl.length * 1000) / 10 : 0
  const pct = q => hs[Math.min(hs.length - 1, Math.floor(q * hs.length))]
  const media = hs.reduce((s, v) => s + v, 0) / hs.length
  const declOrd = [...decl].sort((x, y) => x - y)
  return {
    pontos: ok.length,
    altitude: { min: Math.round(hs[0]), media: Math.round(media), max: Math.round(hs[hs.length - 1]), p10: Math.round(pct(0.1)), p90: Math.round(pct(0.9)) },
    amplitudeM: Math.round(hs[hs.length - 1] - hs[0]),
    declividade: decl.length ? { mediana: Math.round(declOrd[Math.floor(declOrd.length / 2)] * 10) / 10, classes, mecanizavelPct: Math.round(decl.filter(v => v <= LIMITE_MECANIZACAO).length / decl.length * 1000) / 10 } : null
  }
}

// ---------------------------------------------------------------------------------------------
// Chuva: totais por mês (últimos 12 meses fechados + o mês corrente), comparados com a normal do mês
//   diario: [{ data: 'AAAA-MM-DD', mm }] (mm null = sem dado ainda); normal: { '01': mm do mês, … '12': … }
// ---------------------------------------------------------------------------------------------
const diasNoMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate()
export function resumoChuva(diario, normal, hoje = new Date()) {
  const porMes = new Map()
  for (const { data, mm } of diario || []) {
    const k = String(data).slice(0, 7); const x = porMes.get(k) || { mm: 0, dias: 0, diasComChuva: 0, maxDia: 0 }
    if (Number.isFinite(mm) && mm >= 0) { x.mm += mm; x.dias++; if (mm >= 1) x.diasComChuva++; if (mm > x.maxDia) x.maxDia = mm }
    porMes.set(k, x)
  }
  const meses = []
  const ano = hoje.getUTCFullYear(), mes = hoje.getUTCMonth() + 1
  for (let i = 12; i >= 0; i--) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1)), a = d.getUTCFullYear(), m = d.getUTCMonth() + 1
    const k = `${a}-${String(m).padStart(2, '0')}`, x = porMes.get(k), total = diasNoMes(a, m)
    const nm = normal?.[String(m).padStart(2, '0')]
    const completo = !!x && x.dias >= total - 1
    meses.push({ mes: k, mm: x?.dias ? Math.round(x.mm) : null, dias: x?.dias || 0, diasNoMes: total, completo, diasComChuva: x?.diasComChuva || 0, maiorChuvaDiaMm: x ? Math.round(x.maxDia) : null,
      normalMm: Number.isFinite(nm) ? Math.round(nm) : null, desvioPct: completo && Number.isFinite(nm) && nm > 0 ? Math.round((x.mm / nm - 1) * 100) : null })
  }
  const fechados = meses.filter(x => x.completo)
  const janela = n => {
    const l = fechados.slice(-n); if (l.length < n) return null
    const mm = l.reduce((s, x) => s + x.mm, 0), nm = l.every(x => x.normalMm != null) ? l.reduce((s, x) => s + x.normalMm, 0) : null
    return { meses: n, de: l[0].mes, ate: l[l.length - 1].mes, mm: Math.round(mm), normalMm: nm, desvioPct: nm ? Math.round((mm / nm - 1) * 100) : null }
  }
  const ultimoDia = (diario || []).filter(x => Number.isFinite(x.mm)).map(x => x.data).sort().pop() || null
  return { meses, ultimos3: janela(3), ultimos6: janela(6), ultimos12: janela(12), dadosAte: ultimoDia }
}

// ---------------------------------------------------------------------------------------------
// Culturas: linhas da API do SIDRA (tabela 5457) → uma linha por cultura, ano mais recente e o anterior
// ---------------------------------------------------------------------------------------------
const VAR = { 8331: 'areaPlantadaHa', 216: 'areaColhidaHa', 214: 'producao', 112: 'rendimentoKgHa', 215: 'valorMilReais' }
const numSidra = v => (/^-?\d+(\.\d+)?$/.test(String(v ?? '').trim()) ? Number(v) : null)   // "-", "...", "X" = sem dado
export function resumoCulturas(linhas) {
  const corpo = (linhas || []).filter(l => l && l.D2C && VAR[l.D2C] && /^\d{4}$/.test(String(l.D3C || '')))
  const anos = [...new Set(corpo.map(l => Number(l.D3C)))].sort((a, b) => b - a)
  if (!anos.length) return { ano: null, anoAnterior: null, itens: [] }
  const [ano, anterior] = anos
  const por = new Map()
  for (const l of corpo) {
    const nome = String(l.D4N || '').replace(/\s*\(.*?\)\s*$/, '').trim(), x = por.get(nome) || { cultura: nome, codigo: l.D4C, unidade: 'Toneladas', atual: {}, anterior: {} }
    if (String(l.D2C) === '214') x.unidade = l.MN || x.unidade
    const alvo = Number(l.D3C) === ano ? x.atual : Number(l.D3C) === anterior ? x.anterior : null
    if (alvo) alvo[VAR[l.D2C]] = numSidra(l.V)
    por.set(nome, x)
  }
  const varPct = (a, b) => (a > 0 && b > 0 ? Math.round((a / b - 1) * 1000) / 10 : null)
  const itens = [...por.values()]
    .filter(x => x.atual.areaPlantadaHa > 0 || x.atual.producao > 0 || x.anterior.areaPlantadaHa > 0)
    .map(x => ({ ...x, variacao: { areaPct: varPct(x.atual.areaPlantadaHa, x.anterior.areaPlantadaHa), producaoPct: varPct(x.atual.producao, x.anterior.producao), rendimentoPct: varPct(x.atual.rendimentoKgHa, x.anterior.rendimentoKgHa) } }))
    .sort((x, y) => (y.atual.valorMilReais || 0) - (x.atual.valorMilReais || 0) || (y.atual.areaPlantadaHa || 0) - (x.atual.areaPlantadaHa || 0))
  const total = k => itens.reduce((s, x) => s + (x.atual[k] || 0), 0)
  return { ano, anoAnterior: anterior || null, itens, totais: { areaPlantadaHa: Math.round(total('areaPlantadaHa')), areaColhidaHa: Math.round(total('areaColhidaHa')), valorMilReais: Math.round(total('valorMilReais')) } }
}

// ---------------------------------------------------------------------------------------------
// Busca nas fontes, com cache em memória (uma requisição por município e período, mesmo com vários cliques ao mesmo tempo)
// ---------------------------------------------------------------------------------------------
const UA = 'VAL-Geomap/1.0 (ficha do municipio)'
// `pre`: dados pré-calculados e embarcados com a base (relevo, crédito rural, estações do INMET), quando houver
export function createFontesMunicipio({ fetchImpl = fetch, hoje = () => new Date(), domainError = (m, s) => Object.assign(new Error(m), { status: s }), pre = {} } = {}) {
  const cache = new Map()
  function guardado(chave, ttlMs, buscar) {
    const x = cache.get(chave)
    if (x && (x.promessa || Date.now() - x.t < ttlMs)) return x.promessa || Promise.resolve(x.valor)
    const promessa = buscar().then(valor => { cache.set(chave, { t: Date.now(), valor }); return valor }, erro => { cache.delete(chave); throw erro })
    cache.set(chave, { promessa })
    return promessa
  }
  async function obter(url, { tempo = 25000, tentativas = 2 } = {}) {
    let ultimo
    for (let i = 0; i < tentativas; i++) {
      try {
        const r = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(tempo) })
        if (r.ok) return await r.json()
        ultimo = new Error(`${new URL(url).host} respondeu ${r.status}`)
        if (r.status < 500 && r.status !== 429) break
      } catch (e) { ultimo = e }
      await new Promise(ok => setTimeout(ok, 800 * (i + 1)))
    }
    throw domainError(`Fonte indisponível agora (${ultimo?.cause?.code || ultimo?.message || 'sem resposta'}). Tente de novo em instantes.`, 502)
  }
  const isoDia = d => d.toISOString().slice(0, 10)

  function culturas(cod) {
    return guardado(`culturas|${cod}`, 7 * 864e5, async () => {
      const linhas = await obter(`https://apisidra.ibge.gov.br/values/t/5457/n6/${cod}/v/8331,216,214,112,215/p/last%202/c782/allxt?formato=json`, { tempo: 40000 })
      return { fonte: 'IBGE, Produção Agrícola Municipal (PAM), tabela 5457 do SIDRA', ...resumoCulturas(linhas.slice(1)) }
    })
  }

  // Chuva: NASA POWER (domínio público, uso comercial liberado). Precipitação diária corrigida (MERRA-2/GEOS-IT,
  // grade de ~50 km) no ponto central do município e a normal mensal 2001–2025 do mesmo ponto.
  const MES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const POWER = 'https://power.larc.nasa.gov/api/temporal'
  function normalChuva([lng, lat]) {
    return guardado(`normal|${lng.toFixed(2)}|${lat.toFixed(2)}`, 30 * 864e5, async () => {
      const r = await obter(`${POWER}/climatology/point?parameters=PRECTOTCORR_SUM&community=AG&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`)
      const p = r?.properties?.parameter?.PRECTOTCORR_SUM || {}
      return { normal: Object.fromEntries(MES.map((m, i) => [String(i + 1).padStart(2, '0'), p[m] >= 0 ? p[m] : null])), periodo: String(r?.header?.range || '').match(/\d{4}\s*-\s*\w+\s*\d{4}/)?.[0] || '2001–2025' }
    })
  }
  function chuva(cod, geometria) {
    const ponto = pontoCentral(geometria)
    return guardado(`chuva|${cod}`, 6 * 36e5, async () => {
      const h = hoje(), ini = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 12, 1))
      const ymd = d => isoDia(d).replace(/-/g, '')
      const [r, n] = await Promise.all([
        obter(`${POWER}/daily/point?parameters=PRECTOTCORR&community=AG&longitude=${ponto[0].toFixed(4)}&latitude=${ponto[1].toFixed(4)}&start=${ymd(ini)}&end=${ymd(h)}&format=JSON`, { tempo: 40000 }),
        normalChuva(ponto)
      ])
      const p = r?.properties?.parameter?.PRECTOTCORR || {}
      const diario = Object.entries(p).map(([k, v]) => ({ data: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`, mm: v >= 0 ? v : null }))
      return { fonte: `NASA POWER: chuva diária estimada por satélite e modelo (MERRA-2/GEOS-IT, grade de cerca de 50 km) no centro do município; normal de ${n.periodo.replace(/\s*-\s*/, ' a ')}. Não é a medida de um pluviômetro.`, ponto: { lat: ponto[1], lng: ponto[0] }, ...resumoChuva(diario, n.normal, h) }
    })
  }

  // Relevo: OpenTopoData (SRTM de 30 m, dados públicos). Cada ponto vai com dois vizinhos a 90 m (leste e norte)
  // para a declividade local; até 100 posições por chamada e 1 chamada por segundo. O relevo não muda: cache longo.
  const VIZINHO_M = 90
  let filaTopo = Promise.resolve()
  const naFila = tarefa => (filaTopo = filaTopo.then(tarefa, tarefa))   // uma chamada por vez, respeitando o limite
  function relevo(cod, geometria) {
    if (pre.relevo?.[cod]) return Promise.resolve(pre.relevo[cod])   // pré-calculado (scripts/geo-municipios.mjs)
    return guardado(`relevo|${cod}`, 180 * 864e5, async () => {
      // município pequeno: 33 pontos (uma chamada); grande: 66 (duas)
      const grande = areaHa(geometria) > 30000
      const { pts } = pontosDentro(geometria, grande ? 60 : 30)
      const amostra = pts.slice(0, grande ? 66 : 33)
      const pos = amostra.flatMap(([x, y]) => { const dx = VIZINHO_M / (111320 * Math.cos(rad(y))), dy = VIZINHO_M / 110570; return [[y, x], [y, x + dx], [y + dy, x]] })
      const alt = []
      for (let i = 0; i < pos.length; i += 100) {
        const lote = pos.slice(i, i + 100)
        const r = await naFila(async () => { const res = await obter(`https://api.opentopodata.org/v1/srtm30m?locations=${lote.map(([la, lo]) => `${la.toFixed(5)},${lo.toFixed(5)}`).join('|')}`, { tempo: 30000, tentativas: 3 }); await new Promise(ok => setTimeout(ok, 1100)); return res })
        alt.push(...(r?.results || []).map(x => (Number.isFinite(x?.elevation) ? x.elevation : NaN)))
      }
      const amostras = amostra.map((_, i) => ({ h: alt[i * 3], he: alt[i * 3 + 1], hn: alt[i * 3 + 2], d: VIZINHO_M }))
      return { fonte: 'OpenTopoData, modelo de elevação SRTM de 30 m (NASA/USGS).', distanciaM: VIZINHO_M, ...resumoRelevo(amostras) }
    })
  }

  // Embargos do IBAMA no município inteiro (inclusive fora do CAR): camada pública do PAMGIA. Só contagem, área,
  // data, número do termo e bioma; nome, CPF/CNPJ e nome do imóvel não são pedidos nem guardados.
  const PAMGIA = 'https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/adm_embargos_ibama_a/FeatureServer/0/query'
  function embargos(cod) {
    if (!/^\d{7}$/.test(cod)) return Promise.reject(domainError('Código de município inválido.', 400))
    return guardado(`embargos|${cod}`, 12 * 36e5, async () => {
      const q = p => `${PAMGIA}?${new URLSearchParams({ where: `cod_municipio=${cod}`, f: 'json', ...p })}`
      const stats = JSON.stringify([['count', 'objectid', 'n'], ['sum', 'qtd_area_embargada', 'ha'], ['max', 'dat_embargo', 'ultimo'], ['min', 'dat_embargo', 'primeiro']].map(([statisticType, onStatisticField, outStatisticFieldName]) => ({ statisticType, onStatisticField, outStatisticFieldName })))
      const [s, l] = await Promise.all([
        obter(q({ outStatistics: stats })),
        obter(q({ outFields: 'num_tad,serie_tad,dat_embargo,qtd_area_embargada,des_tipo_bioma', returnGeometry: 'false', orderByFields: 'dat_embargo DESC', resultRecordCount: '12' }))
      ])
      if (s?.error || l?.error) throw domainError(`IBAMA: ${(s?.error || l?.error).message || 'erro na consulta'}`, 502)
      const a = s?.features?.[0]?.attributes || {}
      const data = ms => (ms ? new Date(ms).toISOString().slice(0, 10) : null)
      return {
        fonte: 'IBAMA, áreas embargadas (camada pública do PAMGIA, atualizada todo dia). Inclui embargos fora de imóveis do CAR.',
        total: Number(a.n) || 0, areaHa: Math.round((Number(a.ha) || 0) * 10) / 10, ultimo: data(a.ultimo), primeiro: data(a.primeiro),
        recentes: (l?.features || []).map(f => f.attributes).map(x => ({ numero: [x.num_tad, x.serie_tad].filter(Boolean).join('-'), data: data(x.dat_embargo), areaHa: Math.round((Number(x.qtd_area_embargada) || 0) * 10) / 10, bioma: x.des_tipo_bioma || '' }))
      }
    })
  }

  // Crédito rural: custeio do SICOR por safra (julho a junho), pré-calculado por scripts/geo-municipios.mjs --credito.
  // Comparado com a área plantada do IBGE na mesma safra (PAM do ano da colheita), quando já publicada.
  async function credito(cod) {
    const c = pre.credito; if (!c?.itens) throw domainError('Dados de crédito rural ainda não carregados no servidor.', 503)
    const m = c.itens[cod] || {}
    const pam = await culturas(cod).catch(() => null)
    const areaPam = (ano, prod) => pam?.itens?.find(x => x.cultura.toLowerCase() === prod.toLowerCase())?.[ano === pam.ano ? 'atual' : ano === pam.anoAnterior ? 'anterior' : '_']?.areaPlantadaHa || null
    const safras = Object.keys(m).sort().reverse().map(safra => {
      const anoColheita = 2000 + Number(safra.slice(-2))
      const produtos = Object.entries(m[safra]).map(([produto, [ha, valor, tipo]]) => {
        const plantada = tipo === 'a' && ha > 0 ? areaPam(anoColheita, produto) : null
        return { produto, agricola: tipo === 'a', areaHa: ha, valor, areaPlantadaIbgeHa: plantada, financiadaPct: plantada ? Math.round(ha / plantada * 1000) / 10 : null }
      }).sort((x, y) => y.valor - x.valor)
      const ag = produtos.filter(p => p.agricola)
      return { safra, anoColheita, emCurso: safra === Object.keys(m).sort().pop() && c.dadosAte < `${anoColheita}-06`, areaHa: Math.round(ag.reduce((s, p) => s + p.areaHa, 0)), valor: produtos.reduce((s, p) => s + p.valor, 0), valorPecuaria: produtos.filter(p => !p.agricola).reduce((s, p) => s + p.valor, 0), produtos }
    })
    return { fonte: c.fonte, dadosAte: c.dadosAte, geradoEm: c.geradoEm, pamAno: pam?.ano || null, safras }
  }

  return { culturas, chuva, relevo, embargos, credito, guardado, obter, isoDia, hoje, cache }
}
