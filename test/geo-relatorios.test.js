import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { createStore } from '../server/store.js'
import { createGeoIntel, nomeArquivo } from '../server/geo-inteligencia.js'
import { domainError } from '../server/rules.js'

const quadrado = (x, y, d) => JSON.stringify({ type: 'Polygon', coordinates: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]] })
const MERC = { soja: [800, 3, 1.8, 0.5, 100, 2500, 120, 2600, 10, 12], milho: [200, 9, 7, 5, 0, 0, 0, 0, 0, 0], trigo: [250, 3, 2.5, 2, 0, 0, 0, 0, 0, 0] }

function montar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-rel-'))
  const linhas = [
    JSON.stringify({ v: 1, geradoEm: '2026-11-17', regiao: 'Teste', fontes: ['teste'], municipios: { 4318903: 'São Luiz Gonzaga' }, mercado: { 'São Luiz Gonzaga': MERC }, contagem: { car: 2, sigef: 0 }, camadas: { geradoEm: '2026-11-17', fontes: ['INPE'] } }),
    `${JSON.stringify({ id: 'CAR:A', f: 'CAR', car: 'RS-4318903-A', a: 600, ac: 500, mf: 30, nome: 'Fazenda Grande', mun: '4318903', c: [-54.95, -28.45], b: [-54.96, -28.46, -54.94, -28.44], sa: { d: [[2022, 12, 'P']] } })}\t${quadrado(-54.96, -28.46, 0.02)}`,
    `${JSON.stringify({ id: 'CAR:B', f: 'CAR', car: 'RS-4318903-B', a: 60, ac: 50, mf: 3, mun: '4318903', c: [-54.85, -28.35], b: [-54.86, -28.36, -54.84, -28.34] })}\t${quadrado(-54.86, -28.36, 0.02)}`
  ]
  const file = path.join(dir, 'base.ndjson.gz')
  fs.writeFileSync(file, zlib.gzipSync(linhas.join('\n')))
  const store = createStore({ dataDir: path.join(dir, 'dados') })
  return { dir, file, store }
}
// chama a rota como o server.js faz, guardando status e corpo
async function chamar(geo, metodo, caminho, corpo) {
  const url = new URL(caminho, 'http://localhost')
  const request = Readable.from(corpo ? [corpo] : []); request.method = metodo
  const res = { status: 0, headers: {}, body: null, raw: null, writeHead(s, h) { this.status = s; this.headers = h }, end(b) { this.raw = b } }
  const json = (r, status, body) => { r.status = status; r.body = body }
  await geo.handle({ request, response: res, url, segments: url.pathname.split('/').filter(Boolean), json, readBody: async () => ({}) })
  return res
}

test('documentos no armazenamento local: anexar, listar, baixar, apagar e limpar por produtor', async () => {
  const { store } = montar()
  await store.migrate()
  const a = await store.files.put({ producerId: 'p1', nome: 'matricula.pdf', ext: 'pdf', categoria: 'matricula' }, Buffer.from('%PDF-1.4 teste'))
  await store.files.put({ producerId: 'p1', nome: 'mapa.kml', ext: 'kml', categoria: 'kml' }, Buffer.from('<kml/>'))
  await store.files.put({ producerId: 'p2', nome: 'outro.txt', ext: 'txt', categoria: 'outro' }, Buffer.from('x'))
  assert.equal((await store.files.list('p1')).length, 2)
  assert.equal((await store.files.get(a.id)).content.toString(), '%PDF-1.4 teste')
  assert.equal(await store.files.remove(a.id), true)
  assert.equal(await store.files.get(a.id), null)
  assert.equal(await store.files.removeByProducer('p1'), 1)
  assert.equal((await store.files.list('p2')).length, 1)
  await store.clear()
  assert.equal((await store.files.list('p2')).length, 0)
})

test('nome do arquivo sem caminho nem caracteres perigosos', () => {
  assert.equal(nomeArquivo('C:\\fakepath\\Matrícula 16.213.pdf'), 'Matrícula 16.213.pdf')
  assert.equal(nomeArquivo('../../etc/passwd'), 'passwd')
  assert.equal(nomeArquivo('a"<b>|c.pdf'), 'abc.pdf')
  assert.equal(nomeArquivo(''), 'documento')
})

test('rota de documentos: tipo aceito, limite, download como anexo e exclusão', async () => {
  const { file, store } = montar()
  await store.migrate()
  const p = await store.insert('producers', { name: 'Ana', municipality: 'São Luiz Gonzaga' })
  const geo = createGeoIntel({ dataFile: file, store, domainError })
  const enviado = await chamar(geo, 'POST', `/api/geo/documentos?producerId=${p.id}&nome=laudo.pdf&categoria=laudo&descricao=teste`, Buffer.from('%PDF-1.4 laudo'))
  assert.equal(enviado.status, 201); assert.equal(enviado.body.categoria, 'laudo'); assert.equal(enviado.body.size, 14)
  await assert.rejects(chamar(geo, 'POST', `/api/geo/documentos?producerId=${p.id}&nome=script.html`, Buffer.from('<script>')), e => e.statusCode === 415)
  await assert.rejects(chamar(geo, 'POST', `/api/geo/documentos?producerId=nao-existe&nome=a.pdf`, Buffer.from('x')), e => e.statusCode === 404)
  const baixado = await chamar(geo, 'GET', `/api/geo/documentos/${enviado.body.id}`)
  assert.equal(baixado.status, 200)
  assert.match(baixado.headers['Content-Disposition'], /^attachment;/)
  assert.equal(baixado.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(baixado.raw.toString(), '%PDF-1.4 laudo')
  assert.equal((await chamar(geo, 'DELETE', `/api/geo/documentos/${enviado.body.id}`)).body.removed, true)
})

test('relatórios do produtor e do município: potencial, porte, socioambiental, carteira e oportunidades', async () => {
  const { file, store } = montar()
  await store.migrate()
  const p = await store.insert('producers', { name: 'Ana', municipality: 'São Luiz Gonzaga', relationship: 'active' })
  await store.insert('interactions', { producerId: p.id, kind: 'visit', occurredAt: '2026-10-01T10:00:00Z', outcome: 'positive', notes: 'visita' })
  await store.insert('geo_links', { producerId: p.id, imovelId: 'CAR:A' })
  const geo = createGeoIntel({ dataFile: file, store, domainError })

  const rp = (await chamar(geo, 'GET', `/api/geo/relatorio/produtor?producerId=${p.id}`)).body
  assert.equal(rp.produtor.name, 'Ana')
  assert.equal(rp.imoveisContados, 1)
  assert.equal(rp.porte.classe, 'grande')                            // 30 módulos fiscais
  assert.equal(rp.socioambiental.nivel, 'critico')                   // supressão em 2022 (depois do corte do EUDR)
  assert.equal(rp.socioambiental.motivos[0].imovel, 'Fazenda Grande')
  assert.equal(rp.interacoes.length, 1)
  assert.equal(rp.municipio.nome, 'São Luiz Gonzaga')

  const rm = (await chamar(geo, 'GET', '/api/geo/relatorio/municipio?municipio=Sao Luiz Gonzaga')).body
  assert.equal(rm.imoveis.car, 2)
  assert.equal(rm.cobertura.imoveisVinculados, 1)
  assert.ok(rm.cobertura.percentual > 50)
  assert.deepEqual(rm.oportunidades.map(x => x.id), ['CAR:B'])       // o imóvel sem produtor
  assert.equal(rm.portes.grande.imoveis, 1); assert.equal(rm.portes.pequeno.imoveis, 1)
  assert.equal(rm.socioambiental.critico, 1)
  assert.deepEqual(rm.carteira.map(x => [x.nome, x.comArea]), [['Ana', true]])
  await assert.rejects(chamar(geo, 'GET', '/api/geo/relatorio/municipio?municipio=Ijuí'), e => e.statusCode === 404)
})
