// VAL Geomap — análise socioambiental e porte dos imóveis rurais. Funções puras (testadas em
// test/geo-socioambiental.test.js), usadas pelo scripts/geo-build.mjs (cruzamento) e pelo servidor (classificação).
//
// É uma TRIAGEM automática com dados públicos, para orientar a compra de grãos: não substitui a análise
// documental (CAR, matrícula, licenças, certidões) nem consulta às listas oficiais no dia da negociação.

// ---------------------------------------------------------------------------------------------
// Geometria (graus, SIRGAS 2000/WGS 84)
// ---------------------------------------------------------------------------------------------
const polis = g => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])
function anelContem(pt, anel) { let d = false; for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) { const [xi, yi] = anel[i], [xj, yj] = anel[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) d = !d } return d }
export const contem = (g, pt) => polis(g).some(p => p[0] && anelContem(pt, p[0]) && !p.slice(1).some(h => anelContem(pt, h)))
export function caixa(g) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of polis(g)) for (const anel of p) for (const [x, y] of anel) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y }
  return b
}
const cruzam = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
// hectares de um retângulo em graus, na latitude dele
const haDaCaixa = b => Math.max(0, b[2] - b[0]) * 111.32 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180) * Math.max(0, b[3] - b[1]) * 110.57 * 100

// Pontos de uma grade dentro do polígono, cada um valendo `ha` hectares. Célula ~ alvoHa, no máximo max×max pontos.
export function amostras(g, b = caixa(g), { alvoHa = 0.1, max = 60 } = {}) {
  const area = haDaCaixa(b)
  if (!(area > 0)) return { pts: [], ha: 0 }
  const n = Math.max(4, Math.min(max, Math.ceil(Math.sqrt(area / alvoHa))))
  const dx = (b[2] - b[0]) / n, dy = (b[3] - b[1]) / n, pts = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const pt = [b[0] + (i + 0.5) * dx, b[1] + (j + 0.5) * dy]
    if (contem(g, pt)) pts.push(pt)
  }
  return { pts, ha: area / (n * n) }
}
// Hectares de sobreposição entre dois polígonos: amostra o menor e conta quantos pontos caem no outro.
export function sobreposicaoHa(gA, bA, gB, bB, cacheA) {
  if (!cruzam(bA, bB)) return 0
  const aMenor = haDaCaixa(bA) <= haDaCaixa(bB)
  const amostra = aMenor ? (cacheA || amostras(gA, bA)) : amostras(gB, bB)
  const outro = aMenor ? gB : gA, bo = aMenor ? bB : bA
  let n = 0
  for (const pt of amostra.pts) if (pt[0] >= bo[0] && pt[0] <= bo[2] && pt[1] >= bo[1] && pt[1] <= bo[3] && contem(outro, pt)) n++
  return n * amostra.ha
}

// ---------------------------------------------------------------------------------------------
// Cruzamento imóveis × camadas (feito no build). Resultado compacto por imóvel:
//   d  [[ano, ha, bioma]]               supressão/desmatamento PRODES (INPE)
//   ti [[nome, ha, fase]]                terra indígena
//   uc [[nome, ha, grupo, esfera, cat]]  unidade de conservação (grupo PI = proteção integral, US = uso sustentável)
//   em [[órgão, número, data, ha, situação, desembargo]]  embargo IBAMA/ICMBio
// ---------------------------------------------------------------------------------------------
const MIN_HA = 0.1
const r1 = v => Math.round(v * 10) / 10
export function indexarCamadas(camadas, celula = 0.05) {
  const itens = []
  const add = (tipo, x) => { const g = x.g || null; const b = g ? caixa(g) : [x.p[0], x.p[1], x.p[0], x.p[1]]; itens.push({ tipo, x, g, b }) }
  for (const x of camadas.desm || []) add('d', x)
  for (const x of camadas.ti || []) add('ti', x)
  for (const x of camadas.uc || []) add('uc', x)
  for (const x of camadas.em || []) if (x.g || x.p) add('em', x)
  const grade = new Map()
  for (const it of itens) {
    for (let i = Math.floor(it.b[0] / celula); i <= Math.floor(it.b[2] / celula); i++)
      for (let j = Math.floor(it.b[1] / celula); j <= Math.floor(it.b[3] / celula); j++) {
        const k = `${i}|${j}`; if (!grade.has(k)) grade.set(k, []); grade.get(k).push(it)
      }
  }
  return { grade, celula, total: itens.length }
}
export function cruzarImovel(g, idx, b = caixa(g)) {
  const vistos = new Set(), sa = {}
  let cache = null
  const amostraImovel = () => (cache ||= amostras(g, b))
  for (let i = Math.floor(b[0] / idx.celula); i <= Math.floor(b[2] / idx.celula); i++)
    for (let j = Math.floor(b[1] / idx.celula); j <= Math.floor(b[3] / idx.celula); j++)
      for (const it of idx.grade.get(`${i}|${j}`) || []) {
        if (vistos.has(it) || !cruzam(b, it.b)) continue
        vistos.add(it)
        const x = it.x
        let ha
        if (it.g) {
          // amostra do imóvel reaproveitada quando o imóvel é o menor dos dois
          ha = haDaCaixa(b) <= haDaCaixa(it.b) ? sobreposicaoHa(g, b, it.g, it.b, amostraImovel()) : sobreposicaoHa(g, b, it.g, it.b)
        } else ha = contem(g, x.p) ? (x.ha || 0) || MIN_HA : 0   // embargo só com ponto: conta se o ponto cai no imóvel
        if (ha < MIN_HA) continue
        if (it.tipo === 'd') (sa.d ||= []).push([x.a, r1(ha), x.bi === 'Pampa' ? 'P' : 'M'])
        else if (it.tipo === 'ti') (sa.ti ||= []).push([x.n, r1(ha), x.f || ''])
        else if (it.tipo === 'uc') (sa.uc ||= []).push([x.n, r1(ha), x.gr || '', x.es || '', x.c || ''])
        else (sa.em ||= []).push([x.o, x.n, x.d || '', r1(ha), x.st || '', x.des || ''])
      }
  if (sa.d) sa.d.sort((a, c) => c[0] - a[0] || c[1] - a[1])
  return Object.keys(sa).length ? sa : null
}

// ---------------------------------------------------------------------------------------------
// Classificação: crítico > atenção > sem alerta. Cada motivo diz o porquê, com a fonte.
// ---------------------------------------------------------------------------------------------
export const NIVEIS = { critico: 2, atencao: 1, ok: 0 }
export const CORTE_EUDR = 2021        // PRODES ano ≥ 2021: depois de 31/12/2020, data de corte do regulamento europeu (EUDR)
const CORTE_CODIGO_FLORESTAL = 2009   // PRODES ano ≥ 2009: depois de 22/07/2008, marco do Código Florestal
const RELEVANTE_HA = 1                // abaixo disso, borda de mapeamento: vira atenção, não crítico
const desembargado = s => /^(s|sim|desembargad)/i.test(String(s || '').trim())
const fmtHa = v => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha`
export function classificar(sa, situacaoCar = '') {
  const motivos = []
  const add = (nivel, texto, fonte) => motivos.push({ nivel, texto, fonte })
  for (const [orgao, num, data, ha, st, des] of sa?.em || []) {
    if (desembargado(des)) add('atencao', `Embargo ${orgao} nº ${num}${data ? ` de ${data.split('-').reverse().join('/')}` : ''} já desembargado (${fmtHa(ha)} no imóvel)`, orgao)
    else add('critico', `Embargo ${orgao} nº ${num}${data ? ` de ${data.split('-').reverse().join('/')}` : ''}${st ? ` (${st.toLowerCase()})` : ''} sobre ${fmtHa(ha)} do imóvel`, orgao)
  }
  for (const [nome, ha, fase] of sa?.ti || []) {
    if (ha >= RELEVANTE_HA) add('critico', `Sobrepõe a Terra Indígena ${nome}${fase ? ` (${fase.toLowerCase()})` : ''} em ${fmtHa(ha)}`, 'FUNAI/INPE')
    else add('atencao', `Encosta na Terra Indígena ${nome} (${fmtHa(ha)}, provável diferença de limite)`, 'FUNAI/INPE')
  }
  for (const [nome, ha, grupo, esfera] of sa?.uc || []) {
    const pi = String(grupo).toUpperCase() === 'PI'
    if (pi && ha >= RELEVANTE_HA) add('critico', `Dentro de unidade de conservação de proteção integral: ${nome}${esfera ? ` (${esfera})` : ''}, ${fmtHa(ha)}`, 'CNUC/INPE')
    else add('atencao', `Sobrepõe a unidade de conservação ${nome}${pi ? ' (proteção integral)' : ' (uso sustentável)'} em ${fmtHa(ha)}`, 'CNUC/INPE')
  }
  // desmatamento: soma por ano
  const porAno = new Map()
  for (const [ano, ha, bioma] of sa?.d || []) porAno.set(ano, { ha: (porAno.get(ano)?.ha || 0) + ha, bioma: bioma === 'P' ? 'Pampa' : 'Mata Atlântica' })
  for (const [ano, { ha, bioma }] of [...porAno].sort((a, b) => b[0] - a[0])) {
    if (ha < RELEVANTE_HA) continue
    if (ano >= CORTE_EUDR) add('critico', `Supressão de vegetação nativa em ${ano} (${bioma}): ${fmtHa(ha)} no imóvel, depois de 31/12/2020 (corte do EUDR)`, 'INPE PRODES')
    else if (ano >= CORTE_CODIGO_FLORESTAL) add('atencao', `Supressão de vegetação nativa em ${ano} (${bioma}): ${fmtHa(ha)}, depois do marco de 22/07/2008 do Código Florestal; confirmar autorização`, 'INPE PRODES')
  }
  const st = String(situacaoCar || '')
  if (/suspens/i.test(st)) add('atencao', `CAR suspenso (${st})`, 'SICAR')
  const nivel = motivos.reduce((m, x) => (NIVEIS[x.nivel] > NIVEIS[m] ? x.nivel : m), 'ok')
  motivos.sort((a, b) => NIVEIS[b.nivel] - NIVEIS[a.nivel])
  return { nivel, motivos }
}
// Pior nível entre vários imóveis (para o produtor)
export const piorNivel = lista => lista.reduce((m, n) => (NIVEIS[n] > NIVEIS[m] ? n : m), 'ok')

// ---------------------------------------------------------------------------------------------
// Porte pela Lei 8.629/93: minifúndio < 1 módulo fiscal; pequena 1–4; média 4–15; grande > 15.
// O enquadramento no crédito rural depende também da renda bruta (Pronaf, Pronamp): aqui é só o perfil pela área.
// ---------------------------------------------------------------------------------------------
export function porte(modulos) {
  if (!(modulos > 0)) return null
  const mf = Math.round(modulos * 10) / 10
  if (modulos < 1) return { classe: 'minifundio', rotulo: 'Minifúndio', modulos: mf, credito: 'Perfil Pronaf (confirmar renda bruta)' }
  if (modulos <= 4) return { classe: 'pequeno', rotulo: 'Pequeno produtor', modulos: mf, credito: 'Perfil Pronaf (confirmar renda bruta)' }
  if (modulos <= 15) return { classe: 'medio', rotulo: 'Médio produtor', modulos: mf, credito: 'Perfil Pronamp (confirmar renda bruta)' }
  return { classe: 'grande', rotulo: 'Grande produtor', modulos: mf, credito: 'Crédito rural de demais produtores (sem Pronaf/Pronamp)' }
}
// Tamanho do módulo fiscal (ha) por município, pela mediana área ÷ módulos dos imóveis do CAR
export function modulosPorMunicipio(imoveis) {
  const lista = new Map()
  for (const r of imoveis) if (r.f === 'CAR' && r.mf > 0 && r.a > 0) { if (!lista.has(r.mun)) lista.set(r.mun, []); lista.get(r.mun).push(r.a / r.mf) }
  const out = {}
  for (const [mun, v] of lista) { v.sort((a, b) => a - b); out[mun] = Math.round(v[Math.floor(v.length / 2)] * 10) / 10 }
  return out
}
