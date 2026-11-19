import test from 'node:test'
import assert from 'node:assert/strict'
import { areaHa, pontosDentro, pontoCentral, resumoRelevo, resumoChuva, resumoCulturas } from '../server/geo-municipio.js'

const quadrado = (x, y, d) => ({ type: 'Polygon', coordinates: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]] })

test('área do município na esfera, com furo descontado', () => {
  const g = quadrado(-54, -28.7, 0.1)
  const esperado = 0.1 * 111.32 * Math.cos(28.65 * Math.PI / 180) * 0.1 * 110.57 * 100   // km² → ha, aproximação plana
  assert.ok(Math.abs(areaHa(g) / esperado - 1) < 0.01, `${areaHa(g)} vs ${esperado}`)
  const comFuro = { type: 'Polygon', coordinates: [quadrado(-54, -28.7, 0.1).coordinates[0], quadrado(-53.97, -28.67, 0.04).coordinates[0]] }
  assert.ok(Math.abs(areaHa(comFuro) - areaHa(g) * (1 - 0.16)) / areaHa(g) < 0.01)
  assert.equal(areaHa(null), 0)
})

test('amostra em grade dentro do polígono e um ponto central que cai dentro', () => {
  const g = quadrado(-54, -28.7, 0.2)
  const { pts, passoM } = pontosDentro(g, 60)
  assert.ok(pts.length >= 36 && pts.length <= 84, `${pts.length} pontos`)
  assert.ok(pts.every(([x, y]) => x > -54 && x < -53.8 && y > -28.7 && y < -28.5))
  assert.ok(passoM > 1000 && passoM < 5000)
  // em "L": o centro da caixa cai fora, o ponto central não
  const ele = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [0.2, 1], [0.2, 0.2], [1, 0.2], [1, 0], [0, 0]]] }
  const [x, y] = pontoCentral(ele)
  assert.ok((x <= 0.2 && y <= 1) || (y <= 0.2 && x <= 1))
})

test('relevo: altitudes, declividade em classes da Embrapa e área mecanizável', () => {
  const d = 100
  const plano = Array.from({ length: 6 }, (_, i) => ({ h: 400 + i, he: 400 + i + 1, hn: 400 + i, d }))      // 1%
  const forte = Array.from({ length: 4 }, (_, i) => ({ h: 600 + i * 10, he: 630 + i * 10, hn: 600 + i * 10, d }))   // 30%
  const r = resumoRelevo([...plano, ...forte, { h: NaN }])
  assert.equal(r.pontos, 10)
  assert.deepEqual([r.altitude.min, r.altitude.max], [400, 630])
  assert.equal(r.amplitudeM, 230)
  const cl = Object.fromEntries(r.declividade.classes.map(c => [c.classe, c.pct]))
  assert.equal(cl.plano, 60); assert.equal(cl.forte, 40); assert.equal(cl.montanhoso, 0)
  assert.equal(r.declividade.mecanizavelPct, 60)
  assert.equal(resumoRelevo([]), null)
})

test('chuva: total por mês, mês em curso parcial, desvio da normal e janelas de 3, 6 e 12 meses', () => {
  const hoje = new Date(Date.UTC(2026, 10, 19))   // 19/11/2026
  const diario = []
  for (let d = new Date(Date.UTC(2025, 9, 1)); d < hoje; d = new Date(d.getTime() + 864e5)) {
    const iso = d.toISOString().slice(0, 10)
    diario.push({ data: iso, mm: iso >= '2026-11-15' ? null : iso.startsWith('2026-08') ? 1 : 4 })   // agosto seco; últimos dias ainda sem dado
  }
  const normal = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), 120]))
  const r = resumoChuva(diario, normal, hoje)
  assert.equal(r.meses.length, 13)
  assert.equal(r.meses[0].mes, '2025-11'); assert.equal(r.meses[12].mes, '2026-11')
  const ago = r.meses.find(x => x.mes === '2026-08')
  assert.equal(ago.mm, 31); assert.equal(ago.desvioPct, -74); assert.equal(ago.completo, true)
  const nov = r.meses[12]
  assert.equal(nov.completo, false); assert.equal(nov.desvioPct, null); assert.equal(nov.dias, 14)
  assert.equal(r.ultimos3.ate, '2026-10'); assert.equal(r.ultimos3.mm, 31 + 30 * 4 + 31 * 4)
  assert.equal(r.ultimos12.meses, 12); assert.equal(r.ultimos12.normalMm, 1440)
  assert.equal(r.dadosAte, '2026-11-14')
})

test('culturas do SIDRA: ano mais recente, variação contra o anterior e sem dado ("-", "...")', () => {
  const l = (v, ano, prod, val, un = 'Hectares') => ({ D1C: '4306106', D2C: String(v), D3C: String(ano), D4C: prod === 'Soja (em grão)' ? '40124' : '40122', D4N: prod, MN: un, V: val })
  const linhas = [
    l(8331, 2025, 'Soja (em grão)', '94400'), l(214, 2025, 'Soja (em grão)', '225540', 'Toneladas'), l(112, 2025, 'Soja (em grão)', '2389', 'Quilogramas por Hectare'), l(215, 2025, 'Soja (em grão)', '477243', 'Mil Reais'),
    l(8331, 2024, 'Soja (em grão)', '92400'), l(112, 2024, 'Soja (em grão)', '3670', 'Quilogramas por Hectare'),
    l(8331, 2025, 'Milho (em grão)', '8000'), l(215, 2025, 'Milho (em grão)', '104458', 'Mil Reais'),
    l(8331, 2025, 'Abacaxi', '-'), l(214, 2025, 'Abacaxi', '...', 'Mil frutos')
  ]
  const r = resumoCulturas(linhas)
  assert.equal(r.ano, 2025); assert.equal(r.anoAnterior, 2024)
  assert.deepEqual(r.itens.map(x => x.cultura), ['Soja', 'Milho'])
  const soja = r.itens[0]
  assert.equal(soja.atual.rendimentoKgHa, 2389); assert.equal(soja.variacao.rendimentoPct, -34.9); assert.equal(soja.variacao.areaPct, 2.2)
  assert.equal(r.totais.areaPlantadaHa, 102400); assert.equal(r.totais.valorMilReais, 581701)
  assert.deepEqual(resumoCulturas([]), { ano: null, anoAnterior: null, itens: [] })
})

import { createFontesMunicipio } from '../server/geo-municipio.js'
const resposta = corpo => ({ ok: true, status: 200, json: async () => corpo })

test('embargos do IBAMA no município: contagem, área e os mais recentes, sem dado pessoal', async () => {
  const urls = []
  const fetchImpl = async url => {
    urls.push(decodeURIComponent(String(url)))
    return /outStatistics/.test(String(url))
      ? resposta({ features: [{ attributes: { n: 3, ha: 12.34, ultimo: Date.UTC(2026, 9, 2), primeiro: Date.UTC(2014, 0, 5) } }] })
      : resposta({ features: [{ attributes: { num_tad: '123', serie_tad: 'E', dat_embargo: Date.UTC(2026, 9, 2), qtd_area_embargada: 4.04, des_tipo_bioma: 'Pampa' } }] })
  }
  const f = createFontesMunicipio({ fetchImpl })
  const r = await f.embargos('4306106')
  assert.equal(r.total, 3); assert.equal(r.areaHa, 12.3); assert.equal(r.ultimo, '2026-10-02'); assert.equal(r.primeiro, '2014-01-05')
  assert.deepEqual(r.recentes, [{ numero: '123-E', data: '2026-10-02', areaHa: 4, bioma: 'Pampa' }])
  assert.ok(urls.every(u => u.includes('cod_municipio=4306106') && !/nome|cpf|cnpj/i.test(u)))   // nada pessoal pedido
  await f.embargos('4306106'); assert.equal(urls.length, 2)                                     // cache
  await assert.rejects(f.embargos("1 or 1=1"), /inválido/)
})

test('crédito rural: safras do SICOR somadas, safra em curso e parte da área plantada do IBGE', async () => {
  const SIDRA = [{ V: 'Valor' }, { D2C: '8331', D3C: '2026', D4C: '1', D4N: 'Soja (em grão)', V: '1000' }, { D2C: '8331', D3C: '2025', D4C: '1', D4N: 'Soja (em grão)', V: '800' }]
  const pre = { credito: { fonte: 'BCB', dadosAte: '2026-10', itens: { 4306106: {
    '2026/27': { Soja: [100, 500000, 'a'] },
    '2025/26': { Soja: [600, 3000000, 'a'], Milho: [50, 400000, 'a'], Bovinos: [0, 200000, 'p'] },
    '2024/25': { Soja: [400, 2000000, 'a'] } } } } }
  const f = createFontesMunicipio({ fetchImpl: async () => resposta(SIDRA), pre })
  const r = await f.credito('4306106')
  assert.deepEqual(r.safras.map(s => [s.safra, s.emCurso]), [['2026/27', true], ['2025/26', false], ['2024/25', false]])
  const s = r.safras[1]
  assert.equal(s.areaHa, 650); assert.equal(s.valor, 3600000); assert.equal(s.valorPecuaria, 200000)
  assert.equal(s.produtos[0].produto, 'Soja'); assert.equal(s.produtos[0].financiadaPct, 60)          // 600 de 1000 ha (PAM 2026)
  assert.equal(r.safras[2].produtos[0].financiadaPct, 50)                                              // 400 de 800 ha (PAM 2025)
  assert.deepEqual((await f.credito('4399999')).safras, [])
  await assert.rejects(createFontesMunicipio({ pre: {} }).credito('4306106'), /ainda não carregados/)
})
