// VAL Geomap — produtores da base: quem aparece nos cadastros públicos de cada município, já com pin.
// Junta, por município e pelo nome:
//   · parcelas do SIGEF cujo nome traz o nome de uma pessoa ou empresa ("Fazenda Boa Vista – João da Costa Beber")
//     → o pin fica na maior parcela, e as parcelas viram as áreas do produtor;
//   · armazéns de pessoa física da CONAB (o produtor com silo próprio): a CONAB não publica o nome, então o armazém
//     soma para o produtor cuja área (parcela SIGEF, ou o CAR que a contém) tem o ponto do armazém;
//   · empresas do agro do CNPJ (razão social, ou o sócio pessoa) → sem endereço exato; ganham pin quando casam
//     com uma parcela ou um armazém do mesmo município.
// Nada aqui entra no cadastro de produtores do VAL: é a camada de prospecção, filtrada na tela.
import { createHash } from 'node:crypto'
import { PRODUZ, COOPERATIVA } from './geo-empresas.js'

// primeiros nomes comuns no RS (reforçados pelos sócios do CNPJ e armazenadores da CONAB quando há)
const PRIMEIROS_BASE = 'abel ademar ademir adilson adriana adriano afonso airton alberto alceu alcides aldo alexandre alfredo alice aline altair alvaro amauri ana anderson andre andrea angela angelo anselmo antonio arlindo armando arno arnaldo arthur artur augusto aurelio benedito bernardo bruno caetano camila carla carlos carmen catarina cecilia celso cesar christian clair claudia claudio cleber clovis cristiano daniel danilo darci dario davi david debora delmar denise diego dilson dirceu domingos dorival edemar edgar edson eduardo elaine eliane elias elio elisa elton emerson enio erni ernesto euclides eugenio evandro fabiano fabio felipe fernanda fernando flavio francisco frederico gabriel gelson genor geraldo gerson getulio gilberto gilmar giovani glaucia guilherme gustavo helena helio henrique hugo idalino ilson ines irineu isabel itamar ivan ivo jacinto jaime jair jairo jandir jeferson joana joao joaquim jonas jorge jose josue juarez julia juliana julio jurandir laercio lauro leandro leila leo leonardo leonir lidia lino lourdes lucas luciana luciano luis luiz luzia mara marcelo marcia marcio marcos marcos maria mariana mario marli marlene martin mateus matheus mauricio mauro miguel milton moises nadir nelson nestor neusa nilo nilson nilton norberto odair odilon olavo orlando osmar osvaldo otavio otto paula paulo pedro rafael raul regina reinaldo renato ricardo roberto rodrigo rogerio romeu ronaldo rosa rosane rubens rudi sandra sebastiao selmo sergio silvio simone sonia tadeu tania teresa tiago valdecir valdemar valdir valmir valter vanderlei vania vera vicente vilmar vitor volmir wagner waldemar walter wilson'.split(' ')
// palavras que, antes de um nome, fazem dele nome de lugar ("Santa Rita", "São José", "Passo do Pedro")
const LUGAR = new Set(['sao', 'santo', 'santa', 'santos', 'nossa', 'senhora', 'bom', 'boa', 'vila', 'ponte', 'rio', 'passo', 'capao', 'linha', 'cerro', 'arroio', 'sanga', 'coxilha', 'picada', 'rincao', 'lajeado', 'barra', 'colonia', 'povoado', 'morro', 'vale', 'campo', 'invernada', 'potreiro', 'santana', 'divino', 'espirito', 'menino', 'cristo', 'dom', 'frei', 'padre', 'cel', 'coronel', 'general', 'gal'])
// fim do nome da pessoa dentro do nome da área
const PARA = new Set(['fazenda', 'faz', 'fda', 'sitio', 'estancia', 'granja', 'chacara', 'lote', 'gleba', 'parte', 'area', 'parcela', 'matricula', 'mat', 'imovel', 'remanescente', 'quinhao', 'condominio', 'lt', 'gl', 'n', 'no', 'nr', 'km', 'reserva', 'app', 'rl', 'campo', 'lavoura', 'potreiro', 'invernada'])
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'del', 'van', 'von'])
const EMPRESA = /\b(ltda|s\/?a|eireli|agropecuaria|agropastoril|agricola|agroindustrial|cooperativa|comercio|industria|empreendimentos|participacoes|holding|agro)\b/
const slug = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const titulo = w => (PARTICULAS.has(slug(w)) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())

export function primeirosNomes(extra = []) {
  const s = new Set(PRIMEIROS_BASE)
  for (const n of extra) if (n && n.length >= 3 && !LUGAR.has(n) && !PARA.has(n) && !PARTICULAS.has(n)) s.add(n)
  return s
}

// Nome de produtor dentro do nome de uma área. Devolve { nome, tipo } ou null quando é só nome de lugar.
export function nomeProdutor(bruto, primeiros) {
  const txt = String(bruto || '').replace(/\s+/g, ' ').trim()
  if (txt.length < 5) return null
  const palavras = txt.match(/[\p{L}']+|\d+|[-–/()|,;.:]/gu) || []
  const s = palavras.map(slug)
  // empresa no nome da área: o trecho (entre traços, barras, parênteses) com a razão social
  if (EMPRESA.test(slug(txt))) {
    const trecho = txt.split(/\s[-–|;]\s|[()]/).find(t => EMPRESA.test(slug(t)))
    const ws = (trecho || '').match(/[\p{L}']+/gu) || []
    while (ws.length && (PARA.has(slug(ws[0])) || PARTICULAS.has(slug(ws[0])))) ws.shift()
    if (ws.length < 2) return null
    return { nome: ws.map(w => (/^(ltda|sa|me|epp|eireli)$/i.test(w) ? w.toUpperCase() : titulo(w))).join(' '), tipo: 'empresa' }
  }
  for (let i = 0; i < s.length; i++) {
    if (!primeiros.has(s[i]) || (i > 0 && LUGAR.has(s[i - 1]))) continue
    const nome = [palavras[i]]
    let fortes = 1
    // primeiro nome fora da lista logo antes, no começo do trecho ("Eloi Antonio Pretto", "Fazenda Gian Carlo Brutti")
    const antes = i - 1
    if (antes >= 0 && /^\p{L}{3,}$/u.test(palavras[antes]) && !LUGAR.has(s[antes]) && !PARA.has(s[antes]) && !PARTICULAS.has(s[antes]) &&
      (antes === 0 || /^[-–/(|,;.:]$/.test(palavras[antes - 1]) || PARA.has(s[antes - 1]))) { nome.unshift(palavras[antes]); fortes++ }
    for (let j = i + 1; j < s.length; j++) {
      const w = s[j]
      if (!/^\p{L}/u.test(palavras[j]) || PARA.has(w)) break
      nome.push(palavras[j]); if (!PARTICULAS.has(w)) fortes++
    }
    while (nome.length && PARTICULAS.has(slug(nome[nome.length - 1]))) nome.pop()
    if (fortes >= 2) return { nome: nome.map(titulo).join(' '), tipo: 'pessoa' }
  }
  return null
}

const chave = toks => [...new Set(toks)].sort().join(' ')
const ponta = toks => (toks.length >= 2 ? `${toks[0]}|${toks[toks.length - 1]}` : '')
const idDe = k => createHash('sha1').update(k).digest('base64url').slice(0, 12)
const NIV = { ok: 0, atencao: 1, critico: 2 }

// imoveis: registros do motor; armazensPF: [lat, lng, t, esp, cod]; localizar(lng, lat) → registros que contêm o ponto;
// empresas: itens crus do arquivo do CNPJ
export function montarProspectos({ imoveis, armazensPF = [], localizar = () => [], empresas = [], tokens, primeiros }) {
  const lista = [], porChave = new Map(), porPonta = new Map()
  const novo = (mun, nome, tipo, toks) => {
    const k = `${mun}|${chave(toks)}`
    const p = { id: idDe(k), nome, tipo, mun, ponto: null, areas: [], areaHa: 0, lavouraHa: 0, potT: 0, armazemT: 0, armazens: [], empresas: [], fontes: { sigef: 0, conab: 0, cnpj: 0 }, risco: 'ok', maior: 0 }
    lista.push(p); porChave.set(k, p)
    const pk = ponta(toks); if (pk) { const kk = `${mun}|${pk}`; porPonta.set(kk, porPonta.has(kk) ? null : p) }   // null = ambíguo
    return p
  }
  const achar = (mun, toks) => porChave.get(`${mun}|${chave(toks)}`) || (ponta(toks) && porPonta.get(`${mun}|${ponta(toks)}`)) || null

  // 1) parcelas do SIGEF com nome de gente (ou de empresa)
  for (const r of imoveis) {
    if (r.f === 'CAR' || !r.nome) continue
    const n = nomeProdutor(r.nome, primeiros); if (!n) continue
    const toks = tokens(n.nome); if (toks.length < 2) continue
    const p = achar(r.mun, toks) || novo(r.mun, n.nome, n.tipo, toks)
    p.areas.push(r.id); p.fontes.sigef++
    p.areaHa += r.a || 0; p.lavouraHa += r.lav || 0; p.potT += r.pot?.bom || 0
    if ((r.a || 0) > p.maior) { p.maior = r.a || 0; p.ponto = r.c }
    if (NIV[r.risco?.nivel] > NIV[p.risco]) p.risco = r.risco.nivel
  }
  // 2) produtores com armazém próprio (CONAB, sem nome): pelo lugar. O ponto cai numa parcela com nome, ou num CAR
  //    com parcela de nome dentro; com mais de um dono possível no CAR, fica com o de maior área.
  const porArea = new Map(); for (const p of lista) for (const a of p.areas) porArea.set(a, p)
  for (const [lat, lng, t, esp] of armazensPF) {
    let p = null
    for (const r of localizar(lng, lat)) {
      p = porArea.get(r.id) || null
      if (!p && r.parcelas) p = r.parcelas.map(id => porArea.get(id)).filter(Boolean).sort((x, y) => y.areaHa - x.areaHa)[0] || null
      if (p) break
    }
    if (!p) continue
    p.fontes.conab++; p.armazemT += t || 0; p.armazens.push([lat, lng, t, esp])
  }
  // 3) empresas do agro que produzem (CNPJ): pela razão social; senão pelo sócio pessoa; senão entra sozinha
  const vistas = new Set()
  for (const e of empresas) {
    if (!PRODUZ.has(e.g) || e.n === COOPERATIVA) continue
    const basico = e.c.slice(0, 8), k = `${e.mun}|${basico}`
    if (vistas.has(k)) continue   // filial no mesmo município da matriz: uma vez só
    vistas.add(k)
    const resumo = { cnpj: e.c, razao: e.r, cnae: e.a, capital: e.k || 0, grupo: e.g }
    const tR = tokens(e.r)
    let p = tR.length >= 2 ? achar(e.mun, tR) : null
    if (!p) for (const [nome, tipo] of (e.so || [])) { if (tipo !== 'F') continue; const t = tokens(nome); if (t.length >= 2 && (p = achar(e.mun, t))) { resumo.socio = nome; break } }
    if (!p) { if (tR.length < 1) continue; p = novo(e.mun, e.r.split(' ').map(titulo).join(' '), e.n === '2135' ? 'pessoa' : 'empresa', tR.length >= 2 ? tR : [...tR, basico]) }
    p.fontes.cnpj++; if (p.empresas.length < 6) p.empresas.push(resumo)
  }
  for (const p of lista) { p.areaHa = Math.round(p.areaHa * 10) / 10; p.lavouraHa = Math.round(p.lavouraHa * 10) / 10; p.potT = Math.round(p.potT); p.armazemT = Math.round(p.armazemT); delete p.maior }
  const porId = new Map(lista.map(p => [p.id, p])), porMun = new Map()
  for (const p of lista) { if (!porMun.has(p.mun)) porMun.set(p.mun, []); porMun.get(p.mun).push(p); for (const a of p.areas) porArea.set(a, p) }
  return { lista, porId, porMun, porArea }
}

// filtros da camada (e da IA): todos opcionais
export function filtrarProspectos(lista, f = {}, { clienteDe = () => null } = {}) {
  const muns = new Set((f.municipios || []).filter(Boolean)), bbox = f.bbox
  const out = []
  for (const p of lista) {
    if (muns.size && !muns.has(p.mun)) continue
    if (bbox && !(p.ponto && p.ponto[0] >= bbox[0] && p.ponto[0] <= bbox[2] && p.ponto[1] >= bbox[1] && p.ponto[1] <= bbox[3])) continue
    if (f.comPonto && !p.ponto) continue
    if (f.tipo && p.tipo !== f.tipo) continue
    if (f.areaMin && !(p.areaHa >= f.areaMin)) continue
    if (f.potMin && !(p.potT >= f.potMin)) continue
    if (f.fonte && !(p.fontes[f.fonte] > 0)) continue
    if (f.semCritico && p.risco === 'critico') continue
    if (f.nome) { const q = slug(f.nome); if (!slug(p.nome).includes(q) && !p.empresas.some(e => slug(e.razao).includes(q))) continue }
    const cliente = clienteDe(p)
    if (f.naoClientes && cliente) continue
    if (f.soClientes && !cliente) continue
    out.push({ p, cliente })
  }
  const ord = { area: (x, y) => y.p.areaHa - x.p.areaHa, potencial: (x, y) => y.p.potT - x.p.potT, armazem: (x, y) => y.p.armazemT - x.p.armazemT, nome: (x, y) => x.p.nome.localeCompare(y.p.nome, 'pt-BR') }[f.ordenar] || ((x, y) => (y.p.potT - x.p.potT) || (y.p.areaHa - x.p.areaHa) || (y.p.armazemT - x.p.armazemT))
  return out.sort(ord)
}
