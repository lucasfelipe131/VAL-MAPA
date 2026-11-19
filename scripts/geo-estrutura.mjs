// VAL Geomap — estrutura produtiva, terra e logística por município (fontes públicas), embarcadas em data/geo:
//   municipios-estrutura.json  armazenagem (CONAB/SICARM), Censo Agro 2017 e pecuária (IBGE), valor da terra nua
//                              (Receita Federal, ITR) e distâncias ao porto e à ferrovia (DNIT/ANTAQ)
//   armazens-rs.json           armazéns de empresas e cooperativas (pontos) para a camada do mapa
//
//   node scripts/geo-estrutura.mjs [--armazens] [--ibge] [--vtn] [--logistica]     sem opção: tudo
//
// Dados pessoais ficam de fora: de armazém de pessoa física só entram os totais do município (sem ponto nem nome);
// endereço e e-mail não são lidos de ninguém.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pontoCentral } from '../server/geo-municipio.js'

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const destino = path.join(raiz, 'data', 'geo', 'municipios-estrutura.json')
const ler = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return padrao } }
const gravar = (f, d) => { fs.writeFileSync(`${f}.tmp`, JSON.stringify(d)); fs.renameSync(`${f}.tmp`, f) }
const malha = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'malhas', 'RS.json'), 'utf8'))
const codigos = new Set(malha.features.map(f => f.properties.code))
const slug = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const porSlug = new Map(malha.features.map(f => [slug(f.properties.name), f.properties.code]))
const args = process.argv.slice(2), tudo = !args.some(a => a.startsWith('--'))
const quer = k => tudo || args.includes(`--${k}`)
const d = ler(destino, { geradoEm: '', fontes: {}, itens: {} })
const item = cod => (d.itens[cod] ||= {})
const num = s => { const v = Number(String(s ?? '').trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0 }
async function baixar(url, { tempo = 180000, tentativas = 4 } = {}) {
  for (let t = 0; ; t++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(tempo) }); if (r.ok) return r; throw new Error(`HTTP ${r.status}`) } catch (e) {
      if (t >= tentativas - 1) throw new Error(`${new URL(url).host}: ${e.cause?.code || e.message}`)
      await new Promise(ok => setTimeout(ok, 3000 * (t + 1)))
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Armazenagem: CONAB, Cadastro Nacional de Unidades Armazenadoras (SICARM), atualizado todo dia
// ---------------------------------------------------------------------------------------------
if (quer('armazens')) {
  const txt = new TextDecoder('latin1').decode(await (await baixar('https://portaldeinformacoes.conab.gov.br/downloads/arquivos/ArmazensCadastrados.txt')).arrayBuffer())
  const linhas = txt.split(/\r?\n/), cab = linhas[0].split(';').map(x => x.trim())
  const col = n => cab.findIndex(c => c.startsWith(n))
  const C = { esp: col('dsc_especie'), tipo: col('dsc_tipo_armazem'), ent: col('dsc_tipo_entidade'), pes: col('dsc_tipo_pessoa'), cod: col('cod_ibge'), uf: col('uf'), cap: col('qtd_capacidade_estatica'), lat: col('latitude'), lon: col('longitude'), nome: col('nome_armazenador') }
  if (Object.values(C).some(i => i < 0)) throw new Error(`CONAB mudou o arquivo: ${cab.join(' | ')}`)
  for (const cod of codigos) if (d.itens[cod]) delete d.itens[cod].armazens
  const pontos = []
  let n = 0, t = 0
  for (const l of linhas.slice(1)) {
    const c = l.split(';').map(x => x.trim()); if (c[C.uf] !== 'RS' || !codigos.has(c[C.cod])) continue
    const cap = num(c[C.cap]), granel = /GRANEL/i.test(c[C.esp]), pf = /F[IÍ]SICA/i.test(c[C.pes])
    const dono = /COOPERATIVA/i.test(c[C.ent]) ? 'coop' : /OFICIAL/i.test(c[C.ent]) ? 'ofic' : 'priv'
    const a = (item(c[C.cod]).armazens ||= { unidades: 0, capacidadeT: 0, granelT: 0, convencionalT: 0, coop: [0, 0], priv: [0, 0], ofic: [0, 0], pessoaFisica: [0, 0] })
    a.unidades++; a.capacidadeT += cap; a[granel ? 'granelT' : 'convencionalT'] += cap; a[dono][0]++; a[dono][1] += cap
    if (pf) { a.pessoaFisica[0]++; a.pessoaFisica[1] += cap }
    else { const la = Number(c[C.lat]), lo = Number(c[C.lon]); if (la < -27 && la > -34 && lo > -58 && lo < -49) pontos.push([Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5, Math.round(cap), granel ? 'g' : 'c', dono, c[C.nome].replace(/\s+/g, ' ').slice(0, 80), c[C.cod]]) }
    n++; t += cap
  }
  for (const it of Object.values(d.itens)) if (it.armazens) for (const k of ['capacidadeT', 'granelT', 'convencionalT']) it.armazens[k] = Math.round(it.armazens[k])
  d.fontes.armazens = `CONAB, Cadastro Nacional de Unidades Armazenadoras (SICARM), baixado em ${new Date().toISOString().slice(0, 10)}`
  gravar(path.join(raiz, 'data', 'geo', 'armazens-rs.json'), { fonte: d.fontes.armazens, campos: ['lat', 'lng', 'capacidadeT', 'especie (g=granel, c=convencional)', 'dono (coop, priv, ofic)', 'armazenador', 'codigoIbge'], pontos })
  console.log(`armazéns: ${n} unidades no RS, ${Math.round(t / 1e6 * 10) / 10} Mt; ${pontos.length} pontos de empresas e cooperativas`)
}

// ---------------------------------------------------------------------------------------------
// IBGE: Censo Agropecuário 2017 (estrutura) e Pesquisa da Pecuária Municipal (ano mais recente)
// ---------------------------------------------------------------------------------------------
async function sidra(tabela, variaveis, { periodo = 'last', fixar = {} } = {}) {
  // todas as classificações no "Total", menos as de `fixar` ({ c: 'id,id' })
  const meta = await (await baixar(`https://servicodados.ibge.gov.br/api/v3/agregados/${tabela}/metadados`)).json()
  const cls = meta.classificacoes.map(c => `/c${c.id}/${fixar[c.id] || (c.categorias.find(x => /^total$/i.test(x.nome))?.id ?? 'all')}`).join('')
  const url = `https://apisidra.ibge.gov.br/values/t/${tabela}/n6/in%20n3%2043/v/${variaveis}/p/${periodo}${cls}/h/n?formato=json`
  const linhas = await (await baixar(url)).json()
  return linhas.map(l => ({ cod: l.D1C, v: l.D2C, ano: l.D3C, cat: Object.keys(l).filter(k => /^D[4-9]C$/.test(k)).map(k => l[k]).join('|'), nome: l.D4N || '', valor: /^-?\d+(\.\d+)?$/.test(String(l.V)) ? Number(l.V) : null }))
}
if (quer('ibge')) {
  const pega = (rows, v, cat) => { const m = new Map(); for (const r of rows) if (r.v === String(v) && (!cat || r.cat.split('|').includes(String(cat)))) m.set(r.cod, r.valor); return m }
  const est = await sidra(6878, '183,184', { fixar: { 829: '46302,46304' } })
  const irr = await sidra(6857, '2372,2373')
  const trat = await sidra(6869, '1918,1862', { fixar: { 12605: '113521,113523' } })
  const arm = await sidra(6866, '10113,9561')
  const fin = await sidra(6895, '1990', { fixar: { 12542: '115947,111915,111916,111917,111918' } })
  const reb = await sidra(3939, '105', { fixar: { 79: 'all' } })
  const vacas = await sidra(94, '107'), leite = await sidra(74, '106,215', { fixar: { 80: '2682' } })
  const anoPpm = reb.find(r => r.ano)?.ano
  const rebanho = nome => { const m = new Map(); for (const r of reb) if (slug(r.nome) === slug(nome)) m.set(r.cod, r.valor); return m }
  const bov = rebanho('Bovino'), sui = rebanho('Suíno - total'), gal = rebanho('Galináceos - total'), ovi = rebanho('Ovino')
  const M = {
    estab: pega(est, 183, 46302), estabFamiliar: pega(est, 183, 46304), areaHa: pega(est, 184, 46302), areaFamiliarHa: pega(est, 184, 46304),
    irrigados: pega(irr, 2372), areaIrrigadaHa: pega(irr, 2373), comTratores: pega(trat, 1918, 113521), tratores: pega(trat, 1862, 113521), tratores100cv: pega(trat, 1862, 113523),
    comArmazem: pega(arm, 10113), armazemFazendaT: pega(arm, 9561),
    financiados: pega(fin, 1990, 115947), finBancos: pega(fin, 1990, 111915), finCooperativas: pega(fin, 1990, 111916), finComerciantes: pega(fin, 1990, 111917), finFornecedores: pega(fin, 1990, 111918)
  }
  for (const cod of codigos) {
    const it = item(cod)
    it.censo = Object.fromEntries(Object.entries(M).map(([k, m]) => [k, m.get(cod) ?? null]))
    it.pecuaria = { ano: Number(anoPpm) || null, bovinos: bov.get(cod) ?? null, vacasOrdenhadas: pega(vacas, 107).get(cod) ?? null, leiteMilLitros: pega(leite, 106).get(cod) ?? null, leiteValorMilReais: pega(leite, 215).get(cod) ?? null, suinos: sui.get(cod) ?? null, galinaceos: gal.get(cod) ?? null, ovinos: ovi.get(cod) ?? null }
  }
  d.fontes.censo = 'IBGE, Censo Agropecuário 2017 (tabelas 6878, 6857, 6869, 6866 e 6895 do SIDRA)'
  d.fontes.pecuaria = `IBGE, Pesquisa da Pecuária Municipal ${anoPpm} (tabelas 3939, 94 e 74 do SIDRA)`
  console.log(`IBGE: censo e pecuária de ${anoPpm} para ${codigos.size} municípios; ex. Cruz Alta: ${JSON.stringify(d.itens['4306106']?.censo).slice(0, 200)}`)
}

// ---------------------------------------------------------------------------------------------
// Valor da Terra Nua (VTN), Receita Federal: R$/ha por aptidão, informado pelos municípios para o ITR.
// Publicado em PDF; o texto sai com `pdftotext -raw` (poppler; vem com o Git para Windows). O ano mais recente
// vale; quem não informou nele fica com o ano anterior. Só os municípios que mandaram valores aparecem.
// ---------------------------------------------------------------------------------------------
if (quer('vtn')) {
  const PDFS = [
    [2026, 'https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/vtn/tabela-vtn-2026-para-publicacao-6.pdf'],
    [2025, 'https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/vtn/planilha-vtn-2025-para-publicacao-7.pdf']
  ]
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtn-'))
  const chave = s => slug(s).replace(/ /g, '')
  const porChave = new Map(malha.features.map(f => [chave(f.properties.name), f.properties.code]))
  const VALOR = /^\d{1,3}(\.\d{3})*,\d{2}$/
  const achados = new Map(), semPar = []
  for (const [ano, url] of PDFS) {
    const pdf = path.join(tmp, `vtn${ano}.pdf`), txt = path.join(tmp, `vtn${ano}.txt`)
    fs.writeFileSync(pdf, Buffer.from(await (await baixar(url)).arrayBuffer()))
    execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', pdf, txt])
    for (const l of fs.readFileSync(txt, 'utf8').split(/\r?\n/)) {
      const tk = l.trim().split(/\s+/); if (tk[0] !== 'RS' || tk.length < 9) continue
      const fonte = /^[12]$/.test(tk[tk.length - 1]) ? Number(tk.pop()) : null
      const vals = []   // "s/informação" = a classe não foi informada
      while (tk.length && vals.length < 6 && (VALOR.test(tk[tk.length - 1]) || /^s\/inform/i.test(tk[tk.length - 1]))) { const v = tk.pop(); vals.unshift(VALOR.test(v) ? num(v) : null) }
      if (vals.length !== 6 || !vals.some(v => v != null)) { semPar.push(`${ano} ${tk.slice(1).join(' ')} (${vals.length} colunas)`); continue }   // linha quebrada: não dá para saber qual classe falta
      const nome = tk.slice(1).join(' '), cod = porChave.get(chave(nome))
      if (vals.length !== 6) { semPar.push(`${ano} ${nome} (${vals.length} valores)`); continue }
      if (!cod) { semPar.push(`${ano} ${nome} (sem código IBGE)`); continue }
      if (achados.has(cod)) continue   // o ano mais recente já entrou
      achados.set(cod, { ano, lavouraBoa: vals[0], lavouraRegular: vals[1], lavouraRestrita: vals[2], pastagemPlantada: vals[3], silviculturaOuPastagemNatural: vals[4], preservacao: vals[5], informadoPor: fonte === 1 ? 'município' : fonte === 2 ? 'órgão estadual' : null })
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  for (const cod of codigos) { if (d.itens[cod]) delete d.itens[cod].vtn; if (achados.has(cod)) item(cod).vtn = achados.get(cod) }
  d.fontes.vtn = 'Receita Federal, Valor da Terra Nua (VTN) para o ITR, tabelas de 2026 e 2025 (R$/ha, informados pelos municípios)'
  console.log(`VTN: ${achados.size} municípios do RS (${[...achados.values()].filter(x => x.ano === 2026).length} de 2026); fora: ${semPar.length ? semPar.slice(0, 12).join('; ') : 'nenhum'}`)
}

// ---------------------------------------------------------------------------------------------
// Logística: distâncias em linha reta do centro do município ao porto de Rio Grande, ao porto ou terminal
// hidroviário mais próximo e ao trilho mais próximo (DNIT GeoServer: portos da ANTAQ e malha ferroviária).
// A malha do DNIT não diz quais trechos estão em operação: a distância ao trilho é só referência.
// ---------------------------------------------------------------------------------------------
if (quer('logistica')) {
  const WFS = 'https://servicos.dnit.gov.br/dnitgeo/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&bbox=-34,-58,-27,-49,urn:ogc:def:crs:EPSG::4326&typeNames='
  const portos = (await (await baixar(`${WFS}vgeo:vw_antaq_portos`)).json()).features
  const ferro = (await (await baixar(`${WFS}vgeo:vw_epl_ferrovias`)).json()).features
  const ponto = f => { const c = f.geometry.coordinates; return Array.isArray(c[0]) ? c[0] : c }
  const acha = re => { const f = portos.find(x => re.test(String(x.properties.Nome || '').trim())); if (!f) throw new Error(`porto não encontrado: ${re}`); return ponto(f) }
  const DESTINOS = [['Rio Grande', acha(/^Rio Grande$/)], ['Porto Alegre', acha(/^Porto Alegre$/)], ['Pelotas', acha(/^Pelotas$/)], ['Estrela', acha(/Terminal Portu[aá]rio Estrela/)]]
  // trilhos dentro do RS: vértices que caem em algum município (a camada traz trechos de SC e SP marcados como RS)
  const caixas = malha.features.map(f => ({ g: f.geometry, b: (() => { let o = 180, s = 90, l = -180, n = -90; const pass = r => r.forEach(([x, y]) => { o = Math.min(o, x); l = Math.max(l, x); s = Math.min(s, y); n = Math.max(n, y) }); (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).forEach(p => p.forEach(pass)); return [o, s, l, n] })() }))
  const anel = (pt, r) => { let dd = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) dd = !dd } return dd }
  const noRS = pt => caixas.some(({ g, b }) => pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3] && (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some(p => anel(pt, p[0])))
  const segs = []
  for (const f of ferro) {
    const linhas = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []
    for (const l of linhas) for (let i = 1; i < l.length; i++) if (noRS(l[i - 1]) || noRS(l[i])) segs.push([l[i - 1], l[i]])
  }
  const km = (a, b) => { const la = (a[1] + b[1]) / 2 * Math.PI / 180; return Math.hypot((a[0] - b[0]) * 111.32 * Math.cos(la), (a[1] - b[1]) * 110.57) }
  const kmSeg = (p, a, b) => {   // ponto ao segmento, em km, numa projeção local
    const la = p[1] * Math.PI / 180, X = q => [(q[0] - p[0]) * 111.32 * Math.cos(la), (q[1] - p[1]) * 110.57]
    const [ax, ay] = X(a), [bx, by] = X(b), dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0
    return Math.hypot(ax + t * dx, ay + t * dy)
  }
  for (const f of malha.features) {
    const p = pontoCentral(f.geometry)
    const dist = DESTINOS.map(([nome, c]) => [nome, Math.round(km(p, c))]).sort((a, b) => a[1] - b[1])
    let melhor = Infinity
    for (const [a, b] of segs) melhor = Math.min(melhor, kmSeg(p, a, b))   // o nome da linha na camada do DNIT não é confiável
    item(f.properties.code).logistica = { kmPortoRioGrande: dist.find(x => x[0] === 'Rio Grande')[1], portoMaisProximo: dist[0][0], kmPortoMaisProximo: dist[0][1], kmTrilho: Number.isFinite(melhor) ? Math.round(melhor * 10) / 10 : null }
  }
  d.fontes.logistica = 'DNIT GeoServer: portos e terminais da ANTAQ e malha ferroviária (EPL). Distâncias em linha reta do centro do município.'
  console.log(`logística: ${segs.length} trechos de trilho no RS; ex. Cruz Alta ${JSON.stringify(d.itens['4306106'].logistica)}`)
}

gravar(destino, { ...d, geradoEm: new Date().toISOString() })
console.log(`gravado ${path.relative(raiz, destino)} (${Math.round(fs.statSync(destino).size / 1024)} KB)`)
