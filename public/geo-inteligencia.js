// VAL Mapa — inteligência geo (CAR + SIGEF). Módulo opcional carregado depois do app.js.
// Acrescenta, sem mudar a tela existente:
//  · painel "Imóveis rurais" no mapa: busca por nome do produtor (mesmo sem cadastro) ou por matrícula,
//    pins nas áreas encontradas, seleção e vínculo a um produtor (existente ou novo);
//  · camada com os imóveis do CAR/SIGEF da janela do mapa (a partir do zoom 11);
//  · seção "Áreas no CAR/SIGEF" no detalhe do produtor, com o potencial calculado pelas áreas vinculadas.
const V = window.valMapa
const G = { ativo: false, layer: null, res: null, pins: null, itens: [], sel: new Set(), aba: 'nome', ultimaBusca: '', status: null, timer: null }
const SC_T = 0.06
const esc = s => (V ? V.esc(s) : String(s ?? ''))
const fmt = (v, d = 0) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }))
const COR = { vinculado: '#2d8cff', livre: '#e5a528', parcela: '#ffffff', selecionado: '#00c896', alta: '#009f78', media: '#e5a528', baixa: '#9aa8a3' }
// relação entre o nome buscado e o nome no registro do imóvel: [rótulo, classe do badge, explicação]
const REL = { nome: ['nome completo', 'high', 'Todas as palavras do nome aparecem no registro, na ordem'], parcial: ['parcial', 'watch', 'Parte do nome aparece no registro'], sobrenome: ['mesmo sobrenome', 'incomplete', 'O registro tem o sobrenome, mas não o primeiro nome buscado'] }
const rotulo = i => i.nome || (i.matricula ? `Matrícula ${i.matricula}` : i.car ? `CAR …${i.car.slice(-8)}` : 'Imóvel sem nome')
const produtorNome = id => V.state.data?.producers.find(p => p.id === id)?.name || 'produtor'

if (V) iniciar()

function iniciar() {
  injetarPainel()
  // Espera o app carregar os dados (isto é, depois do login, quando o ambiente tem senha) antes de chamar /api/geo.
  const t = setInterval(() => { if (V.state.map && V.state.data) { clearInterval(t); montarCamadas(); carregarStatus() } }, 300)
  observarDetalhe()
}

// ---------------------------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------------------------
function injetarPainel() {
  const painel = document.querySelector('#view-map .map-panel')
  if (!painel || document.getElementById('geo-block')) return
  const bloco = document.createElement('div')
  bloco.className = 'panel-block geo-block'; bloco.id = 'geo-block'
  bloco.innerHTML = `
    <div class="row between"><strong>Imóveis rurais · CAR e SIGEF</strong><label class="toggle"><input id="geo-camada" type="checkbox"><span>Mostrar</span></label></div>
    <p class="hint" id="geo-status">Carregando a base de imóveis…</p>
    <div class="geo-abas" role="tablist">
      <button type="button" role="tab" data-geo-aba="nome" aria-selected="true">Nome do produtor</button>
      <button type="button" role="tab" data-geo-aba="matricula" aria-selected="false">Matrícula</button>
    </div>
    <div class="grid-2">
      <label class="field"><span>Município</span><select id="geo-mun"><option value="">Toda a região</option></select></label>
      <label class="field"><span id="geo-q-rotulo">Nome</span><input id="geo-q" type="search" placeholder="Ex.: Costa Beber" autocomplete="off"></label>
    </div>
    <div class="row between"><button id="geo-buscar" class="btn small primary" type="button">Buscar áreas</button><button id="geo-limpar" class="btn ghost small" type="button" hidden>Limpar pins</button></div>
    <p class="hint" id="geo-dica">Acha as áreas pelo nome que aparece no registro do imóvel (SIGEF), mesmo de quem ainda não está cadastrado no VAL.</p>
    <div id="geo-res"></div>`
  const primeiro = painel.querySelector('.panel-block')
  primeiro ? primeiro.after(bloco) : painel.prepend(bloco)

  bloco.querySelector('#geo-camada').onchange = e => { G.ativo = e.target.checked; carregarJanela() }
  bloco.querySelectorAll('[data-geo-aba]').forEach(b => b.onclick = () => trocarAba(b.dataset.geoAba))
  bloco.querySelector('#geo-buscar').onclick = buscar
  bloco.querySelector('#geo-q').onkeydown = e => { if (e.key === 'Enter') buscar() }
  bloco.querySelector('#geo-limpar').onclick = limparResultado
  bloco.querySelector('#geo-res').onclick = cliqueResultado
  bloco.querySelector('#geo-res').onchange = mudancaResultado
}
function carregarStatus() {
  const bloco = document.getElementById('geo-block'); if (!bloco) return
  V.api('/api/geo/status').then(s => {
    G.status = s
    const sel = bloco.querySelector('#geo-mun')
    sel.innerHTML = '<option value="">Toda a região</option>' + Object.values(s.municipios).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(n => `<option>${esc(n)}</option>`).join('')
    bloco.querySelector('#geo-status').textContent = `${fmt(s.contagem.car)} imóveis do CAR e ${fmt(s.contagem.sigef)} parcelas SIGEF · ${s.regiao}.`
  }).catch(e => { bloco.querySelector('#geo-status').textContent = `Base de imóveis indisponível: ${e.message}` })
}
function trocarAba(aba) {
  G.aba = aba
  document.querySelectorAll('[data-geo-aba]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.geoAba === aba)))
  const q = document.getElementById('geo-q')
  document.getElementById('geo-q-rotulo').textContent = aba === 'nome' ? 'Nome' : 'Matrícula'
  q.placeholder = aba === 'nome' ? 'Ex.: Costa Beber' : 'Ex.: 12.345'
  q.inputMode = aba === 'nome' ? 'text' : 'numeric'
  document.getElementById('geo-dica').textContent = aba === 'nome'
    ? 'Acha as áreas pelo nome que aparece no registro do imóvel (SIGEF), mesmo de quem ainda não está cadastrado no VAL.'
    : 'Procura a matrícula nas parcelas do SIGEF e nos imóveis do CAR ligados a elas. Escolha o município: o número se repete entre cartórios.'
}

// ---------------------------------------------------------------------------------------------
// Camadas no mapa
// ---------------------------------------------------------------------------------------------
function montarCamadas() {
  const map = V.state.map
  if (!map.getPane('geoImoveis')) { map.createPane('geoImoveis'); map.getPane('geoImoveis').style.zIndex = 390 }
  G.layer = L.geoJSON(null, { pane: 'geoImoveis', style: estilo, onEachFeature: aoCriarFeicao })
  G.res = L.geoJSON(null, { pane: 'geoImoveis', style: f => ({ ...estilo(f), weight: 2.5, fillOpacity: .28 }), onEachFeature: aoCriarFeicao }).addTo(map)
  G.pins = L.layerGroup().addTo(map)
  map.on('moveend', () => { clearTimeout(G.timer); G.timer = setTimeout(carregarJanela, 250) })
}
function estilo(f) {
  const p = f.properties
  if (G.sel.has(p.id)) return { color: COR.selecionado, weight: 3, fillColor: COR.selecionado, fillOpacity: .3 }
  if (p.dentroDoCar) return { color: COR.parcela, weight: 1, dashArray: '3 3', fillOpacity: 0, opacity: .8 }
  if (p.produtores?.length) return { color: COR.vinculado, weight: 1.6, fillColor: COR.vinculado, fillOpacity: .3 }
  return { color: COR.livre, weight: 1.2, fillColor: COR.livre, fillOpacity: .1 }
}
function aoCriarFeicao(f, layer) {
  const p = f.properties
  layer.bindTooltip(`<b>${esc(rotulo(p))}</b><br>${esc(p.fonte)}${p.dentroDoCar ? ' (dentro de um CAR)' : ''} · ${esc(p.municipio)} · ${fmt(p.areaHa, 1)} ha${p.potencialT.anoBom ? ` · ~${fmt(p.potencialT.anoBom)} t/ano` : ''}${p.matricula ? `<br>mat. ${esc(p.matricula)}` : ''}${p.produtores?.length ? `<br>Vinculado a ${esc(p.produtores.map(produtorNome).join(', '))}` : ''}`, { sticky: true })
  layer.on('click', () => {
    if (!G.itens.some(i => i.id === p.id)) G.itens.push(p)
    G.sel.has(p.id) ? G.sel.delete(p.id) : G.sel.add(p.id)
    restilizar(); desenharResultado()
  })
}
const restilizar = () => { G.layer?.setStyle(estilo); G.res?.setStyle(f => ({ ...estilo(f), weight: 2.5, fillOpacity: .28 })) }
async function carregarJanela() {
  const map = V.state.map; if (!map || !G.layer) return
  const st = document.getElementById('geo-status')
  if (!G.ativo) { if (map.hasLayer(G.layer)) map.removeLayer(G.layer); return }
  if (!map.hasLayer(G.layer)) G.layer.addTo(map)
  if (map.getZoom() < 11) { G.layer.clearLayers(); st.textContent = 'Aproxime o mapa (nível 11 ou mais) para ver os imóveis.'; return }
  const b = map.getBounds(), bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => v.toFixed(4)).join(',')
  if (bbox === G.ultimaJanela) return
  G.ultimaJanela = bbox
  try {
    const fc = await V.api(`/api/geo/imoveis?bbox=${bbox}`)
    G.layer.clearLayers(); G.layer.addData(fc)
    st.textContent = `${fmt(fc.features.length)} imóveis nesta área${fc.total > fc.features.length ? ` (de ${fmt(fc.total)})` : ''}. Laranja: sem produtor · azul: vinculado · tracejado: parcela SIGEF dentro de um CAR. Clique para selecionar.`
  } catch (e) { st.textContent = e.message }
}

// ---------------------------------------------------------------------------------------------
// Busca e resultado
// ---------------------------------------------------------------------------------------------
async function buscar() {
  const q = document.getElementById('geo-q').value.trim(), mun = document.getElementById('geo-mun').value
  if (!q) return V.toast(G.aba === 'nome' ? 'Digite o nome do produtor.' : 'Digite a matrícula.', true)
  const btn = document.getElementById('geo-buscar'); btn.disabled = true; btn.textContent = 'Buscando…'
  try {
    const url = G.aba === 'nome' ? `/api/geo/nome?q=${encodeURIComponent(q)}&municipio=${encodeURIComponent(mun)}&geometria=1` : `/api/geo/matricula?numero=${encodeURIComponent(q)}&municipio=${encodeURIComponent(mun)}&geometria=1`
    const r = await V.api(url)
    G.ultimaBusca = q; G.ultimoTipo = G.aba; G.itens = r.itens; G.soma = r.soma; G.sel = new Set()
    G.res.clearLayers(); if (r.geojson) G.res.addData(r.geojson)
    marcarPins(r.itens)
    desenharResultado()
    if (r.itens.length) V.state.map.fitBounds(limites(r.itens), { padding: [40, 40], maxZoom: 14 })
  } catch (e) { V.toast(e.message, true) } finally { btn.disabled = false; btn.textContent = 'Buscar áreas' }
}
const limites = itens => itens.reduce((b, i) => [[Math.min(b[0][0], i.bbox[1]), Math.min(b[0][1], i.bbox[0])], [Math.max(b[1][0], i.bbox[3]), Math.max(b[1][1], i.bbox[2])]], [[90, 180], [-90, -180]])
function marcarPins(itens) {
  G.pins.clearLayers()
  for (const i of itens) {
    const cor = i.relacao ? { nome: COR.alta, parcial: COR.media, sobrenome: COR.baixa }[i.relacao] : COR.vinculado
    L.marker([i.ponto[1], i.ponto[0]], { icon: L.divIcon({ className: 'geo-pin-wrap', html: `<span class="geo-pin" style="--c:${cor}"></span>`, iconSize: [22, 30], iconAnchor: [11, 30] }) })
      .bindTooltip(`<b>${esc(rotulo(i))}</b><br>${esc(i.municipio)} · ${fmt(i.areaHa, 1)} ha`, { direction: 'top', offset: [0, -26] })
      .on('click', () => { G.sel.has(i.id) ? G.sel.delete(i.id) : G.sel.add(i.id); restilizar(); desenharResultado() })
      .addTo(G.pins)
  }
  document.getElementById('geo-limpar').hidden = !itens.length
}
function limparResultado() { G.itens = []; G.sel = new Set(); G.res.clearLayers(); G.pins.clearLayers(); document.getElementById('geo-res').innerHTML = ''; document.getElementById('geo-limpar').hidden = true; restilizar() }
// área e potencial sem contar duas vezes: parcela SIGEF dentro de um CAR que também está na lista não soma
function somaSelecao(itens) {
  const ids = new Set(itens.map(i => i.id))
  // (parcela sozinha conta a parte dela na lavoura do CAR, como no servidor)
  return itens.filter(i => !(i.dentroDoCar && ids.has(i.dentroDoCar))).reduce((s, i) => {
    const p = i.potencialT
    return { areaHa: s.areaHa + (i.areaHa || 0), lavouraHa: s.lavouraHa + (i.lavouraHa || 0), anoBom: s.anoBom + (p?.anoBom || 0), media: s.media + (p?.media || 0), soja: s.soja + (p?.soja || 0), milho: s.milho + (p?.milho || 0), trigo: s.trigo + (p?.trigo || 0) }
  }, { areaHa: 0, lavouraHa: 0, anoBom: 0, media: 0, soja: 0, milho: 0, trigo: 0 })
}
function desenharResultado() {
  const box = document.getElementById('geo-res')
  if (!G.itens.length) { box.innerHTML = G.ultimaBusca ? `<p class="hint">Nada encontrado para “${esc(G.ultimaBusca)}”. ${G.ultimoTipo === 'nome' ? 'Nem todo imóvel tem o nome do dono no registro: tente só o sobrenome, outra grafia, ou busque pela matrícula.' : 'Ela pode estar só no CAR, sem georreferenciamento no SIGEF: busque a matrícula no GeoMart, baixe o KML e use a ferramenta de recorte.'}</p>` : ''; return }
  const soma = somaSelecao(G.itens)
  const sel = G.itens.filter(i => G.sel.has(i.id)), somaSel = somaSelecao(sel)
  const produtores = (V.state.data?.producers || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  box.innerHTML = `
    <p class="geo-soma"><b>${fmt(G.itens.length)} área${G.itens.length === 1 ? '' : 's'}</b> · ${fmt(soma.areaHa)} ha · lavoura estimada ${fmt(soma.lavouraHa)} ha · ~${fmt(soma.anoBom)} t/ano em ano bom</p>
    <label class="toggle"><input type="checkbox" data-geo-todos ${sel.length === G.itens.length ? 'checked' : ''}><span>Selecionar todas</span></label>
    <ul class="geo-lista">${G.itens.map(i => `<li class="${G.sel.has(i.id) ? 'on' : ''}">
      <input type="checkbox" data-geo-sel="${esc(i.id)}" ${G.sel.has(i.id) ? 'checked' : ''} aria-label="Selecionar ${esc(rotulo(i))}">
      <div class="geo-item"><b>${esc(rotulo(i))}</b>
        <span>${esc(i.fonte)}${i.dentroDoCar ? ' · dentro de um CAR' : ''} · ${esc(i.municipio)} · ${fmt(i.areaHa, 1)} ha${i.potencialT.anoBom ? ` · ~${fmt(i.potencialT.anoBom)} t/ano` : ''}</span>
        ${i.matricula ? `<span>mat. ${esc(i.matricula)}${i.cns ? ` · cartório ${esc(i.cns)}` : ''}</span>` : ''}
        ${i.produtores?.length ? `<span class="geo-vinc">Vinculado a ${esc(i.produtores.map(produtorNome).join(', '))}</span>` : ''}</div>
      <div class="geo-item-acoes">${i.relacao ? `<span class="badge ${REL[i.relacao][1]}" title="${esc(REL[i.relacao][2])}">${esc(REL[i.relacao][0])}</span>` : ''}<button class="btn ghost small" type="button" data-geo-ver="${esc(i.id)}">Ver</button></div></li>`).join('')}</ul>
    ${G.itens.some(i => i.relacao === 'sobrenome') ? '<p class="hint">“Mesmo sobrenome”: o registro não traz o primeiro nome buscado. Pode ser parente ou área da família; confira antes de vincular.</p>' : ''}
    ${sel.length ? `<div class="geo-acoes">
      <p class="geo-soma"><b>${sel.length} selecionada${sel.length === 1 ? '' : 's'}</b> · lavoura ${fmt(somaSel.lavouraHa)} ha · ~${fmt(somaSel.anoBom)} t/ano (soja ${fmt(somaSel.soja)} · milho ${fmt(somaSel.milho)} · trigo ${fmt(somaSel.trigo)})</p>
      <label class="field"><span>Vincular a produtor do VAL</span><select id="geo-produtor"><option value="">Escolha…</option>${produtores.map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.municipality)}</option>`).join('')}</select></label>
      <div class="row between"><button class="btn small primary" type="button" data-geo-vincular>Vincular</button><button class="btn small" type="button" data-geo-novo>Cadastrar novo produtor</button></div>
      <div id="geo-novo-form" hidden></div>
    </div>` : '<p class="hint">Marque as áreas que são do produtor para vincular ou cadastrar.</p>'}`
}
function mudancaResultado(e) {
  const c = e.target.closest('[data-geo-sel]'), todos = e.target.closest('[data-geo-todos]')
  if (c) { c.checked ? G.sel.add(c.dataset.geoSel) : G.sel.delete(c.dataset.geoSel) }
  if (todos) G.sel = todos.checked ? new Set(G.itens.map(i => i.id)) : new Set()
  if (c || todos) { restilizar(); desenharResultado() }
}
async function cliqueResultado(e) {
  const ver = e.target.closest('[data-geo-ver]')
  if (ver) { const i = G.itens.find(x => x.id === ver.dataset.geoVer); if (i) V.state.map.fitBounds([[i.bbox[1], i.bbox[0]], [i.bbox[3], i.bbox[2]]], { padding: [60, 60], maxZoom: 16 }); return }
  if (e.target.closest('[data-geo-vincular]')) {
    const producerId = document.getElementById('geo-produtor').value
    if (!producerId) return V.toast('Escolha o produtor.', true)
    return vincular(producerId, [...G.sel])
  }
  if (e.target.closest('[data-geo-novo]')) return abrirNovoProdutor()
  if (e.target.closest('[data-geo-criar]')) return criarProdutor()
}
async function vincular(producerId, ids) {
  try {
    const r = await V.api('/api/geo/vinculos', { method: 'POST', body: { producerId, imovelIds: ids, origem: G.ultimoTipo === 'nome' ? 'busca-nome' : 'busca-matricula', busca: G.ultimaBusca } })
    V.toast(`${r.criados} área(s) vinculada(s) a ${produtorNome(producerId)} · potencial ~${fmt(r.potencial.anoBom)} t/ano em ano bom.`)
    G.ultimaJanela = ''; await carregarJanela()
    for (const i of G.itens) if (ids.includes(i.id)) i.produtores = [...new Set([...(i.produtores || []), producerId])]
    G.sel = new Set(); restilizar(); desenharResultado()
    if (V.state.selected === producerId) secaoDetalhe(producerId)
  } catch (e) { V.toast(e.message, true) }
}
const titulo = s => String(s).toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\s(De|Da|Do|Dos|Das|E)\s/g, m => m.toLowerCase())
function abrirNovoProdutor() {
  const sel = G.itens.filter(i => G.sel.has(i.id))
  const muns = sel.reduce((m, i) => m.set(i.municipio, (m.get(i.municipio) || 0) + (i.lavouraHa || i.areaHa || 0)), new Map())
  const mun = [...muns.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  const rel = V.labels.relationships || {}
  const box = document.getElementById('geo-novo-form'); box.hidden = false
  box.innerHTML = `
    <label class="field"><span>Nome do produtor</span><input id="geo-novo-nome" value="${esc(G.ultimoTipo === 'nome' ? titulo(G.ultimaBusca) : '')}"></label>
    <div class="grid-2"><label class="field"><span>Município</span><input id="geo-novo-mun" value="${esc(mun)}"></label>
    <label class="field"><span>Relacionamento</span><select id="geo-novo-rel">${Object.entries(rel).map(([v, l]) => `<option value="${esc(v)}" ${v === 'prospect' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
    <p class="hint">O cadastro nasce com o ponto na maior área, a lavoura estimada e o potencial em ano bom das áreas selecionadas. Dá para ajustar depois em Editar.</p>
    <button class="btn small primary" type="button" data-geo-criar>Cadastrar e vincular</button>`
  document.getElementById('geo-novo-nome').focus()
}
async function criarProdutor() {
  const sel = G.itens.filter(i => G.sel.has(i.id)), soma = somaSelecao(sel)
  const maior = sel.filter(i => !i.dentroDoCar).sort((a, b) => (b.lavouraHa || b.areaHa) - (a.lavouraHa || a.areaHa))[0] || sel[0]
  const name = document.getElementById('geo-novo-nome').value.trim(), municipality = document.getElementById('geo-novo-mun').value.trim()
  if (!name || !municipality) return V.toast('Informe nome e município.', true)
  const cultures = ['soja', 'milho', 'trigo'].filter(c => soma[c] > 0)
  const body = {
    name, municipality, uf: 'RS', lat: maior.ponto[1], lng: maior.ponto[0], locationPrecision: 'exact',
    areaHa: Math.round(soma.lavouraHa), estimatedVolumeT: Math.round(soma.anoBom), volumeUnit: 't', cultures,
    relationship: document.getElementById('geo-novo-rel').value || 'prospect',
    notes: `Áreas identificadas pelo motor geo (CAR/SIGEF): ${sel.length} imóvel(is). Busca: “${G.ultimaBusca}”. Área = lavoura estimada; volume = potencial de grãos em ano bom pelo mix do município (IBGE).`
  }
  try {
    const p = await V.api('/api/producers', { method: 'POST', body })
    await V.api('/api/geo/vinculos', { method: 'POST', body: { producerId: p.id, imovelIds: sel.map(i => i.id), origem: 'cadastro-pelo-mapa', busca: G.ultimaBusca } })
    await V.reload()
    V.toast(`${p.name} cadastrado com ${sel.length} área(s).`)
    for (const i of sel) i.produtores = [...new Set([...(i.produtores || []), p.id])]
    G.sel = new Set(); desenharResultado(); G.ultimaJanela = ''; carregarJanela()
    V.showDetail(p.id)
  } catch (e) { V.toast(e.message, true) }
}

// ---------------------------------------------------------------------------------------------
// Detalhe do produtor: áreas vinculadas e potencial pelas áreas
// ---------------------------------------------------------------------------------------------
function observarDetalhe() {
  const det = document.getElementById('detail'); if (!det) return
  new MutationObserver(() => {
    if (det.hidden || !V.state.selected || det.querySelector('.geo-detail')) return
    secaoDetalhe(V.state.selected)
  }).observe(det, { childList: true })
}
async function secaoDetalhe(producerId) {
  const det = document.getElementById('detail'); if (!det || det.hidden) return
  let sec = det.querySelector('.geo-detail')
  if (!sec) { sec = document.createElement('div'); sec.className = 'geo-detail'; (det.querySelector('.detail-actions') || det.lastChild).before(sec) }
  sec.innerHTML = '<strong>Áreas no CAR/SIGEF</strong><p class="meta">Carregando…</p>'
  try {
    const r = await V.api(`/api/geo/vinculos?producerId=${encodeURIComponent(producerId)}`)
    if (V.state.selected !== producerId) return
    const p = V.state.data.producers.find(x => x.id === producerId)
    const pot = r.potencial
    sec.innerHTML = `<strong>Áreas no CAR/SIGEF</strong>
      ${r.vinculos.length ? `<p class="meta">${r.imoveisContados} imóve${r.imoveisContados === 1 ? 'l' : 'is'} · lavoura estimada <b>${fmt(pot.lavouraHa)} ha</b> · potencial <b>${fmt(pot.anoBom)} t/ano</b> em ano bom (soja ${fmt(pot.soja)} · milho ${fmt(pot.milho)} · trigo ${fmt(pot.trigo)}) · ${fmt(pot.media)} t na média de 5 anos</p>
      <ul class="geo-lista compacta">${r.vinculos.map(l => `<li><div class="geo-item"><b>${esc(l.imovel ? rotulo(l.imovel) : l.nome || l.imovelId)}</b><span>${esc(l.fonte)} · ${esc(l.municipio)} · ${fmt(l.areaHa, 1)} ha${l.matricula ? ` · mat. ${esc(l.matricula)}` : ''}</span></div>
        <div class="geo-item-acoes">${l.imovel ? `<button class="btn ghost small" type="button" data-geo-ir="${esc(l.imovelId)}">Ver</button>` : ''}<button class="btn ghost small danger" type="button" data-geo-desvincular="${esc(l.id)}" aria-label="Remover vínculo">×</button></div></li>`).join('')}</ul>
      <div class="detail-actions"><button class="btn small" type="button" data-geo-mostrar>Mostrar áreas no mapa</button><button class="btn small" type="button" data-geo-buscar-prod>Buscar mais áreas</button>${pot.anoBom ? `<button class="btn small ghost" type="button" data-geo-usar title="Grava a lavoura estimada como área e o potencial em ano bom como volume estimado">Usar no cadastro</button>` : ''}</div>`
        : `<p class="meta">Nenhuma área vinculada. Busque pelo nome do produtor para achar e marcar as áreas dele.</p><div class="detail-actions"><button class="btn small" type="button" data-geo-buscar-prod>Buscar áreas pelo nome</button></div>`}`
    sec.onclick = async e => {
      const ir = e.target.closest('[data-geo-ir]'), des = e.target.closest('[data-geo-desvincular]')
      if (ir) { const l = r.vinculos.find(x => x.imovelId === ir.dataset.geoIr); if (l?.imovel) { mostrarVinculos([l]); } return }
      if (des) { try { await V.api(`/api/geo/vinculos/${des.dataset.geoDesvincular}`, { method: 'DELETE' }); V.toast('Vínculo removido.'); G.ultimaJanela = ''; carregarJanela(); secaoDetalhe(producerId) } catch (er) { V.toast(er.message, true) } return }
      if (e.target.closest('[data-geo-mostrar]')) return mostrarVinculos(r.vinculos)
      if (e.target.closest('[data-geo-buscar-prod]')) {
        trocarAba('nome'); document.getElementById('geo-q').value = p?.name || ''
        const sel = document.getElementById('geo-mun'); sel.value = [...sel.options].some(o => o.value === p?.municipality) ? p.municipality : ''
        document.getElementById('geo-block').scrollIntoView({ behavior: 'smooth', block: 'start' }); return buscar()
      }
      if (e.target.closest('[data-geo-usar]') && p) {
        const emUnidade = t => (p.volumeUnit === 'sc' ? Math.round(t / SC_T) : t)   // o servidor converte pela unidade do cadastro, como o formulário
        const body = { ...p, areaHa: Math.round(pot.lavouraHa), estimatedVolumeT: emUnidade(Math.round(pot.anoBom)), storageCapacityT: p.storageCapacityT == null ? null : emUnidade(p.storageCapacityT) }
        try { await V.api(`/api/producers/${p.id}`, { method: 'PUT', body }); V.toast('Área e volume atualizados pelas áreas vinculadas.'); await V.reload() } catch (er) { V.toast(er.message, true) }
      }
    }
  } catch (e) { sec.innerHTML = `<strong>Áreas no CAR/SIGEF</strong><p class="meta">${esc(e.message)}</p>` }
}
async function mostrarVinculos(vinculos) {
  const itens = vinculos.map(l => l.imovel).filter(Boolean)
  if (!itens.length) return
  G.res.clearLayers()
  for (const i of itens) { try { G.res.addData(await V.api(`/api/geo/imoveis/${encodeURIComponent(i.id)}`)) } catch { /* imóvel fora da base atual */ } }
  marcarPins(itens)
  V.state.map.fitBounds(limites(itens), { padding: [50, 50], maxZoom: 15 })
}
