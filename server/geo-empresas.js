// VAL Geomap — empresas do agro no RS, dos dados abertos do CNPJ (Receita Federal).
// O arquivo data/geo/empresas-rs.json.gz sai de scripts/geo-nomes.mjs --empresas. Só dado público de cadastro:
// razão social, nome fantasia, atividade (CNAE), município, localidade (sem número), capital, porte e o quadro de
// sócios (nome e qualificação). Telefone, e-mail e CPF (mesmo o mascarado da Receita) ficam fora.
import fs from 'node:fs'
import zlib from 'node:zlib'

// Grupos de atividade (CNAE 2.3, 7 dígitos). Lavoura, horti, permanente, sementes, pecuária e florestal produzem;
// serviços agrícolas (colheita, pulverização, pós-colheita) e o resto são a cadeia em volta.
export const GRUPOS = {
  lavoura: 'Lavouras temporárias (grãos, fumo, cana)',
  horti: 'Horticultura e flores',
  permanente: 'Lavouras permanentes (frutas, erva-mate)',
  sementes: 'Sementes e mudas',
  pecuaria: 'Pecuária',
  servicos: 'Serviços agrícolas e pós-colheita',
  florestal: 'Produção florestal',
  cerealista: 'Comércio de grãos e matérias-primas agrícolas',
  insumos: 'Insumos e máquinas agrícolas (atacado)',
  armazem: 'Armazéns gerais e depósitos',
  agroindustria: 'Agroindústria (óleo, arroz, trigo, milho, rações, lácteos, carnes)'
}
export const PRODUZ = new Set(['lavoura', 'horti', 'permanente', 'sementes', 'pecuaria', 'florestal'])
export function grupoCnae(cnae) {
  const c = String(cnae || '')
  if (c.startsWith('011')) return 'lavoura'
  if (c.startsWith('012')) return 'horti'
  if (c.startsWith('013')) return 'permanente'
  if (c.startsWith('014')) return 'sementes'
  if (c.startsWith('015')) return 'pecuaria'
  if (c.startsWith('016') || c.startsWith('017')) return 'servicos'
  if (c.startsWith('02')) return 'florestal'
  if (/^(4622|4623|4632001)/.test(c)) return 'cerealista'
  if (/^(4683|4661)/.test(c)) return 'insumos'
  if (/^52117/.test(c)) return 'armazem'
  if (/^(1011|1012|1041|1051|1052|1061|1062|1064|1066)/.test(c)) return 'agroindustria'
  return null
}
export const PORTES = { '00': 'Não informado', '01': 'Microempresa', '03': 'Empresa de pequeno porte', '05': 'Demais' }
export const COOPERATIVA = '2143'
// MEI e empresário individual levam o CPF ou o CNPJ no nome ("12.345.678 JOAO DA SILVA", "JOAO DA SILVA 12345678900")
export const limparRazao = s => String(s || '').replace(/^\d{2}\.\d{3}\.\d{3}\s+/, '').replace(/\s+\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, '').replace(/\s+/g, ' ').trim()
export const formatarCnpj = c => (String(c).length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : String(c))
export const soCnpj = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '')

// tokens/comparar/casar vêm do motor (mesma busca por nome dos imóveis)
export function createEmpresas({ arquivo, tokens, comparar, casar, nomeMunicipio = c => c }) {
  let base = null
  const existe = () => Boolean(arquivo && fs.existsSync(arquivo))
  function carregar() {
    if (base) return base
    if (!existe()) return null
    const t0 = Date.now()
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(arquivo)).toString('utf8'))
    const porCnpj = new Map(), porMun = new Map(), idx = new Map()
    const indexar = (w, e) => { let s = idx.get(w); if (!s) idx.set(w, (s = new Set())); s.add(e) }
    for (const e of d.itens) {
      e.tok = tokens(e.r); e.tokF = tokens(e.f)
      e.so = d.socios[e.c.slice(0, 8)] || []
      e.tokS = e.so.map(s => tokens(s[0]))
      porCnpj.set(e.c, e)
      if (!porMun.has(e.mun)) porMun.set(e.mun, []); porMun.get(e.mun).push(e)
      for (const w of new Set([...e.tok, ...e.tokF, ...e.tokS.flat()])) indexar(w, e)
    }
    base = { ...d, porCnpj, porMun, idx, ms: Date.now() - t0 }
    return base
  }
  const rot = (tabela, k) => (base?.[tabela]?.[k] || '')
  function resumo(e, { socios = true } = {}) {
    return {
      cnpj: formatarCnpj(e.c), id: e.c, matriz: e.m === '1', razaoSocial: e.r, nomeFantasia: e.f || '',
      grupo: e.g, grupoRotulo: GRUPOS[e.g] || '', produz: PRODUZ.has(e.g), atividade: `${e.a} ${rot('cnaes', e.a)}`.trim(),
      atividadesAgro: (e.s || []).map(c => `${c} ${rot('cnaes', c)}`.trim()),
      municipio: nomeMunicipio(e.mun), codigoIbge: e.mun, local: e.l || null, inicio: e.d || '',
      capitalSocial: e.k ?? null, porte: PORTES[e.p] || '', natureza: rot('naturezas', e.n), cooperativa: e.n === COOPERATIVA,
      ...(socios ? { socios: e.so.slice(0, 20).map(([nome, tipo, q, desde]) => ({ nome, tipo: tipo === 'J' ? 'empresa' : tipo === 'E' ? 'estrangeiro' : 'pessoa', qualificacao: rot('qualificacoes', q), desde: desde || '' })), totalSocios: e.so.length } : {})
    }
  }
  // nome buscado contra razão social, fantasia e cada sócio: todas as palavras (ou 2+ com pontuação boa)
  function casarEmpresa(q, e, minimo = 0.66) {
    let melhor = null
    const tenta = (t, onde) => {
      if (!t.length) return
      const c = comparar(q, t), n = c.casou.filter(Boolean).length
      if (!c.s || !c.casou.some(v => v === 1)) return
      const forte = n === q.length || (n >= 2 && c.s >= minimo)
      if (forte && (!melhor || c.s > melhor.s)) melhor = { s: c.s, onde, completo: n === q.length }
    }
    tenta(e.tok, 'razão social'); tenta(e.tokF, 'nome fantasia')
    e.tokS.forEach((t, i) => tenta(t, `sócio: ${e.so[i][0]}`))
    return melhor
  }
  function candidatos(q) {
    const b = carregar(), s = new Set()
    for (const w of q) for (const [x, lista] of b.idx) if (x[0] === w[0] && casar(w, x)) for (const e of lista) s.add(e)
    return s
  }
  function buscar({ q = '', municipios = [], grupos = [], capitalMin = 0, porte = '', cooperativa = null, produz = null, matriz = null, ordenar = 'capital', limite = 30 } = {}) {
    const b = carregar(); if (!b) return null
    const qt = q ? tokens(q) : []
    if (q && !qt.length) return { total: 0, itens: [] }
    const muns = new Set(municipios.filter(Boolean)), grs = new Set(grupos.filter(Boolean))
    const universo = qt.length ? candidatos(qt) : muns.size ? [...muns].flatMap(m => b.porMun.get(m) || []) : b.itens
    const out = []
    for (const e of universo) {
      if (muns.size && !muns.has(e.mun)) continue
      if (grs.size && !grs.has(e.g) && !(e.s || []).some(c => grs.has(grupoCnae(c)))) continue
      if (capitalMin && !((e.k || 0) >= capitalMin)) continue
      if (porte && e.p !== porte) continue
      if (cooperativa !== null && (e.n === COOPERATIVA) !== cooperativa) continue
      if (produz !== null && PRODUZ.has(e.g) !== produz) continue
      if (matriz !== null && (e.m === '1') !== matriz) continue
      let m = null
      if (qt.length) { m = casarEmpresa(qt, e); if (!m) continue }
      out.push({ e, m })
    }
    const ord = { capital: (x, y) => (y.e.k || 0) - (x.e.k || 0), antiga: (x, y) => String(x.e.d).localeCompare(String(y.e.d)), nova: (x, y) => String(y.e.d).localeCompare(String(x.e.d)) }[ordenar] || (() => 0)
    out.sort((x, y) => (qt.length ? (y.m.completo - x.m.completo) || (y.m.s - x.m.s) : 0) || ord(x, y))
    return { total: out.length, itens: out.slice(0, Math.max(1, Math.min(200, limite))).map(({ e, m }) => ({ ...resumo(e), ...(m ? { casou: m.onde, pontuacao: m.s } : {}) })) }
  }
  function resumoMunicipio(cod) {
    const b = carregar(); if (!b) return null
    const lista = b.porMun.get(cod) || [], grupos = {}
    for (const e of lista) grupos[e.g] = (grupos[e.g] || 0) + 1
    const principais = lista.filter(e => e.m === '1' || !lista.some(x => x !== e && x.c.slice(0, 8) === e.c.slice(0, 8) && x.m === '1'))
    return {
      total: lista.length, produtoras: lista.filter(e => PRODUZ.has(e.g)).length, cooperativas: lista.filter(e => e.n === COOPERATIVA).length,
      porGrupo: Object.entries(grupos).map(([g, n]) => ({ grupo: g, rotulo: GRUPOS[g] || g, empresas: n })).sort((x, y) => y.empresas - x.empresas),
      maiores: principais.sort((x, y) => (y.k || 0) - (x.k || 0)).slice(0, 10).map(e => resumo(e, { socios: false })),
      edicao: b.edicao, fonte: b.fonte
    }
  }
  const porCnpj = c => { const b = carregar(); const e = b?.porCnpj.get(soCnpj(c)); return e ? resumo(e) : null }
  // empresas do município (ou do estado) em que razão social ou sócio têm o nome dado; para as pistas de dono
  function comNome(nome, cod, limite = 5) {
    const b = carregar(); if (!b) return []
    const q = tokens(nome); if (q.length < 2) return []
    const out = []
    for (const e of candidatos(q)) {
      if (cod && e.mun !== cod) continue
      const m = casarEmpresa(q, e, 0.9); if (m?.completo) out.push({ ...resumo(e, { socios: false }), casou: m.onde, pontuacao: m.s })
    }
    return out.sort((x, y) => y.pontuacao - x.pontuacao || (y.capitalSocial || 0) - (x.capitalSocial || 0)).slice(0, limite)
  }
  return { existe, carregar, buscar, resumoMunicipio, porCnpj, comNome, info: () => (carregar() ? { edicao: base.edicao, fonte: base.fonte, total: base.itens.length, geradoEm: base.geradoEm } : null) }
}
