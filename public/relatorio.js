// VAL Geomap — relatórios para imprimir ou salvar em PDF.
//   /relatorio.html?produtor=<id>     ficha do produtor: áreas, potencial, porte, socioambiental, histórico, documentos
//   /relatorio.html?municipio=<nome>  município: potencial, mercado, porte dos imóveis, carteira, oportunidades, alertas
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (v, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }))
const dataBr = s => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(+d) ? String(s) : d.toLocaleDateString('pt-BR') }
const dataHora = s => new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const NIVEL = { critico: 'Crítico', atencao: 'Atenção', ok: 'Sem alerta' }
const COR_NIVEL = { critico: '#d92d20', atencao: '#e5a528', ok: '#00c896' }
const selo = n => `<span class="selo ${esc(n || 'ok')}">${NIVEL[n || 'ok']}</span>`
const CATEG = { matricula: 'Matrícula', car: 'CAR', kml: 'KML / mapa', laudo: 'Laudo', contrato: 'Contrato', outro: 'Outro' }
const RESULTADO = { positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo' }
const PORTES = [['minifundio', 'Minifúndio (< 1 MF)'], ['pequeno', 'Pequeno (1 a 4 MF)'], ['medio', 'Médio (4 a 15 MF)'], ['grande', 'Grande (> 15 MF)'], ['sem', 'Sem módulo no CAR']]
const params = new URLSearchParams(location.search)
let rot = {}

async function api(caminho) {
  const r = await fetch(caminho, { credentials: 'same-origin' })
  const corpo = r.headers.get('content-type')?.includes('json') ? await r.json() : null
  if (!r.ok) throw Object.assign(new Error(corpo?.error || `Erro ${r.status}`), { status: r.status })
  return corpo
}
const aviso = (texto, erro) => { $('#relatorio').innerHTML = `<p class="aviso${erro ? ' erro' : ''}">${texto}</p>`; $('#estado').textContent = '' }
const pronto = () => { $('#estado').textContent = 'Pronto para imprimir. Na janela de impressão, escolha “Salvar como PDF” para gerar o arquivo.'; $('#imprimir').disabled = false }
$('#imprimir').onclick = () => window.print()

async function iniciar() {
  try {
    const s = await api('/api/session')
    if (s.protected && !s.authenticated) return aviso('Entre no <a href="/">VAL Geomap</a> com a senha e abra o relatório de novo.', true)
    const boot = await api('/api/bootstrap')
    for (const g of ['commodities', 'relationships', 'intentStatuses', 'interactionKinds', 'priceUnits']) rot[g] = Object.fromEntries((boot.catalog?.[g] || []).map(i => [i.value, i.label]))
    if (params.get('produtor')) await relatorioProdutor(params.get('produtor'), boot)
    else if (params.get('municipio')) await relatorioMunicipio(params.get('municipio'))
    else aviso('Abra o relatório pelo cadastro do produtor ou pelo painel do mapa do VAL Geomap.')
  } catch (e) { aviso(esc(e.message), true) }
}

// ---------------------------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------------------------
const cabecalho = (tipo, titulo, meta) => `<header class="cabecalho">
  <div class="marca"><img class="simbolo" src="/brand/val-symbol-official.png" alt=""><img class="palavra" src="/brand/val-wordmark-only-official.png" alt="VAL"><span>Geomap</span></div>
  <div class="titulo"><div class="tipo">${esc(tipo)}</div><h1>${esc(titulo)}</h1><div class="meta">${meta.filter(Boolean).map(m => `<span>${esc(m)}</span>`).join('')}</div></div></header>`
const kpi = (rotulo, valor, detalhe, html, classe = '') => `<div class="kpi ${classe}"><div class="rot">${esc(rotulo)}</div><div class="val">${html ? valor : esc(valor)}</div><div class="det">${esc(detalhe || '')}</div></div>`
function rodape(base, extra = []) {
  const fontes = [...(base?.fontes || []), ...(base?.camadas?.fontes || [])].filter(f => f && !/Gerado por ferramentas/.test(f))
  return `<footer class="rodape">
    <p><b>Fontes:</b></p><ul>${fontes.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <p>Base de imóveis de ${dataBr(base?.geradoEm)}${base?.camadas ? `; camadas socioambientais de ${dataBr(base.camadas.geradoEm)}` : ''}. Região: ${esc(base?.regiao || '')}.</p>
    <p>Lavoura e potencial são estimativas: área do CAR calibrada pela lavoura de verão do IBGE no município e rendimentos do PAM 2021–2025 (ano bom = média dos 2 melhores anos). A análise socioambiental é uma triagem automática com dados públicos; não substitui a análise documental nem a consulta às listas oficiais no dia da negociação.</p>
    ${extra.map(t => `<p>${t}</p>`).join('')}
    <p>Gerado pelo VAL Geomap em ${dataHora(new Date())}.</p></footer>`
}
// lista longa de matrículas (imóvel com várias glebas): as 4 primeiras e quantas faltam
const matriculas = s => { const l = String(s || '').split(/\s*[;,]\s*/).filter(Boolean); return !l.length ? '—' : l.length <= 4 ? l.join('; ') : `${l.slice(0, 4).join('; ')} +${l.length - 4}` }
const rotuloImovel = i => i.nome || (i.car ? `CAR ${i.car}` : i.parcela ? `Parcela SIGEF ${i.parcela.slice(0, 8)}…` : i.id)
function blocoMotivos(motivos) {
  if (!motivos.length) return '<p class="nota">Nenhum apontamento nas camadas consultadas.</p>'
  return `<ul class="motivos">${motivos.map(m => `<li>${selo(m.nivel)}<div>${esc(m.texto)}<small>${m.imovel ? `${esc(m.imovel)} · ` : ''}fonte: ${esc(m.fonte)}</small></div></li>`).join('')}</ul>`
}
async function aguardarMapa(camadaFundo) {
  // espera os ladrilhos carregarem (para a impressão sair com o mapa), com limite de tempo
  await new Promise(ok => { let feito = false; const fim = () => { if (!feito) { feito = true; ok() } }; camadaFundo.once('load', fim); setTimeout(fim, 7000) })
}
function novoMapa() {
  // mapa de relatório: a roda do mouse rola a página, não dá zoom
  const mapa = L.map('mapa', { zoomControl: false, attributionControl: true, zoomSnap: 0.25, fadeAnimation: false, zoomAnimation: false, scrollWheelZoom: false })
  const fundo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics' }).addTo(mapa)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, opacity: 0.8 }).addTo(mapa)
  return { mapa, fundo }
}
const numero = (n, classe = '') => L.divIcon({ className: `rotulo-num ${classe}`, html: String(n), iconSize: [22, 22] })

// ---------------------------------------------------------------------------------------------
// Relatório do produtor
// ---------------------------------------------------------------------------------------------
async function relatorioProdutor(id, boot) {
  const d = await api(`/api/geo/relatorio/produtor?producerId=${encodeURIComponent(id)}`)
  const p = d.produtor, sc = (boot.scored || []).find(s => s.producerId === id), pot = d.potencial, sa = d.socioambiental
  const areas = d.vinculos.filter(v => v.imovel).map((v, i) => ({ ...v.imovel, n: i + 1 }))
  document.title = `${p.name} · Relatório do produtor · VAL Geomap`
  $('#relatorio').innerHTML = `
    ${cabecalho('Relatório do produtor', p.name, [p.municipality ? `${p.municipality}${p.uf ? '/' + p.uf : ''}` : '', p.consultant ? `Consultor: ${p.consultant}` : '', `Emitido em ${dataHora(d.geradoEm)}`])}
    <section class="kpis">
      ${kpi('Áreas vinculadas', fmt(d.imoveisContados), `${fmt(pot.areaHa)} ha no registro`)}
      ${kpi('Lavoura estimada', `${fmt(pot.lavouraHa)} ha`, 'calibrada pelo IBGE')}
      ${kpi('Potencial em ano bom', `${fmt(pot.anoBom)} t`, `média de 5 anos: ${fmt(pot.media)} t`)}
      ${kpi('Porte', d.porte ? d.porte.rotulo : '—', d.porte ? `${fmt(d.porte.modulos, 1)} módulos fiscais` : 'sem áreas vinculadas')}
      ${kpi('Socioambiental', selo(sa.nivel), sa.imoveisAnalisados ? `${sa.motivos.length} apontamento${sa.motivos.length === 1 ? '' : 's'} em ${sa.imoveisAnalisados} área${sa.imoveisAnalisados === 1 ? '' : 's'}` : 'sem áreas para analisar', true, sa.imoveisAnalisados ? `nivel-${sa.nivel}` : '')}
    </section>
    <section><p class="resumo">${resumoProdutor(p, d, sc)}</p></section>
    ${areas.length ? `<section><h2>Áreas no CAR e no SIGEF</h2><div class="mapa" id="mapa"></div><div class="tabela-rolavel">${tabelaAreas(areas)}</div></section>`
      : '<section><h2>Áreas</h2><p class="nota">Nenhuma área vinculada. Vincule as áreas no VAL Geomap (Completar produtores, ou busca por nome e matrícula) para o relatório trazer mapa, potencial e análise socioambiental.</p></section>'}
    <section class="duas">
      <div><h2>Potencial de grãos</h2>${tabelaPotencial(pot, d.municipio)}</div>
      <div><h2>Cadastro comercial</h2>${fichaComercial(p, sc, d.porte)}</div>
    </section>
    <section><h2>Análise socioambiental</h2>${sa.imoveisAnalisados ? `<p>Resultado: ${selo(sa.nivel)} nas ${sa.imoveisAnalisados} área${sa.imoveisAnalisados === 1 ? '' : 's'} vinculada${sa.imoveisAnalisados === 1 ? '' : 's'}. Camadas cruzadas: desmatamento e supressão de vegetação nativa (INPE PRODES, desde 2009), terras indígenas, unidades de conservação e embargos (IBAMA, ICMBio).</p>${blocoMotivos(sa.motivos)}` : '<p class="nota">Sem áreas vinculadas para analisar.</p>'}</section>
    <section><h2>Histórico comercial</h2>${historico(d.interacoes, d.intencoes)}</section>
    <section><h2>Documentos anexados</h2>${documentos(d.documentos)}</section>
    ${rodape(d.base)}`
  if (areas.length) await mapaProdutor(areas)
  pronto()
}
// resumo executivo em uma frase corrida, com os números que importam para a negociação
function resumoProdutor(p, d, sc) {
  const pot = d.potencial, sa = d.socioambiental
  if (!d.imoveisContados) return `<b>${esc(p.name)}</b> ainda não tem áreas vinculadas no VAL Geomap. ${sc ? `Prioridade comercial: ${esc(sc.priority?.label || '')} (score ${fmt(sc.score)}/100).` : ''} Vincule as áreas (Completar produtores ou busca por nome e matrícula) para calcular lavoura, potencial e análise socioambiental.`
  const principal = sa.motivos[0]
  return `<b>${esc(p.name)}</b> tem ${d.imoveisContados} área${d.imoveisContados === 1 ? '' : 's'} vinculada${d.imoveisContados === 1 ? '' : 's'} (${fmt(pot.areaHa)} ha no registro), com <b>${fmt(pot.lavouraHa)} ha de lavoura estimada</b> e potencial de <b>${fmt(pot.anoBom)} t em ano bom</b> (${fmt(pot.media)} t na média de 5 anos). `
    + (d.porte ? `Porte: ${esc(d.porte.rotulo.toLowerCase())}, ${fmt(d.porte.modulos, 1)} módulos fiscais. ` : '')
    + (sa.nivel === 'ok' ? 'Triagem socioambiental <b>sem alerta</b> nas camadas consultadas.' : `Triagem socioambiental <b>${NIVEL[sa.nivel].toLowerCase()}</b>${principal ? `: ${esc(principal.texto.charAt(0).toLowerCase() + principal.texto.slice(1))}` : ''}${sa.motivos.length > 1 ? ` (e mais ${sa.motivos.length - 1})` : ''}.`)
    + (sc ? ` Prioridade comercial: ${esc(sc.priority?.label || '')}, score ${fmt(sc.score)}/100.` : '')
}
function tabelaAreas(areas) {
  const s = areas.filter(i => !i.dentroDoCar || !areas.some(o => o.id === i.dentroDoCar)).reduce((t, i) => ({ a: t.a + (i.areaHa || 0), l: t.l + (i.lavouraHa || 0), p: t.p + (i.potencialT?.anoBom || 0) }), { a: 0, l: 0, p: 0 })
  return `<table class="t-areas"><thead><tr><th>#</th><th>Imóvel</th><th>Município</th><th class="n">Área (ha)</th><th class="n">Lavoura (ha)</th><th class="n">Potencial (t)</th><th>Matrícula · cartório</th><th>CAR</th><th class="n">MF</th><th>Socioamb.</th></tr></thead>
    <tbody>${areas.map(i => `<tr><td><span class="num">${i.n}</span></td>
      <td><b>${esc(rotuloImovel(i))}</b><small>${esc(i.fonte)}${i.dentroDoCar ? ' · parcela dentro de um CAR' : ''}${i.car && i.nome ? ` · ${esc(i.car)}` : ''}</small></td>
      <td>${esc(i.municipio)}</td><td class="n">${fmt(i.areaHa, 1)}</td><td class="n">${fmt(i.lavouraHa, 1)}</td><td class="n">${fmt(i.potencialT?.anoBom)}</td>
      <td>${esc(matriculas(i.matricula))}${i.cns ? `<small>CNS ${esc(String(i.cns).split(/[;,]/)[0])}</small>` : ''}</td>
      <td>${esc(i.situacao || '—')}</td><td class="n">${fmt(i.modulosFiscais, 1)}</td><td>${selo(i.socioambiental?.nivel)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td colspan="2" title="Parcela SIGEF dentro de um CAR também vinculado não soma duas vezes">Total</td><td class="n">${fmt(s.a)}</td><td class="n">${fmt(s.l)}</td><td class="n">${fmt(s.p)}</td><td colspan="4"></td></tr></tfoot></table>`
}
function tabelaPotencial(pot, mun) {
  const m = mun?.mercado
  const maior = Math.max(1, pot.soja || 0, pot.milho || 0, pot.trigo || 0)
  const linha = (c, nome) => `<tr><td>${nome}</td><td class="n">${fmt(pot[c])}</td><td style="width:28%"><span class="barra-cult" style="width:${((pot[c] || 0) / maior * 100).toFixed(1)}%"></span></td><td class="n">${m ? `${fmt(m[c]?.bom, 2)} / ${fmt(m[c]?.med, 2)} / ${fmt(m[c]?.seca, 2)}` : '—'}</td></tr>`
  return `<table><thead><tr><th>Cultura</th><th class="n">Ano bom (t)</th><th></th><th class="n">Rend. bom / médio / pior (t/ha)</th></tr></thead>
    <tbody>${linha('soja', 'Soja (verão)')}${linha('milho', 'Milho (verão)')}${linha('trigo', 'Trigo (inverno)')}</tbody>
    <tfoot><tr><td>Total</td><td class="n">${fmt(pot.anoBom)}</td><td></td><td class="n">média 5 anos: ${fmt(pot.media)} t</td></tr></tfoot></table>
    <p class="nota">Mix de culturas e rendimentos de ${esc(mun?.nome || 'município')} no IBGE (PAM 2021–2025)${mun?.moduloFiscalHa ? `; módulo fiscal de ${fmt(mun.moduloFiscalHa)} ha` : ''}.</p>`
}
function fichaComercial(p, sc, porte) {
  const linhas = [
    ['Relacionamento', rot.relationships?.[p.relationship] || p.relationship],
    ['Prioridade', sc ? `${sc.priority?.label || ''} · score ${fmt(sc.score)}/100` : ''],
    ['Próxima ação', sc?.nextAction],
    ['Culturas', (p.cultures || []).map(c => rot.commodities?.[c] || c).join(', ')],
    ['Safra', p.season],
    ['Área cadastrada', p.areaHa != null ? `${fmt(p.areaHa)} ha` : ''],
    ['Volume estimado', p.estimatedVolumeT != null ? `${fmt(p.estimatedVolumeT)} ${p.volumeUnit === 'sc' ? 'sc' : 't'}` : ''],
    ['Produtividade', p.productivityScHa != null ? `${fmt(p.productivityScHa)} sc/ha` : ''],
    ['Armazenagem', p.storageCapacityT != null ? `${fmt(p.storageCapacityT)} t` : ''],
    ['Frete', p.freight],
    ['Porte e crédito', porte ? `${porte.rotulo} · ${porte.credito}` : ''],
    ['Telefone', p.phone],
    ['Último contato', p.lastContactAt ? dataBr(p.lastContactAt) : ''],
    ['Observações', p.notes ? String(p.notes).slice(0, 400) : '']
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')
  return `<dl class="ficha">${linhas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
}
function historico(inter, intents) {
  const ti = inter.length ? `<h3>Interações (${inter.length})</h3><table><thead><tr><th>Data</th><th>Tipo</th><th>Resultado</th><th>Anotação</th></tr></thead><tbody>${inter.slice(0, 15).map(x => `<tr><td>${dataBr(x.occurredAt)}</td><td>${esc(rot.interactionKinds?.[x.kind] || x.kind)}</td><td>${esc(RESULTADO[x.outcome] || '')}</td><td>${esc(String(x.notes || '').slice(0, 220))}</td></tr>`).join('')}</tbody></table>` : '<p class="nota">Nenhuma interação registrada.</p>'
  const tn = intents.length ? `<h3>Intenções comerciais (${intents.length})</h3><table><thead><tr><th>Cultura</th><th>Direção</th><th class="n">Volume (t)</th><th class="n">Preço-alvo</th><th>Situação</th><th>Registro</th></tr></thead><tbody>${intents.slice(0, 15).map(x => `<tr><td>${esc(rot.commodities?.[x.commodity] || x.commodity)}</td><td>${x.direction === 'buy' ? 'Compra' : 'Venda'}</td><td class="n">${fmt(x.volumeT)}</td><td class="n">${x.targetPrice ? `${fmt(x.targetPrice, 2)} ${esc(rot.priceUnits?.[x.priceUnit] || x.priceUnit || '')}` : '—'}</td><td>${esc(rot.intentStatuses?.[x.status] || x.status)}</td><td>${dataBr(x.observedAt || x.createdAt)}</td></tr>`).join('')}</tbody></table>` : '<p class="nota">Nenhuma intenção comercial registrada.</p>'
  return ti + tn
}
function documentos(docs) {
  if (!docs.length) return '<p class="nota">Nenhum documento anexado. Anexe matrícula, KML ou laudos no cadastro do produtor, na seção Documentos.</p>'
  return `<table><thead><tr><th>Arquivo</th><th>Tipo</th><th>Descrição</th><th>Anexado em</th><th class="n">Tamanho</th></tr></thead><tbody>${docs.map(x => `<tr><td><a href="/api/geo/documentos/${encodeURIComponent(x.id)}">${esc(x.nome)}</a></td><td>${esc(CATEG[x.categoria] || x.categoria)}</td><td>${esc(x.descricao || '')}</td><td>${dataBr(x.createdAt)}</td><td class="n">${x.size < 1024 ? `${x.size} B` : x.size < 1048576 ? `${fmt(x.size / 1024)} KB` : `${fmt(x.size / 1048576, 1)} MB`}</td></tr>`).join('')}</tbody></table>`
}
async function mapaProdutor(areas) {
  const { mapa, fundo } = novoMapa()
  const grupo = L.featureGroup().addTo(mapa)
  for (const a of areas) {
    try {
      const fc = await api(`/api/geo/imoveis/${encodeURIComponent(a.id)}`)
      const f = fc.features.find(x => x.id === a.id) || fc.features[0]
      const cor = COR_NIVEL[a.socioambiental?.nivel || 'ok']
      L.geoJSON(f, { style: { color: cor, weight: 2.5, fillColor: cor, fillOpacity: 0.22, dashArray: a.dentroDoCar ? '4 3' : null } }).addTo(grupo)
    } catch { /* imóvel fora da base atual */ }
    L.marker([a.ponto[1], a.ponto[0]], { icon: numero(a.n) }).addTo(grupo)
  }
  if (grupo.getLayers().length) mapa.fitBounds(grupo.getBounds(), { padding: [24, 24], maxZoom: 15 })
  await aguardarMapa(fundo)
}

// ---------------------------------------------------------------------------------------------
// Relatório do município
// ---------------------------------------------------------------------------------------------
async function relatorioMunicipio(nome) {
  const d = await api(`/api/geo/relatorio/municipio?municipio=${encodeURIComponent(nome)}`)
  const m = d.municipio, i = d.imoveis, c = d.cobertura, sa = d.socioambiental
  document.title = `${m.nome} · Relatório do município · VAL Geomap`
  const oport = d.oportunidades.map((x, k) => ({ ...x, n: k + 1 }))
  $('#relatorio').innerHTML = `
    ${cabecalho('Relatório do município', `${m.nome}/RS`, [`Código IBGE ${m.codigoIbge}`, m.moduloFiscalHa ? `Módulo fiscal: ${fmt(m.moduloFiscalHa)} ha` : '', `Emitido em ${dataHora(d.geradoEm)}`])}
    <section class="kpis">
      ${kpi('Imóveis no CAR', fmt(i.car), `${fmt(i.areaCarHa)} ha declarados`)}
      ${kpi('Parcelas SIGEF', fmt(i.sigef), `${fmt(i.carComNome)} CAR com nome do SIGEF`)}
      ${kpi('Lavoura de verão', `${fmt(i.lavouraHa)} ha`, 'IBGE PAM 2025')}
      ${kpi('Potencial de grãos', `${fmt(i.potencialAnoBomT)} t`, `ano bom · média: ${fmt(i.potencialMediaT)} t`)}
      ${kpi('Cobertura VAL', `${fmt(c.percentual, 1)}%`, `${fmt(c.imoveisVinculados)} imóveis · ${fmt(c.potencialAnoBomT)} t`)}
    </section>
    <section><p class="resumo">${resumoMunicipio(d, oport)}</p></section>
    <section><h2>Mercado: IBGE e Banco Central</h2>${tabelaMercado(m.mercado)}</section>
    <section><h2>Porte dos imóveis (Lei 8.629/93)</h2>${tabelaPortes(d.portes)}</section>
    <section><h2>Mapa</h2><div class="mapa" id="mapa"></div><p class="nota">Números em laranja: os maiores imóveis sem produtor do VAL (tabela a seguir). Contorno: limite municipal do IBGE.</p></section>
    <section><h2>Maiores oportunidades: imóveis sem produtor do VAL</h2><div class="tabela-rolavel">${tabelaOportunidades(oport)}</div></section>
    <section><h2>Carteira do VAL no município</h2><div class="tabela-rolavel">${tabelaCarteira(d.carteira)}</div></section>
    <section><h2>Análise socioambiental</h2><p>${selo('critico')} ${fmt(sa.critico)} imóveis &nbsp; ${selo('atencao')} ${fmt(sa.atencao)} imóveis, de ${fmt(i.car)} no CAR. Os maiores com apontamento:</p><div class="tabela-rolavel">${tabelaAlertas(sa.imoveis)}</div></section>
    ${rodape(d.base)}`
  await mapaMunicipio(d, oport)
  pronto()
}
function resumoMunicipio(d, oport) {
  const m = d.municipio, i = d.imoveis, c = d.cobertura, sa = d.socioambiental
  const lavOp = oport.reduce((s, x) => s + (x.lavouraHa || 0), 0), potOp = oport.reduce((s, x) => s + (x.potencialT?.anoBom || 0), 0)
  return `<b>${esc(m.nome)}</b> tem ${fmt(i.car)} imóveis no CAR (${fmt(i.areaCarHa)} ha declarados) e <b>${fmt(i.lavouraHa)} ha de lavoura de verão</b> no IBGE, com potencial de <b>${fmt(i.potencialAnoBomT)} t em ano bom</b>. `
    + `O VAL cobre <b>${fmt(c.percentual, 1)}%</b> desse potencial com ${fmt(c.imoveisVinculados)} imóve${c.imoveisVinculados === 1 ? 'l vinculado' : 'is vinculados'}. `
    + (oport.length ? `Os ${oport.length} maiores imóveis sem produtor do VAL somam ${fmt(lavOp)} ha de lavoura e ${fmt(potOp)} t em ano bom. ` : '')
    + `A triagem socioambiental aponta ${fmt(sa.critico)} imóve${sa.critico === 1 ? 'l crítico' : 'is críticos'} e ${fmt(sa.atencao)} com atenção.`
}
function tabelaMercado(m) {
  if (!m) return '<p class="nota">Sem dados de mercado.</p>'
  const ha = x => (x?.ha == null ? '—' : fmt(x.ha)), rs = x => (x?.rsha ? `R$ ${fmt(x.rsha)}` : '—')
  const linha = (c, nome) => `<tr><td>${nome}</td><td class="n">${fmt(m[c]?.area)}</td><td class="n">${fmt(m[c]?.bom, 2)} / ${fmt(m[c]?.med, 2)} / ${fmt(m[c]?.seca, 2)}</td>
    <td class="n">${ha(m[c]?.custeio2425)}</td><td class="n">${rs(m[c]?.custeio2425)}</td><td class="n">${ha(m[c]?.custeio2526)}</td><td class="n">${rs(m[c]?.custeio2526)}</td></tr>`
  return `<table><thead><tr><th>Cultura</th><th class="n">Área 2025 (ha)</th><th class="n">Rend. bom / médio / pior (t/ha)</th><th class="n">Custeio 24/25 (ha)</th><th class="n">R$/ha</th><th class="n">Custeio 25/26 (ha)</th><th class="n">R$/ha</th></tr></thead>
    <tbody>${linha('soja', 'Soja')}${linha('milho', 'Milho')}${linha('trigo', 'Trigo')}</tbody></table>
    <p class="nota">Produção possível: ${fmt(m.potBom)} t em ano bom e ${fmt(m.potMed)} t na média (IBGE PAM 2021–2025). Custeio: crédito rural contratado (Banco Central, SICOR).</p>`
}
function tabelaPortes(portes) {
  const total = Object.values(portes).reduce((s, v) => s + v.areaHa, 0) || 1
  const linhas = PORTES.filter(([k]) => portes[k]).map(([k, nome]) => { const v = portes[k]; const pct = v.areaHa / total * 100; return `<tr><td>${nome}</td><td class="n">${fmt(v.imoveis)}</td><td class="n">${fmt(v.areaHa)}</td><td class="n">${fmt(pct, 0)}%</td><td style="width:30%"><div class="barra" style="width:${pct.toFixed(1)}%"></div></td></tr>` }).join('')
  return `<table><thead><tr><th>Porte</th><th class="n">Imóveis</th><th class="n">Área (ha)</th><th class="n">% área</th><th></th></tr></thead><tbody>${linhas}</tbody></table>
    <p class="nota">MF = módulos fiscais do CAR. Pequeno: perfil Pronaf; médio: perfil Pronamp (ambos dependem também da renda bruta).</p>`
}
function tabelaOportunidades(lista) {
  if (!lista.length) return '<p class="nota">Todos os imóveis do CAR já têm produtor do VAL vinculado.</p>'
  return `<table><thead><tr><th>#</th><th>Imóvel</th><th class="n">Área (ha)</th><th class="n">Lavoura (ha)</th><th class="n">Potencial (t)</th><th>Matrícula</th><th>Porte</th><th>Socioamb.</th></tr></thead>
    <tbody>${lista.map(x => `<tr><td><span class="num" style="background:#e5a528;color:#2b1d00">${x.n}</span></td><td><b>${esc(x.nome || 'Sem nome no registro')}</b><small>${esc(x.car)}</small></td><td class="n">${fmt(x.areaHa)}</td><td class="n">${fmt(x.lavouraHa)}</td><td class="n">${fmt(x.potencialT?.anoBom)}</td><td>${esc(matriculas(x.matricula))}</td><td>${esc(x.porte?.rotulo || '—')}</td><td>${selo(x.socioambiental?.nivel)}</td></tr>`).join('')}</tbody></table>`
}
function tabelaCarteira(lista) {
  if (!lista.length) return '<p class="nota">Nenhum produtor do VAL cadastrado no município.</p>'
  return `<table><thead><tr><th>Produtor</th><th>Relacionamento</th><th>Consultor</th><th class="n">Área (ha)</th><th class="n">Volume</th><th>Áreas no CAR/SIGEF</th></tr></thead>
    <tbody>${lista.map(x => `<tr><td><b>${esc(x.nome)}</b>${x.municipio ? `<small>${esc(x.municipio)}</small>` : ''}</td><td>${esc(rot.relationships?.[x.relacionamento] || x.relacionamento || '—')}</td><td>${esc(x.consultor || '—')}</td><td class="n">${fmt(x.areaHa)}</td><td class="n">${x.volume != null ? `${fmt(x.volume)} ${x.unidade === 'sc' ? 'sc' : 't'}` : '—'}</td><td>${x.comArea ? 'vinculadas' : 'sem vínculo'}</td></tr>`).join('')}</tbody></table>`
}
function tabelaAlertas(lista) {
  if (!lista.length) return '<p class="nota">Nenhum imóvel com apontamento.</p>'
  return `<table><thead><tr><th>Imóvel</th><th class="n">Área (ha)</th><th>Nível</th><th>Principal apontamento</th></tr></thead>
    <tbody>${lista.map(x => `<tr><td><b>${esc(x.nome || 'Sem nome no registro')}</b><small>${esc(x.car || x.parcela)}</small></td><td class="n">${fmt(x.areaHa)}</td><td>${selo(x.socioambiental?.nivel)}</td><td>${esc(x.socioambiental?.motivos?.[0]?.texto || '')}${x.socioambiental?.motivos?.length > 1 ? `<small>e mais ${x.socioambiental.motivos.length - 1}</small>` : ''}</td></tr>`).join('')}</tbody></table>`
}
async function mapaMunicipio(d, oport) {
  const { mapa, fundo } = novoMapa()
  const grupo = L.featureGroup().addTo(mapa)
  try {
    const malha = await api('/api/malhas/RS')
    const f = malha.features.find(x => String(x.properties.code) === String(d.municipio.codigoIbge))
    if (f) L.geoJSON(f, { style: { color: '#c8f25e', weight: 2.5, fill: false } }).addTo(grupo)
  } catch { /* sem malha: fica só com os pontos */ }
  for (const x of d.socioambiental.imoveis.filter(x => x.socioambiental?.nivel === 'critico')) L.circleMarker([x.ponto[1], x.ponto[0]], { radius: 4, color: '#fff', weight: 1, fillColor: COR_NIVEL.critico, fillOpacity: 1 }).addTo(grupo)
  for (const x of oport) L.marker([x.ponto[1], x.ponto[0]], { icon: numero(x.n, 'oport') }).addTo(grupo)
  if (grupo.getLayers().length) mapa.fitBounds(grupo.getBounds(), { padding: [16, 16] })
  await aguardarMapa(fundo)
}

iniciar()
