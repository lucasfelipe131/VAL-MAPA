// VAL Geomap — nomes ligados às áreas, de cadastros públicos, para a base (data/geo/).
//
//   node scripts/geo-nomes.mjs --embargos [csv]     responsáveis pelos embargos do IBAMA no RS (nome; CNPJ só de empresa)
//                                                   csv = termo_de_embargo.csv dos dados abertos do IBAMA (baixa se faltar)
//   node scripts/geo-nomes.mjs --empresas <pasta>   empresas do agro no RS, dos dados abertos do CNPJ (Receita Federal):
//                                                   pasta com Estabelecimentos*.zip, Empresas*.zip, Socios*.zip, Cnaes.zip,
//                                                   Municipios.zip, Naturezas.zip e Qualificacoes.zip de uma mesma edição
//
// Fica fora: CPF (inteiro ou mascarado), telefone, e-mail, número do endereço e, de empresário individual, a rua.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { grupoCnae, limparRazao } from '../server/geo-empresas.js'
import { slugNome } from '../server/geo-inteligencia.js'

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const destino = nome => path.join(raiz, 'data', 'geo', nome)
const args = process.argv.slice(2)
const malha = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'malhas', 'RS.json'), 'utf8'))
const nomesRS = new Map(malha.features.map(f => [f.properties.code, f.properties.name]))
const gravar = (f, texto) => { fs.writeFileSync(`${f}.tmp`, texto); fs.renameSync(`${f}.tmp`, f) }

// CSV com ; e aspas, campos podem ter quebra de linha dentro das aspas (o do IBAMA tem)
async function* linhasCsv(entrada) {
  const rl = readline.createInterface({ input: entrada, crlfDelay: Infinity })
  let campos = [], atual = '', aspas = false
  for await (let linha of rl) {
    if (!campos.length && !atual && !aspas) linha = linha.replace(/^﻿/, '')
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i]
      if (aspas) { if (ch === '"') { if (linha[i + 1] === '"') { atual += '"'; i++ } else aspas = false } else atual += ch }
      else if (ch === '"') aspas = true
      else if (ch === ';') { campos.push(atual); atual = '' }
      else atual += ch
    }
    if (aspas) { atual += '\n'; continue }
    campos.push(atual); yield campos; campos = []; atual = ''
  }
}

if (args.includes('--embargos')) {
  const i = args.indexOf('--embargos'), dado = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
  let csv = dado
  if (!csv) {
    csv = path.join((await import('node:os')).tmpdir(), 'val-geomap-ibama-termo_de_embargo.csv')
    if (!fs.existsSync(csv)) {
      console.log('IBAMA: baixando termos de embargo (CSV nacional, ~200 MB)…')
      const r = await fetch('https://stibamadadosabertosprd.blob.core.windows.net/dados-abertos/dados/TERMOS_DE_EMBARGO/TERMO_EMBARGO/termo_de_embargo.csv', { signal: AbortSignal.timeout(1800000) })
      if (!r.ok) throw new Error(`IBAMA HTTP ${r.status}`)
      fs.writeFileSync(csv, Buffer.from(await r.arrayBuffer()))
    }
  }
  const itens = {}
  let cab = null, lidos = 0, pf = 0, pj = 0
  for await (const c of linhasCsv(fs.createReadStream(csv, 'utf8'))) {
    if (!cab) { cab = Object.fromEntries(c.map((n, k) => [n, k])); continue }
    lidos++
    const v = k => String(c[cab[k]] ?? '').trim()
    if (!v('COD_MUNICIPIO').startsWith('43') || v('SIT_CANCELADO') === 'S') continue
    const n = `${v('NUM_TAD')}${v('SER_TAD') ? '-' + v('SER_TAD') : ''}`   // mesma chave de scripts/geo-camadas.mjs
    const doc = v('CPF_CNPJ_EMBARGADO').replace(/\D/g, ''), empresa = doc.length === 14
    empresa ? pj++ : pf++
    itens[`IBAMA|${n}`] = {
      nome: v('NOME_EMBARGADO').replace(/\s+/g, ' '), pessoa: empresa ? 'empresa' : 'pessoa', ...(empresa ? { cnpj: doc } : {}),
      imovel: v('NOME_IMOVEL').replace(/\s+/g, ' ').slice(0, 120), descricao: v('DES_TAD').replace(/\s+/g, ' ').slice(0, 400),
      municipio: v('COD_MUNICIPIO'), data: v('DAT_EMBARGO').slice(0, 10)
    }
  }
  const out = { fonte: 'IBAMA, dados abertos: termos de embargo (nome do embargado; CNPJ só quando é empresa, CPF não é guardado)', geradoEm: new Date().toISOString(), itens }
  gravar(destino('embargos-responsaveis.json'), JSON.stringify(out))
  console.log(`embargos: ${Object.keys(itens).length} termos no RS (${pf} de pessoas, ${pj} de empresas), de ${lidos} no país`)
}

// Produtores com armazém próprio (CONAB, SICARM): unidades de pessoa física no RS, com o ponto e a capacidade.
// A CONAB não publica o nome de pessoa física (vem "PESSOA FÍSICA"): o armazém se liga ao produtor pelo lugar,
// quando o ponto cai numa área com nome conhecido (server/geo-prospeccao.js).
if (args.includes('--conab')) {
  const r = await fetch('https://portaldeinformacoes.conab.gov.br/downloads/arquivos/ArmazensCadastrados.txt', { signal: AbortSignal.timeout(600000) })
  if (!r.ok) throw new Error(`CONAB HTTP ${r.status}`)
  const linhas = new TextDecoder('latin1').decode(await r.arrayBuffer()).split(/\r?\n/), cab = linhas[0].split(';').map(x => x.trim())
  const col = n => cab.findIndex(c => c.startsWith(n))
  const C = { esp: col('dsc_especie'), pes: col('dsc_tipo_pessoa'), cod: col('cod_ibge'), uf: col('uf'), cap: col('qtd_capacidade_estatica'), lat: col('latitude'), lon: col('longitude'), }
  if (Object.values(C).some(i => i < 0)) throw new Error(`CONAB mudou o arquivo: ${cab.join(' | ')}`)
  const num = v => { const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
  const pontos = []
  for (const l of linhas.slice(1)) {
    const c = l.split(';').map(x => x.trim()); if (c[C.uf] !== 'RS' || !/F[IÍ]SICA/i.test(c[C.pes]) || !nomesRS.has(c[C.cod])) continue
    const la = Number(c[C.lat]), lo = Number(c[C.lon]); if (!(la < -27 && la > -34 && lo > -58 && lo < -49)) continue
    pontos.push([Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5, Math.round(num(c[C.cap])), /GRANEL/i.test(c[C.esp]) ? 'g' : 'c', c[C.cod]])
  }
  const fonte = `CONAB, Cadastro Nacional de Unidades Armazenadoras (SICARM): unidades de pessoa física no RS, baixado em ${new Date().toISOString().slice(0, 10)}`
  gravar(destino('produtores-armazem.json'), JSON.stringify({ fonte, geradoEm: new Date().toISOString(), campos: ['lat', 'lng', 'capacidadeT', 'especie (g=granel, c=convencional)', 'codigoIbge'], pontos }))
  console.log(`CONAB: ${pontos.length} armazéns de produtores (pessoa física) no RS com ponto`)
}

if (args.includes('--empresas')) {
  const pasta = args[args.indexOf('--empresas') + 1]
  if (!pasta || !fs.existsSync(pasta)) throw new Error('Informe a pasta com os arquivos .zip do CNPJ.')
  const zips = prefixo => fs.readdirSync(pasta).filter(n => new RegExp(`^${prefixo}\\d*\\.zip$`, 'i').test(n)).sort().map(n => path.join(pasta, n))
  // cada .zip tem um CSV em Latin-1, ; e aspas, sem quebra de linha dentro dos campos
  async function* ler(zip) {
    const p = spawn('unzip', ['-p', zip], { stdio: ['ignore', 'pipe', 'inherit'] })
    p.stdout.setEncoding('latin1')
    const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity })
    for await (const linha of rl) if (linha.length > 2) yield linha
    await new Promise(ok => p.on('close', ok))
  }
  const campos = l => l.slice(1, -1).split('";"')
  const tabela = async nome => { const t = {}; for (const z of zips(nome)) for await (const l of ler(z)) { const [k, v] = campos(l); t[k] = v } return t }
  const [cnaes, naturezas, qualificacoes, municipiosRfb] = await Promise.all(['Cnaes', 'Naturezas', 'Qualificacoes', 'Municipios'].map(tabela))
  // município da Receita (código do SIAFI) → código do IBGE, pelo nome
  const porSlug = new Map([...nomesRS].map(([cod, nome]) => [slugNome(nome), cod]))
  const mapaMun = new Map(), semPar = new Set()
  const ibgeDe = rfb => {
    if (mapaMun.has(rfb)) return mapaMun.get(rfb)
    const s = slugNome(municipiosRfb[rfb] || '')
    let cod = porSlug.get(s) || porSlug.get(s.replace(/ /g, '')) || null
    if (!cod) for (const [k, v] of porSlug) if (k.replace(/ /g, '') === s.replace(/ /g, '') || (Math.abs(k.length - s.length) <= 1 && [...k].filter((ch, i) => ch !== s[i]).length <= 1)) { cod = v; break }
    if (!cod) semPar.add(municipiosRfb[rfb] || rfb)
    mapaMun.set(rfb, cod); return cod
  }

  // 1) estabelecimentos ativos no RS com atividade do agro (principal, ou secundária de produção: lavoura, pecuária, florestal)
  const t0 = Date.now(), itens = [], basicos = new Set()
  let vistos = 0, noRS = 0
  for (const z of zips('Estabelecimentos')) {
    for await (const l of ler(z)) {
      vistos++
      if (!l.includes('";"RS";"')) continue
      const c = campos(l)
      if (c[19] !== 'RS' || c[5] !== '02') continue
      noRS++
      const sec = (c[12] || '').split(',').filter(Boolean)
      let g = grupoCnae(c[11])
      const secAgro = sec.filter(x => grupoCnae(x))
      if (!g) { const p = secAgro.find(x => /^0(1[1-5]|2)/.test(x)); if (!p) continue; g = grupoCnae(p) }   // só a secundária de produção traz quem tem outra atividade principal
      const mun = ibgeDe(c[20]); if (!mun) continue
      const cnpj = `${c[0]}${c[1]}${c[2]}`
      itens.push({ c: cnpj, m: c[3], f: c[4].replace(/\s+/g, ' ').trim(), d: c[10] ? `${c[10].slice(0, 4)}-${c[10].slice(4, 6)}-${c[10].slice(6, 8)}` : '', a: c[11], s: secAgro.slice(0, 8), g, mun,
        l: { lg: [c[13], c[14]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(), b: c[17].replace(/\s+/g, ' ').trim(), cep: c[18] } })
      basicos.add(c[0])
    }
    console.log(`  ${path.basename(z)}: ${itens.length} do agro no RS até aqui (${noRS} ativos no RS, ${vistos} lidos, ${Math.round((Date.now() - t0) / 1000)} s)`)
  }
  // 2) razão social, natureza, capital e porte
  const empresas = new Map()
  for (const z of zips('Empresas')) {
    for await (const l of ler(z)) {
      const b = l.slice(1, l.indexOf('"', 1)); if (!basicos.has(b)) continue
      const c = campos(l)
      empresas.set(b, { r: limparRazao(c[1]), n: c[2], k: Number(String(c[4] || '0').replace(/\./g, '').replace(',', '.')) || 0, p: c[5] })
    }
    console.log(`  ${path.basename(z)}: ${empresas.size} empresas`)
  }
  // 3) quadro de sócios: nome, tipo (F pessoa, J empresa, E estrangeiro), qualificação e ano de entrada
  const socios = {}
  for (const z of zips('Socios')) {
    for await (const l of ler(z)) {
      const b = l.slice(1, l.indexOf('"', 1)); if (!basicos.has(b)) continue
      const c = campos(l), lista = (socios[b] ||= [])
      if (lista.length < 40) lista.push([c[2].replace(/\s+/g, ' ').trim(), c[1] === '1' ? 'J' : c[1] === '3' ? 'E' : 'F', c[4], (c[5] || '').slice(0, 4)])
    }
    console.log(`  ${path.basename(z)}: sócios de ${Object.keys(socios).length} empresas`)
  }
  const final = []
  for (const e of itens) {
    const x = empresas.get(e.c.slice(0, 8)); if (!x) continue
    // empresário individual: a razão social é o nome da pessoa; a rua fica fora (só localidade e CEP)
    if (x.n === '2135') e.l = { b: e.l.b, cep: e.l.cep }
    final.push({ ...e, ...x })
  }
  const usados = new Set(final.flatMap(e => [e.a, ...e.s]))
  const edicao = path.basename(path.resolve(pasta)).match(/\d{4}-\d{2}/)?.[0] || ''
  const out = {
    v: 1, fonte: `Receita Federal, dados abertos do CNPJ${edicao ? ` (edição ${edicao})` : ''}: estabelecimentos ativos no RS com atividade do agro`, edicao, geradoEm: new Date().toISOString(),
    cnaes: Object.fromEntries([...usados].filter(k => cnaes[k]).map(k => [k, cnaes[k]])), naturezas, qualificacoes,
    socios: Object.fromEntries(Object.entries(socios).filter(([b]) => empresas.has(b))), itens: final
  }
  gravar(destino('empresas-rs.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 }))
  console.log(`empresas: ${final.length} estabelecimentos do agro no RS (${final.filter(e => e.m === '1').length} matrizes), sócios de ${Object.keys(out.socios).length} empresas; ${(fs.statSync(destino('empresas-rs.json.gz')).size / 1048576).toFixed(1)} MB em ${Math.round((Date.now() - t0) / 1000)} s`)
  if (semPar.size) console.log(`  municípios da Receita sem par no IBGE (ficaram de fora): ${[...semPar].join(', ')}`)
}
