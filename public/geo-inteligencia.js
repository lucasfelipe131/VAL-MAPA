// VAL Geomap — inteligência geo (CAR + SIGEF). Módulo opcional carregado depois do app.js.
// Acrescenta, sem mudar a tela existente:
//  · painel "Imóveis rurais" no mapa: busca por nome do produtor (mesmo sem cadastro) ou por matrícula,
//    pins nas áreas encontradas, seleção e vínculo a um produtor (existente ou novo);
//  · camada com os imóveis do CAR/SIGEF da janela do mapa (a partir do zoom 11);
//  · seção "Áreas no CAR/SIGEF" no detalhe do produtor, com o potencial calculado pelas áreas vinculadas.
const V = window.valMapa
const G = { ativo: false, layer: null, res: null, pins: null, itens: [], sel: new Set(), aba: 'nome', ultimaBusca: '', status: null, timer: null }
const SC_T = 0.06
// Unidade do potencial na tela: toneladas ou sacas de 60 kg. Escolha guardada no navegador e usada por todos os
// módulos do Geomap (window.valUnidade); quem desenha potencial escuta o evento geo:unidade para redesenhar.
const UN = { atual: (() => { try { return localStorage.getItem('val-geomap-unidade') === 'sc' ? 'sc' : 't' } catch { return 't' } })() }
const potTxt = (t, sufixo = '') => (UN.atual === 'sc' ? `${fmt(Math.round((t || 0) / SC_T))} sc${sufixo}` : `${fmt(t)} t${sufixo}`)
const potCurto = t => {
  const v = UN.atual === 'sc' ? (t || 0) / SC_T : (t || 0), u = UN.atual === 'sc' ? 'sc' : 't'
  return v >= 1e6 ? `${fmt(v / 1e6, 1)} mi ${u}` : v >= 1e3 ? `${fmt(v / 1e3, v >= 1e4 ? 0 : 1)} mil ${u}` : `${fmt(v)} ${u}`
}
window.valUnidade = {
  get: () => UN.atual, SC_T, pot: potTxt, curto: potCurto,
  set(u) { UN.atual = u === 'sc' ? 'sc' : 't'; try { localStorage.setItem('val-geomap-unidade', UN.atual) } catch { /* sem armazenamento */ } window.dispatchEvent(new CustomEvent('geo:unidade', { detail: { unidade: UN.atual } })) }
}
const esc = s => (V ? V.esc(s) : String(s ?? ''))
const fmt = (v, d = 0) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }))
const COR = { vinculado: '#2d8cff', livre: '#e5a528', parcela: '#ffffff', selecionado: '#00c896', alta: '#009f78', media: '#e5a528', baixa: '#9aa8a3' }
// relação entre o nome buscado e o nome no registro do imóvel: [rótulo, classe do badge, explicação]
const REL = {
  nome: ['nome completo', 'high', 'Todas as palavras do nome aparecem no registro'],
  parecido: ['nome parecido', 'high', 'Todas as palavras aparecem, alguma com grafia um pouco diferente (erro de digitação ou acento)'],
  parcial: ['parcial', 'watch', 'O primeiro nome e parte do resto aparecem no registro'],
  sobrenome: ['mesmo sobrenome', 'incomplete', 'O registro tem o sobrenome, mas não o primeiro nome buscado: parente ou área da família']
}
const COR_REL = { nome: '#009f78', parecido: '#009f78', parcial: '#e5a528', sobrenome: '#9aa8a3' }
const rotulo = i => i.nome || (i.matricula ? `Matrícula ${i.matricula}` : i.car ? `CAR …${i.car.slice(-8)}` : 'Imóvel sem nome')
// ícones de traço (24×24), herdam a cor do texto
const svg = d => `<svg class="geo-svg" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`
const ICO = {
  terra: svg('<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z"/><path d="M9 4v13M15 6.5v13"/>'),
  busca: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  pessoas: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.7 2.8 2.4 3 5.2"/>'),
  relatorio: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  lupa: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8.5 11h5M11 8.5v5"/>'),
  escudo: svg('<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3Z"/>')
}
const produtorNome = id => V.state.data?.producers.find(p => p.id === id)?.name || 'produtor'
// folga nas bordas ao enquadrar: com o painel flutuante aberto (tela larga), a esquerda fica coberta
const painelCobre = () => innerWidth > 900 && !!document.querySelector('#view-map.imersivo:not(.painel-fechado)')
const folga = (b = 60) => ({ paddingTopLeft: L.point(painelCobre() ? 400 + b / 2 : b, b + 30), paddingBottomRight: L.point(b, b) })

if (V) iniciar()

function iniciar() {
  injetarPainel()
  // Espera o app carregar os dados (isto é, depois do login, quando o ambiente tem senha) antes de chamar /api/geo.
  const t = setInterval(() => { if (V.state.map && V.state.data) { clearInterval(t); montarCamadas(); carregarStatus() } }, 300)
  observarDetalhe()
  // com o cartão do produtor aberto, o seletor de camadas do mapa anda para o lado (CSS #view-map.com-detalhe)
  const det = document.getElementById('detail'), vista = document.getElementById('view-map')
  if (det && vista) new MutationObserver(() => vista.classList.toggle('com-detalhe', !det.hidden)).observe(det, { attributes: true, attributeFilter: ['hidden'] })
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
    <div class="geo-cab">
      <span class="geo-ico">${ICO.terra}</span>
      <div class="geo-cab-txt"><strong>Imóveis rurais</strong><small>CAR · SIGEF · socioambiental</small></div>
      <label class="geo-chave" title="Mostra no mapa os imóveis da janela (a partir do zoom 11)"><input id="geo-camada" type="checkbox"><span class="geo-chave-trilho" aria-hidden="true"></span><span>No mapa</span></label>
    </div>
    <p class="geo-status" id="geo-status">Carregando a base de imóveis…</p>
    <div class="geo-abas" role="tablist">
      <button type="button" role="tab" data-geo-aba="nome" aria-selected="true">Nome do produtor</button>
      <button type="button" role="tab" data-geo-aba="matricula" aria-selected="false">Matrícula</button>
    </div>
    <label class="field"><span id="geo-q-rotulo">Nome</span><span class="geo-busca">${ICO.busca}<input id="geo-q" type="search" placeholder="Ex.: Costa Beber" autocomplete="off"></span></label>
    <label class="field"><span id="geo-mun-rotulo" title="Na busca por nome, as áreas desse município vêm primeiro; as dos outros aparecem depois">Município (vem primeiro)</span><select id="geo-mun"><option value="">Todo o estado</option></select></label>
    <button id="geo-buscar" class="btn primary wide" type="button">${ICO.busca}<span class="lbl">Buscar áreas</span></button>
    <p class="hint" id="geo-dica">Acha as áreas pelo nome que aparece no registro do imóvel (SIGEF), mesmo de quem ainda não está cadastrado no VAL. Procura na base toda, aceita grafia parecida e sobrenome.</p>
    <div class="geo-atalhos">
      <button id="geo-completar" class="geo-atalho" type="button"><span class="geo-ico">${ICO.pessoas}</span><span><b class="lbl">Completar produtores</b><small>Pistas de área pelo nome e pelo ponto</small></span></button>
      <button id="geo-rel-mun" class="geo-atalho" type="button"><span class="geo-ico">${ICO.relatorio}</span><span><b>Relatório do município</b><small>Potencial, carteira e alertas</small></span></button>
    </div>
    <div class="row between geo-res-topo"><span></span><button id="geo-limpar" class="btn ghost small" type="button" hidden>Limpar resultado</button></div>
    <div id="geo-res"></div>`
  const primeiro = painel.querySelector('.panel-block')
  primeiro ? primeiro.after(bloco) : painel.prepend(bloco)

  bloco.querySelector('#geo-camada').onchange = e => ligarCamada(e.target.checked)
  bloco.querySelectorAll('[data-geo-aba]').forEach(b => b.onclick = () => trocarAba(b.dataset.geoAba))
  bloco.querySelector('#geo-buscar').onclick = buscar
  bloco.querySelector('#geo-q').onkeydown = e => { if (e.key === 'Enter') buscar() }
  bloco.querySelector('#geo-limpar').onclick = limparResultado
  bloco.querySelector('#geo-completar').onclick = completarProdutores
  bloco.querySelector('#geo-rel-mun').onclick = () => {
    const mun = document.getElementById('geo-mun').value
    if (!mun) { V.toast('Escolha o município no campo Município.', true); document.getElementById('geo-mun').focus(); return }
    window.open(`/relatorio.html?municipio=${encodeURIComponent(mun)}`, '_blank', 'noopener')
  }
  bloco.querySelector('#geo-res').onclick = cliqueResultado
  bloco.querySelector('#geo-res').onchange = mudancaResultado
}
function carregarStatus() {
  const bloco = document.getElementById('geo-block'); if (!bloco) return
  V.api('/api/geo/status').then(s => {
    G.status = s
    const sel = bloco.querySelector('#geo-mun')
    sel.innerHTML = '<option value="">Todo o estado</option>' + Object.values(s.municipios).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(n => `<option>${esc(n)}</option>`).join('')
    bloco.querySelector('#geo-status').innerHTML = `<b>${fmt(s.contagem.car)}</b> imóveis do CAR · <b>${fmt(s.contagem.sigef)}</b> parcelas SIGEF · <b>${fmt(Object.keys(s.municipios).length)}</b> municípios<small>${esc(s.regiao)}</small>`
  }).catch(e => { bloco.querySelector('#geo-status').textContent = `Base de imóveis indisponível: ${e.message}` })
}
function trocarAba(aba) {
  G.aba = aba
  document.querySelectorAll('[data-geo-aba]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.geoAba === aba)))
  const q = document.getElementById('geo-q')
  document.getElementById('geo-q-rotulo').textContent = aba === 'nome' ? 'Nome' : 'Matrícula'
  document.getElementById('geo-mun-rotulo').textContent = aba === 'nome' ? 'Município (vem primeiro)' : 'Município'
  q.placeholder = aba === 'nome' ? 'Ex.: Costa Beber' : 'Ex.: 12.345'
  q.inputMode = aba === 'nome' ? 'text' : 'numeric'
  document.getElementById('geo-dica').textContent = aba === 'nome'
    ? 'Acha as áreas pelo nome que aparece no registro do imóvel (SIGEF), mesmo de quem ainda não está cadastrado no VAL. Procura na região toda, aceita grafia parecida e sobrenome.'
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
  // destaque do imóvel com a ficha aberta (some quando a ficha fecha)
  G.destaque = L.geoJSON(null, { pane: 'geoImoveis', interactive: false, style: { color: '#c8f25e', weight: 4, fillColor: '#c8f25e', fillOpacity: .16, className: 'geo-destaque' } }).addTo(map)
  map.on('popupclose', e => { if (e.popup === G.popup) G.destaque.clearLayers() })
  map.on('moveend', () => { clearTimeout(G.timer); G.timer = setTimeout(carregarJanela, 250) })
}
// Mostra um imóvel vindo de fora da camada (busca única, "O que tem aqui?"): contorno em destaque, voo até ele e ficha
async function mostrarImovel(i, { latlng, outros = [], voar = true } = {}) {
  const map = V.state.map; if (!map || !i) return
  G.destaque.clearLayers()
  const centro = latlng ? L.latLng(latlng) : L.latLng(i.ponto[1], i.ponto[0])
  const abrir = () => { abrirFicha(i, centro, outros); V.api(`/api/geo/imoveis/${encodeURIComponent(i.id)}`).then(fc => { G.destaque.clearLayers(); G.destaque.addData({ ...fc, features: fc.features.filter(f => f.id === i.id) }) }).catch(() => {}) }
  if (!voar) return abrir()
  map.once('moveend', () => setTimeout(abrir, 60))
  map.flyToBounds([[i.bbox[1], i.bbox[0]], [i.bbox[3], i.bbox[2]]], { ...folga(90), maxZoom: 16, duration: 1.1 })
}
function ligarCamada(on = true) {
  const c = document.getElementById('geo-camada'); if (c) c.checked = on
  G.ativo = on; G.ultimaJanela = ''; carregarJanela()
  window.dispatchEvent(new CustomEvent('geo:camada', { detail: { ativo: on } }))
}
function buscarNoPainel(tipo, q, mun = '') {
  trocarAba(tipo)
  document.getElementById('geo-q').value = q
  const sel = document.getElementById('geo-mun'); sel.value = [...sel.options].some(o => o.value === mun) ? mun : ''
  window.dispatchEvent(new CustomEvent('geo:painel', { detail: { abrir: true, alvo: 'geo-block' } }))
  return buscar()
}
function estilo(f) {
  const p = f.properties
  if (G.sel.has(p.id)) return { color: COR.selecionado, weight: 3, fillColor: COR.selecionado, fillOpacity: .3 }
  if (p.dentroDoCar) return { color: COR.parcela, weight: 1, dashArray: '3 3', fillOpacity: 0, opacity: .8 }
  const base = p.produtores?.length ? { color: COR.vinculado, weight: 1.6, fillColor: COR.vinculado, fillOpacity: .3 } : { color: COR.livre, weight: 1.2, fillColor: COR.livre, fillOpacity: .1 }
  // contorno vermelho: triagem socioambiental crítica (embargo, TI, UC de proteção integral, supressão depois de 2020)
  return p.socioambiental?.nivel === 'critico' ? { ...base, color: '#d92d20', weight: 2.2 } : base
}
function aoCriarFeicao(f, layer) {
  const p = f.properties
  layer.bindTooltip(`<b>${esc(rotulo(p))}</b><br>${esc(p.fonte)}${p.dentroDoCar ? ' (dentro de um CAR)' : ''} · ${esc(p.municipio)} · ${fmt(p.areaHa, 1)} ha${p.potencialT.anoBom ? ` · ~${potTxt(p.potencialT.anoBom, '/ano')}` : ''}${p.matricula ? `<br>mat. ${esc(p.matricula)}` : ''}${p.produtores?.length ? `<br>Vinculado a ${esc(p.produtores.map(produtorNome).join(', '))}` : ''}${p.porte ? `<br>${esc(p.porte.rotulo)} · ${fmt(p.porte.modulos, 1)} MF` : ''}${p.socioambiental && p.socioambiental.nivel !== 'ok' ? `<br><b style="color:${p.socioambiental.nivel === 'critico' ? '#b42318' : '#8a5a00'}">${p.socioambiental.nivel === 'critico' ? 'Risco crítico' : 'Atenção'}:</b> ${esc(p.socioambiental.motivos[0]?.texto || '')}` : ''}`, { sticky: true })
  layer.on('click', e => {
    if (V.state.plan?.active) return   // planejando rota: o clique vai para o mapa (centro da visita)
    L.DomEvent.stopPropagation(e)
    // Ctrl/Shift + clique: seleciona direto (vários de uma vez); clique simples: abre a ficha
    if (e.originalEvent?.ctrlKey || e.originalEvent?.metaKey || e.originalEvent?.shiftKey) return alternarSelecao(p)
    abrirFicha(p, e.latlng)
  })
}
function alternarSelecao(p) {
  if (!G.itens.some(i => i.id === p.id)) G.itens.push(p)
  G.sel.has(p.id) ? G.sel.delete(p.id) : G.sel.add(p.id)
  restilizar(); desenharResultado()
  document.getElementById('geo-limpar').hidden = false
}

// Ficha do imóvel: abre no clique (camada, pins, busca ou "O que tem aqui?"), com o essencial e as ações.
// `outros` = demais imóveis no mesmo ponto (CAR e parcelas SIGEF dentro dele).
function abrirFicha(p, latlng, outros = []) {
  const map = V.state.map; if (!map) return
  const el = document.createElement('div'); el.className = 'geo-ficha'
  const desenhar = () => { el.innerHTML = htmlFicha(p, outros); const m = G.mais?.get(p.id); if (m) el.querySelector('[data-gf-mais]').innerHTML = htmlMais(m) }
  desenhar()
  carregarMais(p, el)
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-gf-sel]')) { alternarSelecao(p); desenhar(); return }
    const pb = e.target.closest('[data-gf-pb]'); if (pb) { map.closePopup(); window.valPesquisa?.abrirProspecto(pb.dataset.gfPb); return }
    const emp = e.target.closest('[data-gf-emp]'); if (emp) { window.valPesquisa?.abrirEmpresa(emp.dataset.gfEmp); return }
    if (e.target.closest('[data-gf-zoom]')) { map.closePopup(); map.flyToBounds([[p.bbox[1], p.bbox[0]], [p.bbox[3], p.bbox[2]]], { ...folga(70), maxZoom: 16, duration: .9 }); return }
    if (e.target.closest('[data-gf-rel]')) { window.open(`/relatorio.html?municipio=${encodeURIComponent(p.municipio)}`, '_blank', 'noopener'); return }
    if (e.target.closest('[data-gf-vinc]')) {
      const pid = el.querySelector('[data-gf-prod]')?.value
      if (!pid) { V.toast('Escolha o produtor.', true); return }
      if (!G.itens.some(i => i.id === p.id)) G.itens.push(p)
      await vincular(pid, [p.id], 'ficha-do-mapa', '')
      p.produtores = [...new Set([...(p.produtores || []), pid])]; desenhar(); return
    }
    if (e.target.closest('[data-gf-novo]')) {
      if (!G.itens.some(i => i.id === p.id)) G.itens.push(p)
      G.sel = new Set([p.id]); restilizar(); desenharResultado(); abrirNovoProdutor(p.nome ? titulo(p.nome) : '')
      window.dispatchEvent(new CustomEvent('geo:painel', { detail: { abrir: true, alvo: 'geo-novo-form' } }))
      map.closePopup(); return
    }
    const o = e.target.closest('[data-gf-outro]')
    if (o) { const q = outros.find(x => x.id === o.dataset.gfOutro); if (q) abrirFicha(q, latlng, [p, ...outros.filter(x => x.id !== q.id)]) }
  })
  L.DomEvent.disableScrollPropagation(el)
  G.popup = L.popup({ className: 'geo-ficha-pop', maxWidth: 340, minWidth: 290, autoPanPaddingTopLeft: L.point(painelCobre() ? 400 : 20, 80), autoPanPaddingBottomRight: L.point(painelCobre() && !document.getElementById('detail').hidden ? 430 : 30, 30) })
    .setLatLng(latlng).setContent(el).openOn(map)
}
function htmlFicha(p, outros) {
  const sa = p.socioambiental, nivel = sa?.nivel || 'ok', pot = p.potencialT || {}
  const produtores = (V.state.data?.producers || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const selecionado = G.sel.has(p.id)
  return `
    <div class="gf-topo"><span class="gf-fonte ${p.fonte === 'CAR' ? 'car' : 'sigef'}">${esc(p.fonte)}</span><span class="gf-mun">${esc(p.municipio)}</span>${seloRisco(nivel)}</div>
    <b class="gf-nome">${esc(rotulo(p))}</b>
    ${p.dentroDoCar ? '<span class="gf-sub">Parcela SIGEF dentro de um imóvel do CAR</span>' : p.situacao ? `<span class="gf-sub">CAR ${esc(p.situacao.toLowerCase())}${p.car ? ` · …${esc(p.car.slice(-8))}` : ''}</span>` : ''}
    <div class="gf-kpis">
      <div><span>Área</span><b>${fmt(p.areaHa, 1)} ha</b></div>
      <div><span>Lavoura est.</span><b>${fmt(p.lavouraHa)} ha</b></div>
      <div><span>Potencial</span><b>${pot.anoBom ? `~${potTxt(pot.anoBom)}` : '—'}</b></div>
    </div>
    ${pot.anoBom ? `<div class="gf-culturas">${[['Soja', pot.soja], ['Milho', pot.milho], ['Trigo', pot.trigo]].filter(([, v]) => v > 0).map(([n, v]) => `<span><i class="c-${n.toLowerCase()}"></i>${n} ${potTxt(v)}</span>`).join('')}</div>` : ''}
    <ul class="gf-linhas">
      ${p.matricula ? `<li>Matrícula <b>${esc(p.matricula)}</b>${p.cns ? ` · cartório ${esc(p.cns)}` : ''}</li>` : ''}
      ${p.porte ? `<li>${esc(p.porte.rotulo)} · ${fmt(p.porte.modulos, 1)} módulos fiscais</li>` : ''}
      ${sa?.motivos?.length ? sa.motivos.slice(0, 2).map(m => `<li class="gf-risco ${m.nivel}">${esc(m.texto)}</li>`).join('') : ''}
      ${p.produtores?.length ? `<li class="gf-vinc">Vinculado a ${p.produtores.map(id => `<a href="#" data-detail="${esc(id)}">${esc(produtorNome(id))}</a>`).join(', ')}</li>` : ''}
    </ul>
    <div class="gf-mais" data-gf-mais><span class="gf-mais-carregando">Procurando nomes ligados à área…</span></div>
    ${outros.length ? `<div class="gf-outros"><span>Também neste ponto</span>${outros.slice(0, 4).map(o => `<button type="button" data-gf-outro="${esc(o.id)}">${esc(o.fonte)} · ${esc(rotulo(o))} · ${fmt(o.areaHa)} ha</button>`).join('')}</div>` : ''}
    <div class="gf-vincular">
      <select data-gf-prod aria-label="Produtor do VAL"><option value="">Vincular a produtor…</option>${produtores.map(x => `<option value="${esc(x.id)}">${esc(x.name)} — ${esc(x.municipality)}</option>`).join('')}</select>
      <button type="button" class="btn small primary" data-gf-vinc>Vincular</button>
    </div>
    <div class="gf-acoes">
      <button type="button" class="btn small ${selecionado ? 'primary' : ''}" data-gf-sel title="Junta este imóvel a outros para vincular de uma vez (atalho: Ctrl + clique)">${selecionado ? '✓ Selecionado' : 'Selecionar'}</button>
      <button type="button" class="btn small" data-gf-novo>Novo produtor</button>
      <button type="button" class="btn small ghost" data-gf-zoom>Aproximar</button>
      <button type="button" class="btn small ghost" data-gf-rel>${ICO.relatorio}Município</button>
    </div>`
}
// Mais sobre o imóvel: nomes ligados à área em cadastros públicos, valor da terra e armazéns perto
async function carregarMais(p, el) {
  G.mais ||= new Map()
  if (G.mais.has(p.id)) return
  try {
    const d = await V.api(`/api/geo/imoveis/${encodeURIComponent(p.id)}/detalhe`)
    G.mais.set(p.id, d)
    const alvo = el.querySelector('[data-gf-mais]'); if (alvo) alvo.innerHTML = htmlMais(d)
  } catch { const alvo = el.querySelector('[data-gf-mais]'); if (alvo) alvo.innerHTML = '' }
}
const ROT_FONTE = { VAL: 'cliente VAL', SIGEF: 'SIGEF', IBAMA: 'embargo IBAMA' }
function htmlMais(d) {
  const real = v => (v >= 1e6 ? `R$ ${fmt(v / 1e6, 1)} mi` : `R$ ${fmt(v / 1e3, 0)} mil`)
  const nomes = d.nomes.filter(n => n.fonte !== 'VAL')
  const linhas = [
    ...nomes.slice(0, 4).map(n => `<li><b>${esc(n.nome)}</b><span class="gf-tag ${n.fonte.toLowerCase()}">${esc(ROT_FONTE[n.fonte] || n.fonte)}</span><small>${esc(n.detalhe)}</small></li>`),
    ...d.empresas.slice(0, 2).map(e => `<li><a href="#" data-gf-emp="${esc(e.id)}"><b>${esc(e.razaoSocial)}</b></a><span class="gf-tag cnpj">CNPJ</span><small>${esc(e.cnpj)} · ${esc(e.atividade.replace(/^d+s*/, ''))} · casou com ${esc(e.casou)}</small></li>`)
  ]
  const pb = d.produtorDaBase
  return `
    ${linhas.length ? `<div class="gf-nomes"><span class="gf-mais-tit">Nomes ligados à área</span><ul>${linhas.join('')}</ul></div>` : '<p class="gf-mais-vazio">Nenhum nome ligado a esta área nos cadastros públicos (o CAR não publica o dono).</p>'}
    ${pb ? `<button type="button" class="gf-pb" data-gf-pb="${esc(pb.id)}"><span>Produtor da base</span><b>${esc(pb.nome)}</b><small>${fmt(pb.areas)} área${pb.areas === 1 ? '' : 's'} · ${fmt(pb.areaHa)} ha${pb.potencialT ? ` · ~${potTxt(pb.potencialT)}` : ''}${pb.cliente ? ' · já é cliente' : ''}</small></button>` : ''}
    <ul class="gf-linhas">
      ${d.valorTerra?.reais ? `<li>Terra (estimativa pelo VTN ${d.valorTerra.ano}): <b>${real(d.valorTerra.reais)}</b></li>` : ''}
      ${d.armazemMaisPerto ? `<li>Armazém mais perto: <b>${esc(d.armazemMaisPerto.nome)}</b> a ${fmt(d.armazemMaisPerto.km, 1)} km</li>` : ''}
      ${d.cooperativaMaisPerto && d.cooperativaMaisPerto.nome !== d.armazemMaisPerto?.nome ? `<li>Cooperativa mais perto: <b>${esc(d.cooperativaMaisPerto.nome)}</b> a ${fmt(d.cooperativaMaisPerto.km, 1)} km</li>` : ''}
    </ul>
    ${linhas.length ? `<p class="gf-mais-aviso">${esc(d.aviso)}</p>` : ''}`
}
const restilizar = () => { G.layer?.setStyle(estilo); G.res?.setStyle(f => ({ ...estilo(f), weight: 2.5, fillOpacity: .28 })) }
// Legenda da camada de imóveis, no canto do mapa, só com a camada ligada; mostra também o estado da janela
function legenda(texto) {
  const map = V.state.map; if (!map) return
  if (!G.legenda) {
    G.legenda = L.control({ position: 'bottomleft' })
    G.legenda.onAdd = () => {
      const d = L.DomUtil.create('div', 'geo-legenda')
      d.innerHTML = `<b>Imóveis rurais</b>
        <span><i class="lg-livre"></i>Sem produtor do VAL</span><span><i class="lg-vinc"></i>Vinculado a produtor</span>
        <span><i class="lg-risco"></i>Risco socioambiental crítico</span><span><i class="lg-parcela"></i>Parcela SIGEF dentro de CAR</span>
        <small id="geo-legenda-st"></small>`
      L.DomEvent.disableClickPropagation(d)
      return d
    }
  }
  if (!G.ativo) { G.legenda.remove(); return }
  if (!G.legenda._map) G.legenda.addTo(map)
  const st = document.getElementById('geo-legenda-st'); if (st) st.textContent = texto || ''
}
async function carregarJanela() {
  const map = V.state.map; if (!map || !G.layer) return
  if (!G.ativo) { if (map.hasLayer(G.layer)) map.removeLayer(G.layer); legenda(); return }
  if (!map.hasLayer(G.layer)) G.layer.addTo(map)
  if (map.getZoom() < 11) { G.layer.clearLayers(); G.ultimaJanela = ''; legenda('Aproxime o mapa (zoom 11 ou mais) para ver os imóveis.'); return }
  const b = map.getBounds(), bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => v.toFixed(4)).join(',')
  if (bbox === G.ultimaJanela) return
  G.ultimaJanela = bbox
  legenda('Carregando…')
  try {
    const fc = await V.api(`/api/geo/imoveis?bbox=${bbox}`)
    G.layer.clearLayers(); G.layer.addData(fc)
    legenda(`${fmt(fc.features.length)} imóveis nesta área${fc.total > fc.features.length ? ` (de ${fmt(fc.total)})` : ''} · clique para ver a ficha`)
  } catch (e) { legenda(e.message) }
}

// ---------------------------------------------------------------------------------------------
// Busca e resultado
// ---------------------------------------------------------------------------------------------
async function buscar() {
  const q = document.getElementById('geo-q').value.trim(), mun = document.getElementById('geo-mun').value
  if (!q) return V.toast(G.aba === 'nome' ? 'Digite o nome do produtor.' : 'Digite a matrícula.', true)
  const btn = document.getElementById('geo-buscar'); btn.disabled = true; btn.querySelector('.lbl').textContent = 'Buscando…'
  try {
    const url = G.aba === 'nome' ? `/api/geo/nome?q=${encodeURIComponent(q)}&municipio=${encodeURIComponent(mun)}&geometria=1` : `/api/geo/matricula?numero=${encodeURIComponent(q)}&municipio=${encodeURIComponent(mun)}&geometria=1`
    const r = await V.api(url)
    G.ultimaBusca = q; G.ultimoTipo = G.aba; G.itens = r.itens; G.soma = r.soma; G.sel = new Set(); G.busca = { ...r.busca, munNome: mun }
    G.res.clearLayers(); if (r.geojson) G.res.addData(r.geojson)
    marcarPins(r.itens)
    desenharResultado()
    if (r.itens.length) V.state.map.flyToBounds(limites(r.itens), { ...folga(40), maxZoom: 14, duration: 1.1 })
  } catch (e) { V.toast(e.message, true) } finally { btn.disabled = false; btn.querySelector('.lbl').textContent = 'Buscar áreas' }
}
const limites = itens => itens.reduce((b, i) => [[Math.min(b[0][0], i.bbox[1]), Math.min(b[0][1], i.bbox[0])], [Math.max(b[1][0], i.bbox[3]), Math.max(b[1][1], i.bbox[2])]], [[90, 180], [-90, -180]])
function marcarPins(itens) {
  G.pins.clearLayers()
  for (const i of itens) {
    const cor = i.relacao ? COR_REL[i.relacao] : i.motivo === 'ponto' || i.motivo === 'perto' ? COR.livre : COR.vinculado
    L.marker([i.ponto[1], i.ponto[0]], { icon: L.divIcon({ className: 'geo-pin-wrap', html: `<span class="geo-pin" style="--c:${cor}"></span>`, iconSize: [22, 30], iconAnchor: [11, 30] }) })
      .bindTooltip(`<b>${esc(rotulo(i))}</b><br>${esc(i.municipio)} · ${fmt(i.areaHa, 1)} ha`, { direction: 'top', offset: [0, -26] })
      .on('click', e => { if (e.originalEvent?.ctrlKey || e.originalEvent?.metaKey || e.originalEvent?.shiftKey) return alternarSelecao(i); abrirFicha(i, e.latlng) })
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
    <p class="geo-soma"><b>${fmt(G.itens.length)} área${G.itens.length === 1 ? '' : 's'}</b> · ${fmt(soma.areaHa)} ha · lavoura estimada ${fmt(soma.lavouraHa)} ha · ~${potTxt(soma.anoBom, '/ano')} em ano bom</p>
    <label class="toggle"><input type="checkbox" data-geo-todos ${sel.length === G.itens.length ? 'checked' : ''}><span>Selecionar todas</span></label>
    <ul class="geo-lista">${G.itens.map(i => `<li class="${G.sel.has(i.id) ? 'on' : ''} ${i.relacao ? `rel-${i.relacao}` : ''} ${i.socioambiental?.nivel === 'critico' ? 'risco' : ''}">
      <input type="checkbox" data-geo-sel="${esc(i.id)}" ${G.sel.has(i.id) ? 'checked' : ''} aria-label="Selecionar ${esc(rotulo(i))}">
      <div class="geo-item"><b>${esc(rotulo(i))}</b>
        <span>${esc(i.fonte)}${i.dentroDoCar ? ' · dentro de um CAR' : ''} · ${esc(i.municipio)}${i.noMunicipio === false && G.busca?.munNome ? ` <em>(fora de ${esc(G.busca.munNome)})</em>` : ''} · ${fmt(i.areaHa, 1)} ha${i.potencialT.anoBom ? ` · ~${potTxt(i.potencialT.anoBom, '/ano')}` : ''}</span>
        ${i.matricula ? `<span>mat. ${esc(i.matricula)}${i.cns ? ` · cartório ${esc(i.cns)}` : ''}</span>` : ''}
        ${i.produtores?.length ? `<span class="geo-vinc">Vinculado a ${esc(i.produtores.map(produtorNome).join(', '))}</span>` : ''}</div>
      <div class="geo-item-acoes">${badgeRisco(i)}${i.relacao ? `<span class="badge ${REL[i.relacao][1]}" title="${esc(REL[i.relacao][2])}">${esc(REL[i.relacao][0])}</span>` : ''}<button class="btn ghost small" type="button" data-geo-ver="${esc(i.id)}">Ver</button></div></li>`).join('')}</ul>
    ${G.itens.some(i => i.relacao === 'parecido') ? '<p class="hint">“Nome parecido”: todas as palavras aparecem, alguma com uma letra diferente (erro de digitação no cadastro ou no registro).</p>' : ''}
    ${G.itens.some(i => i.relacao === 'sobrenome') ? '<p class="hint">“Mesmo sobrenome”: o registro não traz o primeiro nome buscado. Pode ser parente ou área da família; confira antes de vincular.</p>' : ''}
    ${G.busca?.sobrenomeCortado ? `<p class="hint">O sobrenome é comum: mostrando 80 de ${fmt(G.busca.sobrenomeCortado)} áreas com ele. Escreva o nome completo ou escolha o município.</p>` : ''}
    ${sel.length ? `<div class="geo-acoes">
      <p class="geo-soma"><b>${sel.length} selecionada${sel.length === 1 ? '' : 's'}</b> · lavoura ${fmt(somaSel.lavouraHa)} ha · ~${potTxt(somaSel.anoBom, '/ano')} (soja ${potTxt(somaSel.soja)} · milho ${potTxt(somaSel.milho)} · trigo ${potTxt(somaSel.trigo)})</p>
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
  const abrir = e.target.closest('[data-geo-abrir]')
  if (abrir) { V.showDetail(abrir.dataset.geoAbrir); return }
  const ver = e.target.closest('[data-geo-ver]')
  if (ver) { const i = G.itens.find(x => x.id === ver.dataset.geoVer); if (i) mostrarImovel(i); return }
  if (e.target.closest('[data-geo-vincular]')) {
    const producerId = document.getElementById('geo-produtor').value
    if (!producerId) return V.toast('Escolha o produtor.', true)
    return vincular(producerId, [...G.sel])
  }
  if (e.target.closest('[data-geo-novo]')) return abrirNovoProdutor()
  if (e.target.closest('[data-geo-criar]')) return criarProdutor()
}
async function vincular(producerId, ids, origem = G.ultimoTipo === 'nome' ? 'busca-nome' : 'busca-matricula', busca = G.ultimaBusca) {
  try {
    const r = await V.api('/api/geo/vinculos', { method: 'POST', body: { producerId, imovelIds: ids, origem, busca } })
    V.toast(`${r.criados} área(s) vinculada(s) a ${produtorNome(producerId)} · potencial ~${potTxt(r.potencial.anoBom, '/ano')} em ano bom.`)
    G.ultimaJanela = ''; await carregarJanela()
    for (const i of G.itens) if (ids.includes(i.id)) i.produtores = [...new Set([...(i.produtores || []), producerId])]
    G.sel = new Set(); restilizar(); desenharResultado()
    if (V.state.selected === producerId) secaoDetalhe(producerId)
  } catch (e) { V.toast(e.message, true) }
}
const titulo = s => String(s).toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\s(De|Da|Do|Dos|Das|E)\s/g, m => m.toLowerCase())
function abrirNovoProdutor(nomeSugerido) {
  const sel = G.itens.filter(i => G.sel.has(i.id))
  const muns = sel.reduce((m, i) => m.set(i.municipio, (m.get(i.municipio) || 0) + (i.lavouraHa || i.areaHa || 0)), new Map())
  const mun = [...muns.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  const rel = V.labels.relationships || {}
  const box = document.getElementById('geo-novo-form'); box.hidden = false
  box.innerHTML = `
    <label class="field"><span>Nome do produtor</span><input id="geo-novo-nome" value="${esc(nomeSugerido ?? (G.ultimoTipo === 'nome' ? titulo(G.ultimaBusca) : ''))}"></label>
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
    areaHa: Math.round(soma.lavouraHa), ...(UN.atual === 'sc' ? { estimatedVolumeSc: Math.round(soma.anoBom / SC_T), volumeUnit: 'sc' } : { estimatedVolumeT: Math.round(soma.anoBom), volumeUnit: 't' }), cultures,
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
  sec.innerHTML = `<div class="geo-sec-cab"><span class="geo-ico">${ICO.terra}</span><strong>Áreas no CAR/SIGEF</strong></div><p class="meta">Carregando…</p>`
  try {
    const r = await V.api(`/api/geo/vinculos?producerId=${encodeURIComponent(producerId)}`)
    if (V.state.selected !== producerId) return
    const p = V.state.data.producers.find(x => x.id === producerId)
    const pot = r.potencial
    const sa = r.socioambiental
    const nivel = sa?.nivel || 'ok'
    // barras de soja, milho e trigo no potencial em ano bom
    const culturas = [['Soja', pot.soja], ['Milho', pot.milho], ['Trigo', pot.trigo]].filter(([, v]) => v > 0)
    const maxCult = Math.max(1, ...culturas.map(([, v]) => v))
    sec.innerHTML = `<div class="geo-sec-cab"><span class="geo-ico">${ICO.terra}</span><strong>Áreas no CAR/SIGEF</strong><span class="geo-contagem">${r.imoveisContados}</span></div>
      ${r.vinculos.length ? `
      <div class="geo-kpis">
        <div><span>Lavoura estimada</span><b>${fmt(pot.lavouraHa)} ha</b><small>${r.imoveisContados} imóve${r.imoveisContados === 1 ? 'l' : 'is'} · ${fmt(pot.areaHa)} ha</small></div>
        <div><span>Potencial ano bom</span><b>${potTxt(pot.anoBom)}</b><small>média de 5 anos: ${potTxt(pot.media)}</small></div>
        <div><span>Porte</span><b>${r.porte ? esc(r.porte.rotulo.replace(' produtor', '')) : '—'}</b><small>${r.porte ? `${fmt(r.porte.modulos, 1)} módulos fiscais` : ''}</small></div>
        <div class="geo-kpi-risco ${nivel}"><span>Socioambiental</span><b>${ROT_RISCO[nivel].replace(/^./, c => c.toUpperCase())}</b><small>${sa?.motivos?.length ? `${sa.motivos.length} apontamento${sa.motivos.length === 1 ? '' : 's'}` : 'nas camadas consultadas'}</small></div>
      </div>
      ${culturas.length ? `<div class="geo-culturas">${culturas.map(([n, v]) => `<div><span>${n}</span><i style="--w:${(v / maxCult * 100).toFixed(1)}%"></i><b>${potTxt(v)}</b></div>`).join('')}</div>` : ''}
      ${r.porte ? `<p class="geo-credito">${ICO.escudo}<span>${esc(r.porte.credito)}</span></p>` : ''}
      ${sa?.motivos?.length ? `<ul class="geo-motivos">${sa.motivos.slice(0, 3).map(m => `<li class="${m.nivel}"><span>${esc(m.texto)}</span><small>${esc(m.imovel)} · ${esc(m.fonte)}</small></li>`).join('')}${sa.motivos.length > 3 ? `<li class="mais"><small>e mais ${sa.motivos.length - 3} no relatório</small></li>` : ''}</ul>` : ''}
      <ul class="geo-lista compacta">${r.vinculos.map(l => `<li><div class="geo-item"><b>${esc(l.imovel ? rotulo(l.imovel) : l.nome || l.imovelId)}</b><span>${esc(l.fonte)} · ${esc(l.municipio)} · ${fmt(l.areaHa, 1)} ha${l.matricula ? ` · mat. ${esc(l.matricula)}` : ''}</span></div>
        <div class="geo-item-acoes">${l.imovel ? badgeRisco(l.imovel) : ''}${l.imovel ? `<button class="btn ghost small" type="button" data-geo-ir="${esc(l.imovelId)}">Ver</button>` : ''}<button class="btn ghost small danger" type="button" data-geo-desvincular="${esc(l.id)}" aria-label="Remover vínculo">×</button></div></li>`).join('')}</ul>
      <div class="detail-actions geo-acoes-prod"><button class="btn small primary" type="button" data-geo-relatorio>${ICO.relatorio}Relatório do produtor</button><button class="btn small" type="button" data-geo-mostrar>Mostrar no mapa</button><button class="btn small" type="button" data-geo-buscar-prod>Buscar mais áreas</button>${pot.anoBom ? `<button class="btn small ghost" type="button" data-geo-usar title="Grava a lavoura estimada como área e o potencial em ano bom como volume estimado">Usar no cadastro</button>` : ''}</div>`
        : `<p class="meta">Nenhuma área vinculada. Confira as sugestões abaixo ou busque pelo nome no painel do mapa.</p><div class="detail-actions geo-acoes-prod"><button class="btn small" type="button" data-geo-buscar-prod>${ICO.busca}Buscar áreas pelo nome</button><button class="btn small" type="button" data-geo-relatorio>${ICO.relatorio}Relatório do produtor</button></div>`}
      <details class="geo-dobra"${r.vinculos.length ? '' : ' open'}><summary><span class="geo-ico">${ICO.lupa}</span>Sugestões de áreas<span class="geo-contagem" id="geo-sug-n">…</span></summary>
        <div class="geo-sug" id="geo-sug"><p class="meta">Procurando sugestões…</p></div></details>
      <details class="geo-dobra"><summary><span class="geo-ico">${ICO.doc}</span>Documentos<span class="geo-contagem" id="geo-docs-n">…</span></summary>
        <div class="geo-docs" id="geo-docs"><p class="meta">Carregando documentos…</p></div></details>`
    carregarSugestoes(producerId)
    carregarDocumentos(producerId)
    sec.onclick = async e => {
      if (e.target.closest('[data-geo-relatorio]')) return window.open(`/relatorio.html?produtor=${encodeURIComponent(producerId)}`, '_blank', 'noopener')
      if (e.target.closest('[data-geo-doc-enviar]')) return enviarDocumento(producerId)
      const apagar = e.target.closest('[data-geo-doc-apagar]')
      if (apagar) {
        if (!confirm(`Apagar o documento “${apagar.dataset.nome}”? Não dá para desfazer.`)) return
        try { await V.api(`/api/geo/documentos/${encodeURIComponent(apagar.dataset.geoDocApagar)}`, { method: 'DELETE' }); V.toast('Documento apagado.'); carregarDocumentos(producerId) } catch (er) { V.toast(er.message, true) }
        return
      }
      const sv = e.target.closest('[data-geo-sug-ver]'), sl = e.target.closest('[data-geo-sug-vincular]')
      if (sv || sl) {
        const i = todasSugestoes().find(x => x.id === (sv ? sv.dataset.geoSugVer : sl.dataset.geoSugVincular)); if (!i) return
        if (sv) return mostrarVinculos([{ imovel: i }])
        return vincular(producerId, [i.id], i.motivo === 'nome' ? 'sugestao-nome' : 'sugestao-ponto', i.motivo === 'nome' ? p?.name || '' : 'ponto do cadastro')
      }
      const ir = e.target.closest('[data-geo-ir]'), des = e.target.closest('[data-geo-desvincular]')
      if (ir) { const l = r.vinculos.find(x => x.imovelId === ir.dataset.geoIr); if (l?.imovel) { mostrarVinculos([l]); } return }
      if (des) { try { await V.api(`/api/geo/vinculos/${des.dataset.geoDesvincular}`, { method: 'DELETE' }); V.toast('Vínculo removido.'); G.ultimaJanela = ''; carregarJanela(); secaoDetalhe(producerId) } catch (er) { V.toast(er.message, true) } return }
      if (e.target.closest('[data-geo-mostrar]')) return mostrarVinculos(r.vinculos)
      if (e.target.closest('[data-geo-buscar-prod]')) {
        return buscarNoPainel('nome', p?.name || '', p?.municipality || '')
      }
      if (e.target.closest('[data-geo-usar]') && p) {
        const emUnidade = t => (p.volumeUnit === 'sc' ? Math.round(t / SC_T) : t)   // o servidor converte pela unidade do cadastro, como o formulário
        const body = { ...p, areaHa: Math.round(pot.lavouraHa), estimatedVolumeT: emUnidade(Math.round(pot.anoBom)), storageCapacityT: p.storageCapacityT == null ? null : emUnidade(p.storageCapacityT) }
        try { await V.api(`/api/producers/${p.id}`, { method: 'PUT', body }); V.toast('Área e volume atualizados pelas áreas vinculadas.'); await V.reload() } catch (er) { V.toast(er.message, true) }
      }
    }
  } catch (e) { sec.innerHTML = `<strong>Áreas no CAR/SIGEF</strong><p class="meta">${esc(e.message)}</p>` }
}
// Documentos do produtor: matrícula, KML, laudos, contratos (até 10 MB, lista fechada de tipos no servidor)
const CATEG_DOC = { matricula: 'Matrícula', car: 'CAR', kml: 'KML / mapa', laudo: 'Laudo', contrato: 'Contrato', outro: 'Outro' }
const tamanho = b => (b < 1024 ? `${b} B` : b < 1048576 ? `${fmt(b / 1024)} KB` : `${fmt(b / 1048576, 1)} MB`)
async function carregarDocumentos(producerId) {
  const box = document.getElementById('geo-docs'); if (!box) return
  try {
    const r = await V.api(`/api/geo/documentos?producerId=${encodeURIComponent(producerId)}`)
    if (V.state.selected !== producerId || !document.getElementById('geo-docs')) return
    const contD = document.getElementById('geo-docs-n'); if (contD) contD.textContent = r.itens.length
    document.getElementById('geo-docs').innerHTML = `
      ${r.itens.length ? `<ul class="geo-lista compacta">${r.itens.map(d => `<li><div class="geo-item"><b><a href="/api/geo/documentos/${encodeURIComponent(d.id)}">${esc(d.nome)}</a></b>
          <span>${esc(CATEG_DOC[d.categoria] || d.categoria)} · ${tamanho(d.size)} ·${new Date(d.createdAt).toLocaleDateString('pt-BR')}${d.descricao ? ` · ${esc(d.descricao)}` : ''}</span></div>
          <div class="geo-item-acoes"><button class="btn ghost small danger" type="button" data-geo-doc-apagar="${esc(d.id)}" data-nome="${esc(d.nome)}" aria-label="Apagar ${esc(d.nome)}">×</button></div></li>`).join('')}</ul>`
        : '<p class="meta">Nenhum documento. Anexe matrícula, KML do GeoMart, laudos ou contratos (até 10 MB).</p>'}
      <div class="geo-doc-form">
        <input type="file" id="geo-doc-arquivo" accept=".pdf,.kml,.kmz,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip">
        <div class="grid-2"><label class="field"><span>Tipo</span><select id="geo-doc-cat">${Object.entries(CATEG_DOC).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Descrição</span><input id="geo-doc-desc" maxlength="200" placeholder="Ex.: matrícula 16.213"></label></div>
        <button class="btn small" type="button" data-geo-doc-enviar>Anexar documento</button>
      </div>`
  } catch (e) { const b = document.getElementById('geo-docs'); if (b) b.innerHTML = `<p class="meta">${esc(e.message)}</p>` }
}
async function enviarDocumento(producerId) {
  const arq = document.getElementById('geo-doc-arquivo')?.files?.[0]
  if (!arq) return V.toast('Escolha o arquivo.', true)
  if (arq.size > 10 * 1024 * 1024) return V.toast('O arquivo passa de 10 MB.', true)
  const q = new URLSearchParams({ producerId, nome: arq.name, categoria: document.getElementById('geo-doc-cat').value, descricao: document.getElementById('geo-doc-desc').value.trim() })
  const btn = document.querySelector('[data-geo-doc-enviar]'); btn.disabled = true; btn.textContent = 'Enviando…'
  try {
    // o arquivo vai em binário (sem base64), por isso fetch direto e não V.api, que manda JSON
    const r = await fetch(`/api/geo/documentos?${q}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: arq })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(corpo.error || `Erro ${r.status}`)
    V.toast(`${arq.name} anexado.`); carregarDocumentos(producerId)
  } catch (e) { V.toast(e.message, true); btn.disabled = false; btn.textContent = 'Anexar documento' }
}
// Selo socioambiental (triagem com INPE, FUNAI, ICMBio e IBAMA)
const ROT_RISCO = { critico: 'risco crítico', atencao: 'atenção', ok: 'sem alerta' }
const seloRisco = n => `<span class="badge ${n === 'critico' ? 'risco-critico' : n === 'atencao' ? 'watch' : 'high'}">${ROT_RISCO[n || 'ok']}</span>`
const badgeRisco = i => (i?.socioambiental && i.socioambiental.nivel !== 'ok'
  ? `<span class="badge ${i.socioambiental.nivel === 'critico' ? 'risco-critico' : 'watch'}" title="${esc(i.socioambiental.motivos.map(m => m.texto).join(' · '))}">${ROT_RISCO[i.socioambiental.nivel]}</span>` : '')

// Sugestões para o produtor aberto: pelo nome (região toda) e pelo ponto do cadastro. Só mostram; vincular é um clique.
const todasSugestoes = () => (G.sug ? [...G.sug.nome, ...G.sug.dentro, ...G.sug.perto] : [])
async function carregarSugestoes(producerId) {
  const box = document.getElementById('geo-sug'); if (!box) return
  try {
    const s = await V.api(`/api/geo/sugestoes?producerId=${encodeURIComponent(producerId)}`)
    if (V.state.selected !== producerId || !document.getElementById('geo-sug')) return
    G.sug = s
    const lista = (itens, vazio) => (itens.length ? `<ul class="geo-lista compacta">${itens.map(linhaSugestao).join('')}</ul>` : vazio ? `<p class="meta">${vazio}</p>` : '')
    const perto = s.perto.slice(0, 5)
    const cont = document.getElementById('geo-sug-n'); if (cont) cont.textContent = s.nome.length + s.dentro.length
    document.getElementById('geo-sug').innerHTML = `
      <p class="meta">Pistas para conferir no mapa; nada é vinculado sem o seu clique.</p>
      <b class="geo-sub">Pelo nome · região toda</b>${lista(s.nome.slice(0, 8), 'Nenhum registro da base com esse nome ou sobrenome.')}
      ${s.temPonto
        ? `<b class="geo-sub">No ponto do cadastro</b>${lista(s.dentro.slice(0, 4), 'O ponto não cai em nenhum imóvel da base.')}
           ${perto.length ? `<details class="geo-perto"><summary>Perto do ponto (${perto.length})</summary>${lista(perto)}</details>` : ''}
           <p class="hint">O ponto pode estar na sede, num silo ou na área de outro dono: confira no mapa antes de vincular.</p>`
        : '<p class="meta">O cadastro não tem o ponto exato da propriedade. Marque-o em Editar para ver as áreas no ponto.</p>'}`
  } catch (e) { const b = document.getElementById('geo-sug'); if (b) b.innerHTML = `<p class="meta">${esc(e.message)}</p>` }
}
function linhaSugestao(i) {
  const tag = i.relacao ? `<span class="badge ${REL[i.relacao][1]}" title="${esc(REL[i.relacao][2])}">${esc(REL[i.relacao][0])}</span>`
    : i.motivo === 'ponto' ? '<span class="badge watch">no ponto</span>' : `<span class="badge incomplete">a ${fmt((i.km || 0) * 1000)} m</span>`
  return `<li><div class="geo-item"><b>${esc(rotulo(i))}</b>
      <span>${esc(i.fonte)}${i.dentroDoCar ? ' · dentro de um CAR' : ''} · ${esc(i.municipio)} · ${fmt(i.areaHa, 1)} ha${i.potencialT?.anoBom ? ` · ~${potTxt(i.potencialT.anoBom, '/ano')}` : ''}</span>
      ${i.matricula ? `<span>mat. ${esc(i.matricula)}</span>` : ''}
      ${i.produtores?.length ? `<span class="geo-vinc">Vinculado a ${esc(i.produtores.map(produtorNome).join(', '))}</span>` : ''}</div>
    <div class="geo-item-acoes">${tag}${badgeRisco(i)}<button class="btn ghost small" type="button" data-geo-sug-ver="${esc(i.id)}">Ver</button><button class="btn small" type="button" data-geo-sug-vincular="${esc(i.id)}">Vincular</button></div></li>`
}

// Painel: todos os produtores do VAL com a melhor pista de área de cada um
async function completarProdutores() {
  const box = document.getElementById('geo-res'), btn = document.getElementById('geo-completar')
  btn.disabled = true; btn.querySelector('.lbl').textContent = 'Procurando…'
  try {
    const r = await V.api('/api/geo/sugestoes')
    G.itens = []; G.sel = new Set(); G.res.clearLayers(); G.pins.clearLayers(); G.ultimaBusca = ''; restilizar()
    const itens = r.itens.slice().sort((a, b) => (a.areasVinculadas > 0) - (b.areasVinculadas > 0) || (b.nNomeForte > 0) - (a.nNomeForte > 0) || a.name.localeCompare(b.name, 'pt-BR'))
    const sem = itens.filter(x => !x.areasVinculadas).length
    const pista = x => {
      const m = x.melhor; if (!m) return 'Sem pista na base'
      const como = m.motivo === 'ponto' ? 'no ponto do cadastro' : REL[m.relacao]?.[0] || 'pelo nome'
      return `${como[0].toUpperCase()}${como.slice(1)}: ${rotulo(m)} · ${m.municipio} · ${fmt(m.areaHa)} ha`
    }
    box.innerHTML = `<p class="geo-soma"><b>${sem} de ${itens.length} produtores</b> sem áreas vinculadas.</p>
      <ul class="geo-lista compacta geo-produtores">${itens.map(x => `<li><div class="geo-item"><b>${esc(x.name)}</b>
        <span>${esc(x.municipality || '')} · ${x.areasVinculadas ? `<span class="geo-vinc">${x.areasVinculadas} área${x.areasVinculadas === 1 ? '' : 's'} vinculada${x.areasVinculadas === 1 ? '' : 's'}</span>` : 'sem áreas'}</span>
        <span>${esc(pista(x))}${x.nNome > 1 ? ` · mais ${x.nNome - 1} pelo nome` : ''}</span></div>
        <div class="geo-item-acoes"><button class="btn small" type="button" data-geo-abrir="${esc(x.producerId)}">Abrir</button></div></li>`).join('')}</ul>
      <p class="hint">Abrir mostra no cadastro do produtor as sugestões pelo nome e pelo ponto, para conferir no mapa e vincular.</p>`
    document.getElementById('geo-limpar').hidden = false
  } catch (e) { V.toast(e.message, true) } finally { btn.disabled = false; btn.querySelector('.lbl').textContent = 'Completar produtores' }
}

async function mostrarVinculos(vinculos) {
  const itens = vinculos.map(l => l.imovel).filter(Boolean)
  if (!itens.length) return
  G.res.clearLayers()
  for (const i of itens) { try { G.res.addData(await V.api(`/api/geo/imoveis/${encodeURIComponent(i.id)}`)) } catch { /* imóvel fora da base atual */ } }
  marcarPins(itens)
  V.state.map.flyToBounds(limites(itens), { ...folga(50), maxZoom: 15, duration: 1 })
}

// API para os outros módulos da tela (geo-imersivo.js: busca única, panorama, menu do mapa)
// usados pela camada de produtores da base e pela pesquisa com IA (geo-pesquisa.js)
// áreas de um produtor da base: viram o resultado do painel, todas selecionadas, com o cadastro aberto
function novoProdutorComAreas(itens, nome) {
  G.itens = itens.slice(); G.sel = new Set(itens.map(i => i.id)); G.ultimoTipo = 'nome'; G.ultimaBusca = nome
  G.res.clearLayers(); marcarPins(itens); restilizar(); desenharResultado(); abrirNovoProdutor(nome)
  window.dispatchEvent(new CustomEvent('geo:painel', { detail: { abrir: true, alvo: 'geo-novo-form' } }))
}
// contorno em destaque de vários imóveis (até 25), sem abrir ficha
async function destacar(ids) {
  G.destaque.clearLayers()
  for (const id of ids.slice(0, 25)) V.api(`/api/geo/imoveis/${encodeURIComponent(id)}`).then(fc => G.destaque.addData({ ...fc, features: fc.features.filter(x => x.id === id) })).catch(() => {})
}
window.valGeo = { G, abrirFicha, mostrarImovel, ligarCamada, buscarNoPainel, alternarSelecao, carregarJanela, rotulo, novoProdutorComAreas, destacar }
