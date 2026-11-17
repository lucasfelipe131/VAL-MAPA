import test from 'node:test'
import assert from 'node:assert/strict'
import { amostras, sobreposicaoHa, caixa, indexarCamadas, cruzarImovel, classificar, piorNivel, porte, modulosPorMunicipio } from '../server/geo-socioambiental.js'

const quadrado = (x, y, d) => ({ type: 'Polygon', coordinates: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]] })
const haQuadrado = (y, d) => d * 111.32 * Math.cos((y + d / 2) * Math.PI / 180) * d * 110.57 * 100
const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`)

test('sobreposição em hectares por amostragem: metade de um quadrado de ~108 ha', () => {
  const A = quadrado(-55, -28.5, 0.01), B = quadrado(-54.995, -28.5, 0.01)   // B cobre a metade leste de A
  const total = haQuadrado(-28.5, 0.01)
  const a = amostras(A, caixa(A))
  perto(a.pts.length * a.ha, total, total * 0.02)
  perto(sobreposicaoHa(A, caixa(A), B, caixa(B)), total / 2, total * 0.05)
  assert.equal(sobreposicaoHa(A, caixa(A), quadrado(-54, -28.5, 0.01), caixa(quadrado(-54, -28.5, 0.01))), 0)
})

test('cruzamento do imóvel com desmatamento, terra indígena, UC e embargo (polígono e ponto)', () => {
  const imovel = quadrado(-55, -28.5, 0.02)                                     // ~434 ha
  const camadas = {
    desm: [{ a: 2022, bi: 'Pampa', g: quadrado(-54.99, -28.49, 0.002) },        // ~4 ha dentro
      { a: 2015, bi: 'Mata Atlântica', g: quadrado(-54.995, -28.495, 0.002) },
      { a: 2023, bi: 'Pampa', g: quadrado(-54.5, -28.5, 0.002) }],                // longe: fora
    ti: [{ n: 'Guarita', f: 'Regularizada', g: quadrado(-54.99, -28.5, 0.03) }],  // metade leste do imóvel
    uc: [{ n: 'Parque Estadual do Turvo', gr: 'PI', es: 'estadual', g: quadrado(-55.5, -28.5, 0.01) }],   // fora
    em: [{ o: 'IBAMA', n: '123-E', d: '2019-05-02', ha: 12, p: [-54.985, -28.485] }]   // ponto dentro
  }
  const sa = cruzarImovel(imovel, indexarCamadas(camadas))
  assert.deepEqual(sa.d.map(x => [x[0], x[2]]), [[2022, 'P'], [2015, 'M']])
  perto(sa.d[0][1], haQuadrado(-28.49, 0.002), 1)
  assert.equal(sa.ti[0][0], 'Guarita'); perto(sa.ti[0][1], haQuadrado(-28.5, 0.02) / 2, 15)
  assert.equal(sa.uc, undefined)
  assert.deepEqual(sa.em[0].slice(0, 4), ['IBAMA', '123-E', '2019-05-02', 12])
  assert.equal(cruzarImovel(quadrado(-56, -29, 0.01), indexarCamadas(camadas)), null)   // nada perto: sem campo
})

test('classificação: crítico, atenção e sem alerta, com o motivo', () => {
  assert.deepEqual(classificar(null), { nivel: 'ok', motivos: [] })
  const eudr = classificar({ d: [[2022, 4.2, 'P']] })
  assert.equal(eudr.nivel, 'critico'); assert.match(eudr.motivos[0].texto, /2022.*Pampa.*EUDR/)
  assert.equal(classificar({ d: [[2015, 3, 'M']] }).nivel, 'atencao')                 // depois de 2008, antes de 2021
  assert.equal(classificar({ d: [[2022, 0.4, 'P']] }).nivel, 'ok')                     // menos de 1 ha: borda
  assert.equal(classificar({ ti: [['Guarita', 120, 'Regularizada']] }).nivel, 'critico')
  assert.equal(classificar({ ti: [['Guarita', 0.3, '']] }).nivel, 'atencao')
  assert.equal(classificar({ uc: [['Parque do Turvo', 5, 'PI', 'estadual', 'Parque']] }).nivel, 'critico')
  assert.equal(classificar({ uc: [['APA X', 50, 'US', 'federal', 'APA']] }).nivel, 'atencao')
  assert.equal(classificar({ em: [['IBAMA', '1-E', '2019-05-02', 12, 'Lavrado', '']] }).nivel, 'critico')
  assert.equal(classificar({ em: [['IBAMA', '1-E', '2019-05-02', 12, 'Lavrado', 'S']] }).nivel, 'atencao')   // desembargado
  assert.equal(classificar(null, 'Suspenso por decisão').nivel, 'atencao')
  const varios = classificar({ d: [[2015, 3, 'M']], em: [['IBAMA', '9', '', 2, '', '']] })
  assert.deepEqual(varios.motivos.map(m => m.nivel), ['critico', 'atencao'])          // pior primeiro
  assert.equal(piorNivel(['ok', 'atencao', 'ok']), 'atencao')
})

test('porte pelos módulos fiscais (Lei 8.629/93) e tamanho do módulo por município', () => {
  assert.equal(porte(0), null)
  assert.equal(porte(0.6).classe, 'minifundio')
  assert.equal(porte(4).classe, 'pequeno'); assert.match(porte(4).credito, /Pronaf/)
  assert.equal(porte(10).classe, 'medio'); assert.match(porte(10).credito, /Pronamp/)
  assert.equal(porte(15.1).classe, 'grande')
  const mods = modulosPorMunicipio([{ f: 'CAR', mun: '1', a: 40, mf: 2 }, { f: 'CAR', mun: '1', a: 100, mf: 5 }, { f: 'CAR', mun: '1', a: 60, mf: 3 }, { f: 'SIGEF', mun: '1', a: 999, mf: 1 }])
  assert.equal(mods['1'], 20)
})
