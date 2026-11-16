import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { normMats, tokensNome, pontuarNome, compararNome, casarPalavra, contemPonto, confianca, mercadoMunicipio, calibrar, createGeoIntel } from '../server/geo-inteligencia.js'
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
  assert.deepEqual(tokensNome('Família Seibt'), ['seibt'])                     // família, grupo, filho… não identificam
  assert.deepEqual(tokensNome('Grupo Jaeger'), ['jaeger'])
  assert.deepEqual(tokensNome('Genor Brum Filho'), ['genor', 'brum'])
})

test('grafia parecida: uma letra de diferença (duas em nomes longos), mesma inicial', () => {
  assert.equal(casarPalavra('franscisco', 'francisco'), 0.9)
  assert.equal(casarPalavra('ceolim', 'ceolin'), 0.9)
  assert.equal(casarPalavra('nicolla', 'nicola'), 0.9)
  assert.equal(casarPalavra('edel', 'edelmar'), 1)                            // prefixo continua valendo inteiro
  assert.equal(casarPalavra('silva', 'souza'), 0)
  assert.equal(casarPalavra('brum', 'bruma'), 1)
  assert.equal(casarPalavra('ivo', 'iva'), 0)                                 // palavra curta: só igual
  assert.equal(casarPalavra('backes', 'back'), 0)                             // registro 2 letras mais curto é outro nome
  assert.equal(casarPalavra('edelmar', 'edelma'), 0.9)
  const c = compararNome('Franscisco Ceolin', 'Agro S.F.A. - Francisco Vendruscolo Ceolin')
  assert.deepEqual(c.casou, [0.9, 1]); assert.equal(c.aproximado, true)
})

test('contemPonto respeita furos e multipolígonos', () => {
  const furado = { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]]] }
  assert.equal(contemPonto(furado, [2, 2]), true)
  assert.equal(contemPonto(furado, [5, 5]), false)
  assert.equal(contemPonto({ type: 'MultiPolygon', coordinates: [furado.coordinates, [[[20, 20], [20, 21], [21, 21], [21, 20], [20, 20]]]] }, [20.5, 20.5]), true)
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
    JSON.stringify({ v: 1, geradoEm: '2026-11-16', regiao: 'Teste', fontes: ['teste'], municipios: { 4318903: 'São Luiz Gonzaga', 4302501: 'Bossoroca' }, mercado: { 'São Luiz Gonzaga': MERC.Teste, Bossoroca: MERC.Teste }, contagem: { car: 3, sigef: 1 } }),
    `${JSON.stringify({ id: 'CAR:RS-4302501-CCC', f: 'CAR', car: 'RS-4302501-CCC', a: 200, ac: 180, nome: 'Fazenda Baiotto - Parcela 1', mun: '4302501', c: [-55.09, -28.59], b: [-55.1, -28.6, -55.08, -28.58] })}\t${quadrado(-55.1, -28.6, 0.02)}`,
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

test('busca por nome na região toda: município só ordena, grafia parecida e sobrenome raro', () => {
  const { file, store } = baseDeTeste()
  const geo = createGeoIntel({ dataFile: file, store, domainError })

  const outroMun = geo.buscarNome('Jose Nicola', 'Bossoroca')                           // cadastro num município, terra no vizinho
  assert.deepEqual(outroMun.itens.map(x => [x.r.id, x.relacao, x.noMunicipio]), [['CAR:RS-4318903-AAA', 'nome', false]])
  assert.equal(geo.buscarNome('Jose Nicola', 'Bossoroca', 0.66, { estrito: true }).itens.length, 0)

  assert.equal(geo.buscarNome('Jose Nicolla', '').itens[0].relacao, 'parecido')        // erro de digitação
  assert.equal(geo.buscarNome('Nicolla', '').itens.length, 0)                           // só grafia parecida, nenhuma igual: não
  const sob = geo.buscarNome('Ronei Baiotto', 'São Luiz Gonzaga')                      // só o sobrenome, e é raro
  assert.deepEqual(sob.itens.map(x => [x.r.id, x.relacao]), [['CAR:RS-4302501-CCC', 'sobrenome']])
  assert.equal(geo.buscarNome('Família Baiotto', '').itens[0].relacao, 'nome')
})

test('sugestões: áreas no ponto do cadastro e pelo nome, sem vincular sozinho', async () => {
  const { file, store, db } = baseDeTeste()
  const geo = createGeoIntel({ dataFile: file, store, domainError })

  const p = geo.buscarPonto(-54.95, -28.45)
  assert.deepEqual(p.dentro.map(x => x.r.id), ['CAR:RS-4318903-AAA', 'SIGEF:p1'])     // CAR primeiro, a parcela dentro dele depois
  assert.equal(geo.buscarPonto(-54.5, -28.0).dentro.length, 0)

  const produtor = { id: 'prod-2', name: 'Maria Baiotto', municipality: 'São Luiz Gonzaga', lat: -28.45, lng: -54.95, locationPrecision: 'exact' }
  const s = await geo.sugestoes(produtor)
  assert.equal(s.temPonto, true)
  assert.equal(s.melhor.motivo, 'ponto')                                                 // sem nome completo, a pista é o CAR do ponto
  assert.equal(s.melhor.r.id, 'CAR:RS-4318903-AAA')
  assert.deepEqual(s.nome.map(x => [x.r.id, x.relacao]), [['CAR:RS-4302501-CCC', 'sobrenome']])
  assert.equal((await geo.sugestoes({ ...produtor, locationPrecision: 'municipality' })).temPonto, false)   // ponto aproximado não conta
  assert.equal(db.geo_links.length, 0)                                                   // nada foi vinculado
})
