import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { normMats, tokensNome, pontuarNome, confianca, mercadoMunicipio, calibrar, createGeoIntel } from '../server/geo-inteligencia.js'
import { domainError } from '../server/rules.js'

test('normMats lê os formatos de matrícula do SIGEF e dos cartórios', () => {
  assert.deepEqual(normMats('16213,16807, 16809'), ['16213', '16807', '16809'])
  assert.deepEqual(normMats('R.6-0986'), ['986'])
  assert.deepEqual(normMats('AV-2/986'), ['986'])
  assert.deepEqual(normMats('12.345'), ['12345'])
  assert.deepEqual(normMats('M-1.234'), ['1234'])
  assert.deepEqual(normMats('Matrícula nº 5.678'), ['5678'])
  assert.deepEqual(normMats('0473 (R1), 2753'), ['473', '2753'])
  assert.deepEqual(normMats('5215-5350'), ['5215', '5350'])
  assert.deepEqual(normMats(' 5269 – 5394'), ['5269', '5394'])
  assert.deepEqual(normMats('33561 33562 33563'), ['33561', '33562', '33563'])
  assert.deepEqual(normMats('R.4–28905, R.1–33.391'), ['28905', '33391'])
  assert.deepEqual(normMats('Posse'), [])
})

test('tokensNome tira acentos, partículas e palavras de imóvel', () => {
  assert.deepEqual(tokensNome('Fazenda São José – Gleba 2 – João da Costa Beber'), ['sao', 'jose', 'joao', 'costa', 'beber'])
})

test('pontuarNome: todas as palavras na ordem = alta; parte = média; nada = 0', () => {
  const nome = 'José Luiz Moneiro Nicola - Campo Limpo'
  assert.equal(confianca(pontuarNome('Jose Luiz Nicola', nome)), 'alta')
  assert.equal(confianca(pontuarNome('Nicola Jose', nome)), 'média')          // fora de ordem
  assert.ok(pontuarNome('Luiz Nicola Pereira', nome) >= 0.66)                  // 2 de 3
  assert.equal(pontuarNome('Ivo Batista', nome), 0)
  assert.equal(confianca(pontuarNome('Edel Costa Beber', 'Edelmar Costa Beber')), 'alta')   // prefixo de 4+ letras
})

const MERC = { 'Teste': { soja: [800, 3, 1.8, 0.5, 0, 0, 0, 0, 0, 0], milho: [200, 9, 7, 5, 0, 0, 0, 0, 0, 0], trigo: [250, 3, 2.5, 2, 0, 0, 0, 0, 0, 0] } }

test('calibrar fecha a soma dos imóveis com a lavoura do município e não conta parcela dentro de CAR', () => {
  const m = mercadoMunicipio(MERC.Teste)
  const imoveis = [
    { id: 'CAR:A', mun: '1', a: 1000, ac: 800 },
    { id: 'CAR:B', mun: '1', a: 600, ac: 0 },
    { id: 'SIGEF:p', mun: '1', a: 300, lk: 'CAR:A' }
  ]
  calibrar(imoveis, { 1: m })
  const [A, B, P] = imoveis
  assert.equal(P.dup, true)
  assert.ok(Math.abs(P.lav - A.lav * 300 / 1000) < 1e-9)       // parcela: a parte dela na lavoura do CAR
  assert.equal(Math.round(A.lav + B.lav), 1000)                 // lavoura de verão do município (800 + 200), sem a parcela
  assert.ok(Math.abs(A.lav / B.lav - 800 / 600) < 1e-9)        // proporcional à área-base
  const esperado = 1000 * (0.8 * 3 + 0.2 * 9 + 0.25 * 3)        // soja + milho no verão + trigo de inverno
  assert.ok(Math.abs(A.pot.bom + B.pot.bom - esperado) < 1e-6)
})

function baseDeTeste() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-'))
  const quadrado = (x, y, d) => JSON.stringify({ type: 'Polygon', coordinates: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]] })
  const linhas = [
    JSON.stringify({ v: 1, geradoEm: '2026-11-16', regiao: 'Teste', fontes: ['teste'], municipios: { 4318903: 'São Luiz Gonzaga' }, mercado: { 'São Luiz Gonzaga': MERC.Teste }, contagem: { car: 2, sigef: 1 } }),
    `${JSON.stringify({ id: 'CAR:RS-4318903-AAA', f: 'CAR', car: 'RS-4318903-AAA', a: 500, ac: 400, mat: '16213; 16807', cns: '09.961-4', nome: 'José Luiz Moneiro Nicola - Campo Limpo', sig: 'p1', mun: '4318903', c: [-54.95, -28.45], b: [-54.96, -28.46, -54.94, -28.44] })}\t${quadrado(-54.96, -28.46, 0.02)}`,
    `${JSON.stringify({ id: 'SIGEF:p1', f: 'SIGEF', parcela: 'p1', a: 500, ac: 0, mat: '16213,16807', cns: '09.961-4', nome: 'José Luiz Moneiro Nicola - Campo Limpo', lk: 'CAR:RS-4318903-AAA', mun: '4318903', c: [-54.95, -28.45], b: [-54.96, -28.46, -54.94, -28.44] })}\t${quadrado(-54.96, -28.46, 0.02)}`,
    `${JSON.stringify({ id: 'CAR:RS-4318903-BBB', f: 'CAR', car: 'RS-4318903-BBB', a: 300, ac: 250, mun: '4318903', c: [-54.85, -28.35], b: [-54.86, -28.36, -54.84, -28.34] })}\t${quadrado(-54.86, -28.36, 0.02)}`
  ]
  const file = path.join(dir, 'base.ndjson.gz')
  fs.writeFileSync(file, zlib.gzipSync(linhas.join('\n')))
  const db = { producers: [{ id: 'prod-1', name: 'José Nicola' }], geo_links: [] }
  let seq = 0
  const store = {
    all: async n => db[n].map(x => ({ ...x })),
    get: async (n, id) => db[n].find(x => x.id === id) || null,
    insert: async (n, d) => { const item = { id: `l${++seq}`, ...d }; db[n].push(item); return item },
    remove: async (n, id) => { const b = db[n].length; db[n] = db[n].filter(x => x.id !== id); return db[n].length < b }
  }
  return { file, store, db }
}

test('motor: busca por matrícula, por nome e potencial pelas áreas vinculadas', async () => {
  const { file, store } = baseDeTeste()
  const geo = createGeoIntel({ dataFile: file, store, domainError })

  const porMat = geo.buscarMatricula('16.213', 'São Luiz Gonzaga')
  assert.deepEqual(porMat.itens.map(r => r.id), ['CAR:RS-4318903-AAA', 'SIGEF:p1'])   // CAR primeiro, parcela depois
  assert.equal(geo.buscarMatricula('16213', 'Bossoroca').itens.length, 0)              // outro município: não mistura cartórios

  const porNome = geo.buscarNome('jose nicola', '')
  assert.deepEqual(porNome.itens.map(x => x.r.id), ['CAR:RS-4318903-AAA'])             // a parcela dentro do CAR não repete
  assert.equal(porNome.itens[0].relacao, 'nome')
  assert.equal(geo.buscarNome('Maria Moneiro Nicola', '').itens[0].relacao, 'sobrenome') // sem o primeiro nome: parente

  assert.equal(geo.naJanela([-54.97, -28.47, -54.93, -28.43]).itens.length, 2)          // CAR + parcela na janela

  await store.insert('geo_links', { producerId: 'prod-1', imovelId: 'SIGEF:p1' })      // vínculo pela parcela
  const pot = await geo.potencialProdutor('prod-1')
  assert.equal(pot.imoveisContados, 1)                                                  // conta o CAR uma vez
  assert.ok(pot.potencial.anoBom > 0)
  assert.ok(pot.potencial.soja > pot.potencial.milho)
})
