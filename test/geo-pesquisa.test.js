import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { createStore } from '../server/store.js'
import { createGeoIntel, tokensNome, compararNome, casarPalavra } from '../server/geo-inteligencia.js'
import { createEmpresas, grupoCnae, limparRazao, formatarCnpj } from '../server/geo-empresas.js'
import { nomeProdutor, primeirosNomes, montarProspectos, filtrarProspectos } from '../server/geo-prospeccao.js'
import { validar, marcacoes, ferramentas, createGeoIA } from '../server/geo-ia.js'
import { domainError } from '../server/rules.js'

const quadrado = (x, y, d) => JSON.stringify({ type: 'Polygon', coordinates: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]] })
const MERC = { soja: [800, 3, 1.8, 0.5, 100, 2500, 120, 2600, 10, 12], milho: [200, 9, 7, 5, 0, 0, 0, 0, 0, 0], trigo: [250, 3, 2.5, 2, 0, 0, 0, 0, 0, 0] }
const SLG = '4318903'

// base de teste com dados públicos de nomes: parcelas SIGEF com nome, armazém de produtor, empresa do agro e embargo
function montar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-pesq-'))
  const reg = (o, x, d = 0.02) => `${JSON.stringify({ mun: SLG, c: [x + d / 2, -28.45], b: [x, -28.46, x + d, -28.44], ...o })}\t${quadrado(x, -28.46, d)}`
  fs.writeFileSync(path.join(dir, 'imoveis-teste.ndjson.gz'), zlib.gzipSync([
    JSON.stringify({ v: 1, geradoEm: '2026-11-19', regiao: 'Teste', fontes: ['teste'], municipios: { [SLG]: 'São Luiz Gonzaga' }, mercado: { 'São Luiz Gonzaga': MERC }, contagem: { car: 2, sigef: 3 } }),
    reg({ id: 'CAR:A', f: 'CAR', car: 'RS-A', a: 600, ac: 500, mf: 30, st: 'Ativo', sa: { em: [['IBAMA', 'TAD1-X', '2023-05-01', 40, 'ativo', 'N']] } }, -54.96),
    reg({ id: 'CAR:B', f: 'CAR', car: 'RS-B', a: 60, ac: 50, mf: 3, st: 'Ativo' }, -54.86),
    reg({ id: 'SIGEF:1', f: 'SIGEF', nome: 'Fazenda Boa Vista - João da Costa Beber - Parcela 1', a: 300, lk: 'CAR:A', parcela: 'p1' }, -54.96, 0.01),
    reg({ id: 'SIGEF:2', f: 'SIGEF', nome: 'JOAO DA COSTA BEBER - Parte 2', a: 120, parcela: 'p2' }, -54.7, 0.01),
    reg({ id: 'SIGEF:3', f: 'SIGEF', nome: 'Fazenda São João', a: 80, parcela: 'p3' }, -54.6, 0.01),
    reg({ id: 'SIGEF:4', f: 'SIGEF', nome: 'PEDRO ALVES SEIBT - Parte 1', a: 50, parcela: 'p4' }, -54.5, 0.01)
  ].join('\n')))
  // armazéns de pessoa física da CONAB vêm sem nome: o primeiro cai dentro da parcela SIGEF:2, o segundo em lugar nenhum
  fs.writeFileSync(path.join(dir, 'produtores-armazem.json'), JSON.stringify({ fonte: 'CONAB teste', pontos: [[-28.455, -54.695, 1200, 'g', SLG], [-28.30, -54.10, 3600, 'g', SLG]] }))
  fs.writeFileSync(path.join(dir, 'embargos-responsaveis.json'), JSON.stringify({ fonte: 'IBAMA teste', itens: { 'IBAMA|TAD1-X': { nome: 'ANTONIO RIBAS', pessoa: 'pessoa', imovel: 'Faz. Grande', descricao: 'supressão de campo nativo', municipio: SLG, data: '2023-05-01' } } }))
  fs.writeFileSync(path.join(dir, 'empresas-rs.json.gz'), zlib.gzipSync(JSON.stringify({
    v: 1, fonte: 'Receita teste', edicao: '2026-11', geradoEm: '2026-11-19', cnaes: { '0115600': 'Cultivo de soja', '4622200': 'Comércio atacadista de soja' }, naturezas: { 2062: 'Sociedade Empresária Limitada', 2143: 'Cooperativa' }, qualificacoes: { 49: 'Sócio-Administrador' },
    socios: { 11111111: [['PEDRO ALVES SEIBT', 'F', '49', '2010']], 22222222: [['MARIA SOUZA', 'F', '49', '2015']], 33333333: [['FULANO TAL', 'F', '49', '2001']] },
    itens: [
      { c: '11111111000101', m: '1', f: '', d: '2010-03-01', a: '0115600', s: [], g: 'lavoura', mun: SLG, l: { lg: 'ESTRADA GERAL', b: 'INTERIOR', cep: '97800000' }, r: 'SEIBT AGRICOLA LTDA', n: '2062', k: 2500000, p: '05' },
      { c: '22222222000101', m: '1', f: 'GRAOS SUL', d: '2015-01-01', a: '4622200', s: [], g: 'cerealista', mun: SLG, l: { lg: 'RUA A', b: 'CENTRO', cep: '97800000' }, r: 'GRAOS SUL COMERCIO LTDA', n: '2062', k: 800000, p: '03' },
      { c: '33333333000101', m: '1', f: '', d: '2001-01-01', a: '0115600', s: [], g: 'lavoura', mun: SLG, l: { lg: '', b: 'INTERIOR', cep: '' }, r: 'AGROPECUARIA TAL LTDA', n: '2062', k: 100000, p: '01' }
    ]
  })))
  const store = createStore({ dataDir: path.join(dir, 'dados') })
  return { dir, store }
}
function resposta() {
  return { status: 0, headers: {}, body: null, raw: null, partes: [], writableEnded: false, writableFinished: false, ouvintes: {},
    writeHead(s, h) { this.status = s; this.headers = h }, write(t) { this.partes.push(t) }, end(b) { this.raw = b; this.writableEnded = this.writableFinished = true },
    on(ev, f) { this.ouvintes[ev] = f } }
}
async function chamar(geo, metodo, caminho, corpo) {
  const url = new URL(caminho, 'http://localhost')
  const request = Readable.from([]); request.method = metodo
  const res = resposta()
  const json = (r, status, body) => { r.status = status; r.body = body }
  await geo.handle({ request, response: res, url, segments: url.pathname.split('/').filter(Boolean), json, readBody: async () => corpo || {} })
  return res
}

test('nome de produtor dentro do nome da área: pessoa, empresa ou só lugar', () => {
  const P = primeirosNomes()
  assert.deepEqual(nomeProdutor('Fazenda Boa Vista - João da Costa Beber', P), { nome: 'João da Costa Beber', tipo: 'pessoa' })
  assert.equal(nomeProdutor('Fazenda São João', P), null)
  assert.equal(nomeProdutor('Sítio Santa Rita - Gleba 2', P), null)
  assert.deepEqual(nomeProdutor('Parte da Fazenda Santa Rita - Antônio Costa', P), { nome: 'Antônio Costa', tipo: 'pessoa' })
  assert.deepEqual(nomeProdutor('Eloi Antonio Pretto - Parte 1', P), { nome: 'Eloi Antonio Pretto', tipo: 'pessoa' })
  assert.equal(nomeProdutor('Agropecuária Três Irmãos Ltda - Gleba 2', P).tipo, 'empresa')
  assert.equal(nomeProdutor('Matrícula 1234 - Pedro', P), null)
})

test('empresas do agro: CNAE por grupo, razão social sem CPF, CNPJ formatado', () => {
  assert.equal(grupoCnae('0115600'), 'lavoura'); assert.equal(grupoCnae('0151201'), 'pecuaria'); assert.equal(grupoCnae('4622200'), 'cerealista')
  assert.equal(grupoCnae('5211701'), 'armazem'); assert.equal(grupoCnae('4711302'), null)
  assert.equal(limparRazao('12.345.678 JOAO DA SILVA'), 'JOAO DA SILVA')
  assert.equal(limparRazao('JOAO DA SILVA 12345678900'), 'JOAO DA SILVA')
  assert.equal(formatarCnpj('11111111000101'), '11.111.111/0001-01')
})

test('busca de empresas por sócio, por grupo e resumo do município', () => {
  const { dir } = montar()
  const e = createEmpresas({ arquivo: path.join(dir, 'empresas-rs.json.gz'), tokens: tokensNome, comparar: compararNome, casar: casarPalavra })
  const porSocio = e.buscar({ q: 'Pedro Seibt' })
  assert.equal(porSocio.total, 1); assert.match(porSocio.itens[0].casou, /sócio/); assert.equal(porSocio.itens[0].socios[0].qualificacao, 'Sócio-Administrador')
  assert.equal(e.buscar({ grupos: ['cerealista'] }).itens[0].razaoSocial, 'GRAOS SUL COMERCIO LTDA')
  assert.equal(e.buscar({ capitalMin: 1000000 }).total, 1)
  const r = e.resumoMunicipio(SLG)
  assert.equal(r.total, 3); assert.equal(r.produtoras, 2); assert.equal(r.maiores[0].razaoSocial, 'SEIBT AGRICOLA LTDA')
  assert.equal(e.porCnpj('11.111.111/0001-01').cnpj, '11.111.111/0001-01')
  assert.equal(createEmpresas({ arquivo: path.join(dir, 'nao-existe.gz'), tokens: tokensNome, comparar: compararNome, casar: casarPalavra }).buscar({ q: 'x' }), null)
})

test('produtores da base juntam SIGEF, CONAB e CNPJ pelo nome no município', () => {
  const imoveis = [
    { id: 'S1', f: 'SIGEF', nome: 'Fazenda X - João da Costa Beber', mun: SLG, a: 300, lav: 200, pot: { bom: 700 }, c: [-54.9, -28.4] },
    { id: 'S2', f: 'SIGEF', nome: 'JOAO DA COSTA BEBER - Parte 2', mun: SLG, a: 120, lav: 90, pot: { bom: 300 }, c: [-54.7, -28.4], risco: { nivel: 'critico' } },
    { id: 'S3', f: 'SIGEF', nome: 'Fazenda São João', mun: SLG, a: 80, c: [-54.6, -28.4] },
    { id: 'S4', f: 'SIGEF', nome: 'PEDRO ALVES SEIBT - Parte 1', mun: SLG, a: 50, lav: 30, pot: { bom: 100 }, c: [-54.8, -28.4] },
    { id: 'C1', f: 'CAR', mun: SLG, a: 600, c: [-54.95, -28.4], parcelas: ['S1'] }
  ]
  // CONAB sem nome: liga pelo lugar (na parcela S2; num CAR com a parcela S1 dentro; e um em lugar nenhum)
  const armazensPF = [[-28.41, -54.69, 1200, 'g', SLG], [-28.42, -54.95, 500, 'c', SLG], [-28.0, -54.0, 3600, 'g', SLG]]
  const porPonto = { '-54.69': [imoveis[1]], '-54.95': [imoveis[4]] }
  const localizar = lng => porPonto[String(lng)] || []
  const empresas = [
    { c: '11111111000101', m: '1', r: 'SEIBT AGRICOLA LTDA', n: '2062', a: '0115600', g: 'lavoura', mun: SLG, k: 2500000, so: [['PEDRO ALVES SEIBT', 'F', '49', '2010']] },
    { c: '11111111000282', m: '2', r: 'SEIBT AGRICOLA LTDA', n: '2062', a: '0115600', g: 'lavoura', mun: SLG, k: 2500000, so: [['PEDRO ALVES SEIBT', 'F', '49', '2010']] },
    { c: '22222222000101', m: '1', r: 'GRAOS SUL COMERCIO LTDA', n: '2062', a: '4622200', g: 'cerealista', mun: SLG, k: 800000, so: [] },
    { c: '33333333000101', m: '1', r: 'AGROPECUARIA TAL LTDA', n: '2062', a: '0115600', g: 'lavoura', mun: SLG, k: 100000, so: [] }
  ]
  const { lista, porArea } = montarProspectos({ imoveis, armazensPF, localizar, empresas, tokens: tokensNome, primeiros: primeirosNomes() })
  const joao = lista.find(p => p.nome === 'João da Costa Beber')
  assert.deepEqual(joao.areas, ['S1', 'S2']); assert.equal(joao.areaHa, 420); assert.equal(joao.potT, 1000)
  assert.deepEqual(joao.ponto, [-54.9, -28.4], 'pin na maior parcela'); assert.equal(joao.risco, 'critico')
  assert.equal(joao.fontes.conab, 2, 'os dois armazéns que caem nas áreas dele'); assert.equal(joao.armazemT, 1700)
  assert.ok(!lista.some(p => /pessoa/i.test(p.nome)), 'armazém sem nome não vira produtor')
  const pedro = lista.find(p => p.nome === 'Pedro Alves Seibt')
  assert.deepEqual(pedro.ponto, [-54.8, -28.4]); assert.equal(pedro.empresas.length, 1, 'empresa pelo sócio, filial no mesmo município uma vez só')
  assert.ok(!lista.some(p => /graos sul/i.test(p.nome)), 'cerealista não é produtor')
  const tal = lista.find(p => /tal/i.test(p.nome)); assert.equal(tal.ponto, null); assert.equal(tal.tipo, 'empresa')
  assert.equal(porArea.get('S2'), joao)
  assert.ok(!lista.some(p => /sao joao/i.test(p.nome)))
  // filtros
  assert.deepEqual(filtrarProspectos(lista, { areaMin: 100 }).map(x => x.p.nome), ['João da Costa Beber'])
  assert.deepEqual(filtrarProspectos(lista, { fonte: 'conab' }).map(x => x.p.nome), ['João da Costa Beber'])
  assert.equal(filtrarProspectos(lista, { semCritico: true }).some(x => x.p === joao), false)
  assert.equal(filtrarProspectos(lista, { naoClientes: true }, { clienteDe: p => (p === pedro ? { id: 'v1' } : null) }).some(x => x.p === pedro), false)
  assert.equal(filtrarProspectos(lista, { comPonto: true }).some(x => x.p === tal), false)
  assert.equal(filtrarProspectos(lista, { tipo: 'empresa' })[0].p, tal)
})

test('rotas: produtores da base, ficha com empresas e nomes ligados ao imóvel', async () => {
  const { dir, store } = montar()
  await store.migrate()
  const cli = await store.insert('producers', { name: 'Pedro Alves Seibt', municipality: 'São Luiz Gonzaga', uf: 'RS' })
  const geo = createGeoIntel({ dataDir: dir, store, domainError })
  await assert.rejects(chamar(geo, 'GET', '/api/geo/produtores-base'), /município/)   // sem município nem janela do mapa
  const r = await chamar(geo, 'GET', `/api/geo/produtores-base?municipio=${SLG}`)
  const nomes = r.body.itens.map(x => x.nome)
  assert.ok(nomes.includes('João da Costa Beber') && nomes.includes('Pedro Alves Seibt'))
  const pedro = r.body.itens.find(x => x.nome === 'Pedro Alves Seibt')
  assert.equal(pedro.cliente.id, cli.id); assert.equal(pedro.cliente.por, 'mesmo nome no município')
  const nao = await chamar(geo, 'GET', `/api/geo/produtores-base?municipio=S%C3%A3o%20Luiz%20Gonzaga&naoClientes=1`)
  assert.ok(!nao.body.itens.some(x => x.nome === 'Pedro Alves Seibt'))
  const joao = r.body.itens.find(x => x.nome === 'João da Costa Beber')
  assert.equal(joao.armazemT, 1200, 'armazém da CONAB pelo lugar (dentro da parcela SIGEF:2)')
  assert.equal(pedro.empresas[0].razaoSocial, 'SEIBT AGRICOLA LTDA')
  const d = await chamar(geo, 'GET', `/api/geo/produtores-base/${joao.id}`)
  assert.deepEqual(d.body.imoveis.map(i => i.id).sort(), ['SIGEF:1', 'SIGEF:2'])
  // ficha do município traz empresas e contagem de produtores da base
  const f = await chamar(geo, 'GET', `/api/geo/municipio/${SLG}`)
  assert.equal(f.body.empresas.total, 3); assert.ok(f.body.produtoresBase.total >= 3)
  // nomes ligados ao CAR: a parcela SIGEF de dentro dele e o responsável pelo embargo; sem CPF
  const m = await chamar(geo, 'GET', '/api/geo/imoveis/CAR%3AA/detalhe')
  const fontes = m.body.nomes.map(n => `${n.fonte}:${n.nome}`)
  assert.ok(fontes.includes('SIGEF:João da Costa Beber')); assert.ok(fontes.includes('IBAMA:ANTONIO RIBAS'))
  assert.equal(m.body.produtorDaBase.nome, 'João da Costa Beber')
  assert.ok(!JSON.stringify(m.body).match(/\d{3}\.\d{3}\.\d{3}-\d{2}/))
  const emp = await chamar(geo, 'GET', '/api/geo/empresas?q=Pedro%20Seibt')
  assert.equal(emp.body.itens[0].razaoSocial, 'SEIBT AGRICOLA LTDA')
})

test('IA: valida entradas, marca referências e roda o ciclo de ferramentas (cliente falso)', async () => {
  const FERR = ferramentas({ metricas: ['potencial_ano_bom_t'], grupos: { lavoura: 'x' } })
  const esq = FERR.find(f => f.name === 'buscar_imoveis').input_schema
  assert.deepEqual(validar({ municipios: 'Ijuí', limite: 999, porte: 'enorme', area_min_ha: '50', extra: 1 }, esq), { municipios: ['Ijuí'], limite: 50, area_min_ha: 50 })
  assert.throws(() => validar({}, FERR.find(f => f.name === 'buscar_nome').input_schema), /obrigatório/)
  assert.deepEqual(marcacoes('A [[i:CAR:A]] e [[e:11.111.111/0001-01]] [[x:1]]').e, ['11111111000101'])

  const { dir, store } = montar()
  await store.migrate()
  const pedidos = []
  const cliente = { beta: { messages: { create: async req => {
    pedidos.push(structuredClone(req))   // a lista de mensagens cresce depois: guarda a foto do pedido
    if (pedidos.length === 1) return { stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'Vou ver.' }, { type: 'tool_use', id: 't1', name: 'buscar_imoveis', input: { municipios: ['São Luiz Gonzaga'], area_min_ha: 100 } }, { type: 'tool_use', id: 't2', name: 'nao_existe', input: {} }] }
    return { stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 30 }, content: [{ type: 'text', text: 'O maior é **CAR A** [[i:CAR:A]]; ignore [[i:CAR:Z]]. Município [[m:4318903]].' }] }
  } } } }
  const geo = createGeoIntel({ dataDir: dir, store, domainError, clienteIA: cliente })
  const st = await chamar(geo, 'GET', '/api/geo/ia')
  assert.equal(st.body.disponivel, true)
  const res = await chamar(geo, 'POST', '/api/geo/ia', { pergunta: 'Quais os maiores imóveis de São Luiz Gonzaga?' })
  const eventos = res.partes.filter(p => p.startsWith('event:')).map(p => ({ tipo: p.match(/^event: (\w+)/)[1], dado: JSON.parse(p.match(/data: (.+)/)[1]) }))
  const fim = eventos.find(e => e.tipo === 'fim').dado
  assert.ok(eventos.some(e => e.tipo === 'passo' && /Filtrando imóveis/.test(e.dado.texto)))
  assert.match(fim.resposta, /\[\[i:CAR:A\]\]/); assert.doesNotMatch(fim.resposta, /CAR:Z/, 'referência inexistente sai do texto')
  assert.ok(fim.referencias.i['CAR:A'].ponto); assert.equal(fim.referencias.m['4318903'].municipio, 'São Luiz Gonzaga')
  assert.deepEqual(fim.mapa.i, ['CAR:A'])
  // segunda chamada levou os resultados: um ok, um com erro (ferramenta desconhecida); modelo e fallback
  const resultados = pedidos[1].messages.at(-1).content
  assert.equal(resultados.length, 2); assert.equal(resultados[1].is_error, true)
  assert.equal(JSON.parse(resultados[0].content).total, 2, 'CAR A e a parcela SIGEF solta com 120 ha')
  assert.equal(pedidos[0].model, 'claude-opus-5-5'); assert.equal(pedidos[0].fallbacks, 'default')
  assert.equal(pedidos[0].messages.length, 1)
  // sem chave: desligada, com motivo
  const semChave = createGeoIA({ consultas: { metricas: [], grupos: {} }, apiKey: '' })
  assert.equal(semChave.status().disponivel, false)
  await assert.rejects(semChave.perguntar({ pergunta: 'oi' }), /ANTHROPIC_API_KEY/)
})
