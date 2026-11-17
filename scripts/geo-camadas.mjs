#!/usr/bin/env node
// Baixa as camadas socioambientais oficiais para a área da base de imóveis e grava um arquivo compacto que o
// scripts/geo-build.mjs cruza com cada imóvel (--camadas).
//
//   node scripts/geo-camadas.mjs --base data/geo/imoveis.ndjson.gz --cache <pasta> [--saida <pasta>/camadas.json.gz]
//
// Fontes (todas públicas):
//   INPE TerraBrasilis  PRODES Pampa e Mata Atlântica: supressão/desmatamento anual (desde 2009, depois do marco
//                       do Código Florestal de 22/07/2008); terras indígenas e unidades de conservação dos biomas
//   ICMBio (INDE)       embargos em unidades de conservação federais
//   IBAMA dados abertos termos de embargo (polígono ou ponto), filtrados pelos municípios da base
// Dados pessoais do embargo (nome, CPF/CNPJ, descrição) NÃO são gravados: só número, data, município, área,
// situação e geometria.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []))
if (!args.base) { console.error('Uso: node scripts/geo-camadas.mjs --base data/geo/imoveis.ndjson.gz [--cache pasta] [--saida camadas.json.gz]'); process.exit(1) }
const cache = args.cache || path.join(os.tmpdir(), 'geo-camadas')
fs.mkdirSync(cache, { recursive: true })
const saida = args.saida || path.join(cache, 'camadas.json.gz')

// --- área e municípios da base -----------------------------------------------------------------------------------
const linhas = zlib.gunzipSync(fs.readFileSync(args.base)).toString().split('\n')
const cab = JSON.parse(linhas[0])
const municipios = new Set(Object.keys(cab.municipios))
let bb = [Infinity, Infinity, -Infinity, -Infinity]
for (let i = 1; i < linhas.length; i++) {
  const tab = linhas[i].indexOf('\t'); if (tab < 0) continue
  const b = JSON.parse(linhas[i].slice(0, tab)).b
  bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])]
}
bb = [bb[0] - 0.02, bb[1] - 0.02, bb[2] + 0.02, bb[3] + 0.02].map(v => Math.round(v * 1000) / 1000)
console.log(`Base: ${municipios.size} municípios, área ${bb.join(', ')}`)

async function baixarTexto(url, tentativas = 6) {
  for (let t = 1; t <= tentativas; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(300000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.text()
    } catch (e) { console.log(`  tentativa ${t}: ${e.message}`); await new Promise(s => setTimeout(s, 5000 * t)) }
  }
  throw new Error(`falhou ${url}`)
}
// WFS 1.1.0 do GeoServer: bbox em lon/lat, páginas com startIndex (precisa de sortBy para não repetir)
async function wfs(servico, camada, ordem, { pagina = 5000 } = {}) {
  const arq = path.join(cache, `${camada.replace(/[^a-z0-9]+/gi, '_')}.json`)
  if (fs.existsSync(arq)) return JSON.parse(fs.readFileSync(arq, 'utf8'))
  const feats = []
  for (let inicio = 0; ; inicio += pagina) {
    // sem campo de ordem, uma página só (camadas pequenas: TIs, UCs); com ordem, páginas por startIndex
    const url = `${servico}?service=WFS&version=1.1.0&request=GetFeature&typeName=${camada}&outputFormat=application/json&srsName=EPSG:4326` +
      `&bbox=${bb.join(',')},EPSG:4326&maxFeatures=${ordem ? pagina : 50000}${ordem ? `&startIndex=${inicio}&sortBy=${ordem}` : ''}`
    const txt = await baixarTexto(url)
    if (txt.trimStart().startsWith('<')) throw new Error(`${camada}: ${txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}`)
    const j = JSON.parse(txt)
    feats.push(...(j.features || []))
    console.log(`  ${camada}: ${feats.length}`)
    if (!ordem || !j.features || j.features.length < pagina) break
  }
  fs.writeFileSync(arq, JSON.stringify(feats))
  return feats
}

const arred = g => JSON.parse(JSON.stringify(g, (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v)))
const INPE = 'https://terrabrasilis.dpi.inpe.br/geoserver/ows'
const out = { v: 1, geradoEm: new Date().toISOString(), bbox: bb, fontes: [], desm: [], ti: [], uc: [], em: [] }

// --- PRODES (INPE) -------------------------------------------------------------------------------------------------
for (const [ws, bioma] of [['prodes-pampa-nb', 'Pampa'], ['prodes-mata-atlantica-nb', 'Mata Atlântica']]) {
  const feats = await wfs(INPE, `${ws}:yearly_deforestation`, 'fid')
  let n = 0
  for (const f of feats) {
    const p = f.properties || {}, ano = Number(p.year)
    if (!f.geometry || !(ano >= 2009)) continue
    out.desm.push({ a: ano, bi: bioma, km: Math.round((p.area_km || 0) * 1e4) / 1e4, dt: p.image_date || '', g: arred(f.geometry) }); n++
  }
  console.log(`PRODES ${bioma}: ${n} polígonos de 2009 em diante (de ${feats.length})`)
  const tis = await wfs(INPE, `${ws}:indigenous_area_${ws === 'prodes-pampa-nb' ? 'pampa' : 'mata_atlantica'}_biome`, '')
  for (const f of tis) if (f.geometry) out.ti.push({ id: f.properties.terrai_cod, n: f.properties.terrai_nom, e: f.properties.etnia_nome, f: f.properties.fase_ti, g: arred(f.geometry) })
  const ucs = await wfs(INPE, `${ws}:conservation_units_${ws === 'prodes-pampa-nb' ? 'pampa' : 'mata_atlantica'}_biome`, '')
  for (const f of ucs) if (f.geometry) out.uc.push({ id: f.properties.id, n: f.properties.nome, c: f.properties.categoria, gr: f.properties.grupo, es: f.properties.esfera, g: arred(f.geometry) })
}
// mesma TI/UC pode vir nos dois biomas: fica a primeira
const unicos = lista => [...new Map(lista.map(x => [`${x.id}|${x.n}`, x])).values()]
out.ti = unicos(out.ti); out.uc = unicos(out.uc)
out.fontes.push('INPE TerraBrasilis: PRODES Pampa e Mata Atlântica (desmatamento/supressão anual, 2009+), terras indígenas e unidades de conservação dos biomas')

// --- embargos ICMBio ------------------------------------------------------------------------------------------------
const icm = await wfs('https://geoservicos.inde.gov.br/geoserver/ICMBio/ows', 'ICMBio:embargos_icmbio', 'ogc_fid')
for (const f of icm) {
  const p = f.properties || {}
  if (!f.geometry) continue
  out.em.push({ o: 'ICMBio', n: `${p.numero_emb || ''}${p.serie ? '-' + p.serie : ''}`, d: String(p.data || '').slice(0, 10), uc: p.nome_uc || '', st: p.situacao || '', g: arred(f.geometry) })
}
out.fontes.push('ICMBio: embargos em unidades de conservação federais (INDE)')

// --- embargos IBAMA (dados abertos, CSV nacional) ---------------------------------------------------------------------
const csv = path.join(cache, 'ibama_termo_de_embargo.csv')
if (!fs.existsSync(csv)) {
  console.log('IBAMA: baixando termos de embargo (CSV nacional, ~200 MB)…')
  const r = await fetch('https://stibamadadosabertosprd.blob.core.windows.net/dados-abertos/dados/TERMOS_DE_EMBARGO/TERMO_EMBARGO/termo_de_embargo.csv', { signal: AbortSignal.timeout(1800000) })
  if (!r.ok) throw new Error(`IBAMA HTTP ${r.status}`)
  fs.writeFileSync(csv + '.tmp', Buffer.from(await r.arrayBuffer())); fs.renameSync(csv + '.tmp', csv)
}
// CSV com ; e aspas (campos podem ter quebra de linha dentro das aspas)
async function* linhasCsv(arq) {
  const rl = readline.createInterface({ input: fs.createReadStream(arq, 'utf8'), crlfDelay: Infinity })
  let campos = [], atual = '', aspas = false
  for await (let linha of rl) {
    if (!campos.length && !atual && !aspas) linha = linha.replace(/^﻿/, '')
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i]
      if (aspas) {
        if (ch === '"') { if (linha[i + 1] === '"') { atual += '"'; i++ } else aspas = false }
        else atual += ch
      } else if (ch === '"') aspas = true
      else if (ch === ';') { campos.push(atual); atual = '' }
      else atual += ch
    }
    if (aspas) { atual += '\n'; continue }
    campos.push(atual); yield campos; campos = []; atual = ''
  }
}
// WKT (POLYGON / MULTIPOLYGON) → GeoJSON
function wkt(s) {
  s = String(s || '').trim()
  const tipo = (s.match(/^(MULTIPOLYGON|POLYGON)/i) || [])[1]?.toUpperCase()
  if (!tipo) return null
  const corpo = s.slice(s.indexOf('('))
  const anel = t => t.split(',').map(par => par.trim().split(/\s+/).slice(0, 2).map(Number)).filter(c => c.every(Number.isFinite))
  const poligono = t => t.replace(/^\(|\)$/g, '').split(/\)\s*,\s*\(/).map(r => anel(r.replace(/[()]/g, '')))
  if (tipo === 'POLYGON') return { type: 'Polygon', coordinates: poligono(corpo.slice(1, -1)) }
  return { type: 'MultiPolygon', coordinates: corpo.slice(1, -1).split(/\)\)\s*,\s*\(\(/).map(p => poligono(p.replace(/^\(+|\)+$/g, ''))) }
}
const numBr = v => { const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
let cabCsv = null, lidos = 0, noRecorte = 0
for await (const c of linhasCsv(csv)) {
  if (!cabCsv) { cabCsv = Object.fromEntries(c.map((n, i) => [n, i])); continue }
  lidos++
  const v = k => c[cabCsv[k]] ?? ''
  if (!municipios.has(v('COD_MUNICIPIO'))) continue
  if (v('SIT_CANCELADO') === 'S') continue
  const g = wkt(v('GEOM_AREA_EMBARGADA'))
  const coord = s => parseFloat(String(s || '').replace(',', '.'))   // coordenadas vêm com ponto decimal
  const lon = coord(v('NUM_LONGITUDE_TAD')), lat = coord(v('NUM_LATITUDE_TAD'))
  const ponto = Number.isFinite(lon) && Number.isFinite(lat) && lon && lat ? [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] : null
  if (!g && !ponto) continue
  out.em.push({
    o: 'IBAMA', n: `${v('NUM_TAD')}${v('SER_TAD') ? '-' + v('SER_TAD') : ''}`, d: v('DAT_EMBARGO').slice(0, 10), mun: v('COD_MUNICIPIO'),
    ha: numBr(v('QTD_AREA_EMBARGADA')), st: v('DES_STATUS_FORMULARIO'), des: v('SIT_DESEMBARGO'), dtDes: v('DAT_DESEMBARGO').slice(0, 10),
    ...(g ? { g: arred(g) } : { p: ponto })
  })
  noRecorte++
}
out.fontes.push(`IBAMA dados abertos: termos de embargo (${noRecorte} nos municípios da base, de ${lidos} no país)`)
console.log(`IBAMA: ${noRecorte} embargos nos municípios da base (de ${lidos})`)

fs.writeFileSync(saida, zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 }))
console.log(`Gerado ${saida}: ${out.desm.length} desmatamentos, ${out.ti.length} TIs, ${out.uc.length} UCs, ${out.em.length} embargos (${(fs.statSync(saida).size / 1048576).toFixed(1)} MB)`)
