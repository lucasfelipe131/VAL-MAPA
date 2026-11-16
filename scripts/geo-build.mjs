#!/usr/bin/env node
// Gera data/geo/regiao-slg.ndjson.gz, a base do motor geo (server/geo-inteligencia.js).
//
// Entradas:
//   --imoveis  dados/imoveis-regiao.js do "mapa slg cvale" (window.IMOVEIS_REGIAO = [...]), gerado por
//              ferramentas/recortar-imoveis.js a partir do CAR (GeoServer do SICAR), do SIGEF (Geoportal do INCRA)
//              e do CSV de área consolidada do SICAR, já com o cruzamento SIGEF × CAR
//   --mercado  JSON por município com soja/milho/trigo (IBGE PAM e Banco Central SICOR), formato compacto:
//              {"Município": {"soja": [área 2025, rend. ano bom, rend. médio, pior, custeio 24/25 ha, R$/ha, custeio 25/26 ha, R$/ha, jul–out/25, jul–out/26], ...}}
//
// Saída: 1ª linha = cabeçalho JSON (fontes, municípios, mercado); depois uma linha por imóvel:
//        <propriedades JSON> TAB <geometria GeoJSON>. Assim o servidor indexa as propriedades e guarda a geometria como texto.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import vm from 'node:vm'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []))
if (!args.imoveis || !args.mercado) {
  console.error('Uso: node scripts/geo-build.mjs --imoveis <imoveis-regiao.js> --mercado <mercado.json> [--saida data/geo/regiao-slg.ndjson.gz]')
  process.exit(1)
}
const saida = args.saida || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'data', 'geo', 'regiao-slg.ndjson.gz')

const ctx = { window: {} }
vm.runInNewContext(fs.readFileSync(args.imoveis, 'utf8'), ctx)
const camadas = ctx.window.IMOVEIS_REGIAO || []
const mercado = JSON.parse(fs.readFileSync(args.mercado, 'utf8'))
const cabecalhoFonte = (fs.readFileSync(args.imoveis, 'utf8').match(/^\/\*([\s\S]*?)\*\//) || [])[1]?.trim() || ''

const MUNICIPIOS = {
  '4302501': 'Bossoroca', '4303301': 'Caibaté', '4306353': 'Dezesseis de Novembro', '4308656': 'Garruchos', '4314555': 'Pirapó',
  '4315958': 'Rolador', '4317707': 'Santo Antônio das Missões', '4318903': 'São Luiz Gonzaga', '4319208': 'São Nicolau', '4319158': 'São Miguel das Missões'
}

// ponto garantidamente dentro do polígono (para o pin)
const areaAssinada = a => { let s = 0; for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += (a[j][0] - a[i][0]) * (a[j][1] + a[i][1]); return s / 2 }
function anelDentro(pt, anel) { let d = false; for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) { const [xi, yi] = anel[i], [xj, yj] = anel[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) d = !d } return d }
const polis = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
const dentro = (pt, g) => polis(g).some(p => anelDentro(pt, p[0]) && !p.slice(1).some(h => anelDentro(pt, h)))
function pontoInterno(g) {
  const p = polis(g).reduce((a, b) => (Math.abs(areaAssinada(b[0])) > Math.abs(areaAssinada(a[0])) ? b : a))
  const anel = p[0]; let A = 0, cx = 0, cy = 0
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) { const f = anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1]; A += f; cx += (anel[j][0] + anel[i][0]) * f; cy += (anel[j][1] + anel[i][1]) * f }
  const c = A ? [cx / (3 * A), cy / (3 * A)] : anel[0]
  if (dentro(c, g)) return c.map(v => Math.round(v * 1e5) / 1e5)
  const y = c[1], xs = []
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) { const [xi, yi] = anel[i], [xj, yj] = anel[j]; if ((yi > y) !== (yj > y)) xs.push((xj - xi) * (y - yi) / (yj - yi) + xi) }
  xs.sort((a, b) => a - b)
  return (xs.length >= 2 ? [(xs[0] + xs[1]) / 2, y] : c).map(v => Math.round(v * 1e5) / 1e5)
}
function bbox(g) { let b = [Infinity, Infinity, -Infinity, -Infinity]; const rec = c => { if (typeof c[0] === 'number') { b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])] } else c.forEach(rec) }; rec(g.coordinates); return b.map(v => Math.round(v * 1e5) / 1e5) }
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }

const linhas = []
let nCar = 0, nSig = 0
for (const c of camadas) {
  for (const f of c.data.features) {
    const p = f.properties || {}
    const ehCar = Boolean(p.cod_imovel), ehSig = Boolean(p.parcela_codigo || p.parcela_co)
    if (!ehCar && !ehSig) continue
    const reg = ehCar
      ? { id: `CAR:${p.cod_imovel}`, f: 'CAR', car: p.cod_imovel, a: num(p.area), ac: num(p.area_consolidada), mat: p.matriculas_sigef || '', cns: p.cns_sigef || '', nome: p.nome_area || '',
          sig: p._sigef || '', st: p.condicao || '', mf: num(p.m_fiscal), tp: p.tipo_imovel || '', dc: p.dat_criacao || '' }
      : { id: `SIGEF:${p.parcela_codigo || p.parcela_co}`, f: 'SIGEF', parcela: p.parcela_codigo || p.parcela_co, a: num(p.area_hectares ?? p.num_area), ac: 0, mat: p.registro_matricula || p.registro_m || '', cns: p.registro_cns || '',
          nome: p.nome_area || '', lk: p._car ? `CAR:${p._car}` : '', st: p.status || '', incra: p.codigo_imovel || p.codigo_imo || '', nat: p.natureza || '', dr: p.data_registro || '' }
    reg.mun = String(p._cod_ibge || '')
    if (!MUNICIPIOS[reg.mun]) continue
    reg.c = pontoInterno(f.geometry); reg.b = bbox(f.geometry)
    for (const k of Object.keys(reg)) if (reg[k] === '' || reg[k] === 0 && !['a', 'ac'].includes(k)) delete reg[k]
    linhas.push(`${JSON.stringify(reg)}\t${JSON.stringify(f.geometry)}`)
    ehCar ? nCar++ : nSig++
  }
}
const cab = {
  v: 1, geradoEm: new Date().toISOString(), regiao: 'São Luiz Gonzaga (RS) e entorno',
  fontes: [
    'CAR: GeoServer público do SICAR (camada sicar:sicar_imoveis_rs), sem cancelados',
    'Área consolidada: SICAR, base de downloads do RS (RS_AREA_CONSOLIDADA.csv)',
    'SIGEF: Geoportal do INCRA (camada geonode:sigef_geo), com matrícula, cartório (CNS) e nome da área',
    'Mercado: IBGE Produção Agrícola Municipal (tabela 1612, 2021–2025) e Banco Central SICOR (custeio)',
    cabecalhoFonte
  ].filter(Boolean),
  municipios: MUNICIPIOS, mercado, contagem: { car: nCar, sigef: nSig }
}
fs.mkdirSync(path.dirname(saida), { recursive: true })
fs.writeFileSync(saida, zlib.gzipSync(Buffer.from([JSON.stringify(cab), ...linhas].join('\n')), { level: 9 }))
console.log(`Gerado ${saida}: ${nCar} imóveis do CAR e ${nSig} parcelas SIGEF (${(fs.statSync(saida).size / 1048576).toFixed(1)} MB)`)
