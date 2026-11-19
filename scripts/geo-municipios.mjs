// VAL Geomap — dados da ficha do município calculados antes e embarcados com a base (data/geo/municipios-*.json).
// O servidor usa esses arquivos quando existem e só vai à fonte na hora para o que faltar.
//
//   node scripts/geo-municipios.mjs --relevo            relevo dos 497 municípios (OpenTopoData SRTM 30 m; ~15 min,
//                                                        respeita 1 chamada/s; retoma de onde parou)
//   node scripts/geo-municipios.mjs --credito [anos]    crédito rural do SICOR (BCB) por município, cultura e ano
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFontesMunicipio } from '../server/geo-municipio.js'

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const saida = nome => path.join(raiz, 'data', 'geo', `municipios-${nome}.json`)
const ler = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return padrao } }
const gravar = (f, d) => { fs.writeFileSync(`${f}.tmp`, JSON.stringify(d)); fs.renameSync(`${f}.tmp`, f) }
const malha = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'malhas', 'RS.json'), 'utf8'))
const args = process.argv.slice(2)

if (args.includes('--relevo')) {
  const f = saida('relevo'), d = ler(f, { fonte: '', geradoEm: '', itens: {} })
  const fontes = createFontesMunicipio()
  const faltam = malha.features.filter(x => !d.itens[x.properties.code])
  console.log(`relevo: ${Object.keys(d.itens).length} prontos, ${faltam.length} a calcular`)
  let n = 0
  for (const feat of faltam) {
    try {
      const r = await fontes.relevo(feat.properties.code, feat.geometry)
      d.fonte = r.fonte; d.itens[feat.properties.code] = r; d.geradoEm = new Date().toISOString()
      if (++n % 10 === 0) { gravar(f, d); console.log(`  ${n}/${faltam.length} · ${feat.properties.name}: ${r.altitude.media} m, ${r.declividade?.mecanizavelPct}% mecanizável`) }
    } catch (e) { console.log(`  falhou ${feat.properties.name}: ${e.message}`); if (/429|limite|limit/i.test(e.message)) break }
  }
  gravar(f, d)
  console.log(`relevo: ${Object.keys(d.itens).length} de ${malha.features.length} municípios em ${path.relative(raiz, f)}`)
}

if (args.includes('--credito')) {
  // Matriz de Dados do Crédito Rural (BCB, API OData do SICOR): custeio por município, produto e mês de emissão,
  // somado por safra (julho a junho). Uma consulta por mês, só o RS (cdEstado 24 no cadastro do BCB).
  // A API devolve erro 500 de vez em quando: cada mês baixado fica guardado em cache (pasta temporária) e
  // rodar de novo só busca os que faltam. Meses sem resposta são avisados no fim e o script sai com erro.
  const os = await import('node:os')
  const B = 'https://olinda.bcb.gov.br/olinda/servico/SICOR/versao/v2/odata/CusteioMunicipioProduto'
  const cacheDir = path.join(os.tmpdir(), 'val-geomap-sicor'); fs.mkdirSync(cacheDir, { recursive: true })
  const hoje = new Date(), anos = args.filter(a => /^\d{4}$/.test(a)).map(Number)
  const de = anos.length ? Math.min(...anos) : hoje.getFullYear() - 2
  const nomeProd = x => String(x || '').replace(/"/g, '').trim().toLowerCase().replace(/(^|[\s(/-])\p{L}/gu, c => c.toUpperCase())
  const meses = []
  for (let ano = de; ano <= hoje.getFullYear(); ano++) for (let mes = 1; mes <= 12; mes++) if (ano < hoje.getFullYear() || mes <= hoje.getMonth() + 1) meses.push(`${ano}-${String(mes).padStart(2, '0')}`)
  const faltando = []
  for (const am of meses) {
    const arq = path.join(cacheDir, `${am}.json`)
    if (fs.existsSync(arq) && am < `${hoje.getFullYear()}-${String(hoje.getMonth()).padStart(2, '0')}`) continue   // meses antigos não mudam; os 2 últimos sempre de novo
    const [ano, mm] = am.split('-')
    const url = `${B}?$filter=cdEstado%20eq%20'24'%20and%20AnoEmissao%20eq%20'${ano}'%20and%20MesEmissao%20eq%20'${mm}'&$select=codIbge,nomeProduto,VlCusteio,AreaCusteio,Atividade&$top=60000&$format=json`
    let linhas = null
    for (let t = 0; t < 8 && !linhas; t++) {
      try { const r = await fetch(url, { signal: AbortSignal.timeout(180000) }); if (r.ok) linhas = (await r.json()).value; else console.log(`  ${am}: HTTP ${r.status}`) } catch (e) { console.log(`  ${am}: ${e.cause?.code || e.message}`) }
      if (!linhas) await new Promise(ok => setTimeout(ok, Math.min(60000, 5000 * 2 ** t)))
    }
    if (!linhas) { faltando.push(am); continue }
    if (linhas.length >= 60000) console.log(`  ${am}: atenção, ${linhas.length} linhas (pode ter cortado)`)
    const agg = {}
    for (const l of linhas) { const k = `${l.codIbge}|${nomeProd(l.nomeProduto) || 'Outros'}|${l.Atividade === '2' ? 'p' : 'a'}`; const x = (agg[k] ||= [0, 0]); x[0] += Number(l.AreaCusteio) || 0; x[1] += Number(l.VlCusteio) || 0 }
    fs.writeFileSync(arq, JSON.stringify(agg))
    console.log(`  ${am}: ${linhas.length} linhas`)
  }
  const d = { fonte: 'Banco Central, Matriz de Dados do Crédito Rural (SICOR), custeio por município e produto', geradoEm: new Date().toISOString(), dadosAte: '', mesesSemDado: faltando, itens: {} }
  for (const am of meses) {
    const arq = path.join(cacheDir, `${am}.json`); if (!fs.existsSync(arq)) continue
    const agg = JSON.parse(fs.readFileSync(arq, 'utf8')); if (!Object.keys(agg).length) continue
    const [ano, mes] = am.split('-').map(Number), safra = mes >= 7 ? `${ano}/${String(ano + 1).slice(2)}` : `${ano - 1}/${String(ano).slice(2)}`
    for (const [k, [ha, vl]] of Object.entries(agg)) {
      const [cod, prod, tipo] = k.split('|'), s = ((d.itens[cod] ||= {})[safra] ||= {}), x = (s[prod] ||= [0, 0, tipo])
      x[0] += ha; x[1] += vl
    }
    d.dadosAte = am
  }
  for (const m of Object.values(d.itens)) for (const s of Object.values(m)) for (const x of Object.values(s)) { x[0] = Math.round(x[0] * 10) / 10; x[1] = Math.round(x[1]) }
  // a safra que começa antes do primeiro mês baixado sai incompleta: fica de fora
  const primeira = meses.find(am => fs.existsSync(path.join(cacheDir, `${am}.json`)))
  if (primeira && !primeira.endsWith('-07')) { const [a, m] = primeira.split('-').map(Number); const corte = m >= 7 ? `${a}/${String(a + 1).slice(2)}` : `${a - 1}/${String(a).slice(2)}`; for (const m2 of Object.values(d.itens)) delete m2[corte] }
  gravar(saida('credito'), d)
  console.log(`crédito: ${Object.keys(d.itens).length} municípios, dados até ${d.dadosAte}${faltando.length ? `; SEM RESPOSTA: ${faltando.join(', ')} (rode de novo)` : ''}`)
  if (faltando.length) process.exitCode = 1
}
