// VAL Geomap — experiência imersiva do mapa. Módulo opcional, carregado depois de app.js e geo-inteligencia.js.
//  · mapa em tela cheia, com o painel flutuante que esconde e mostra (tecla P);
//  · busca única sobre o mapa (tecla / ou Ctrl+K): produtor do VAL, município, nome no CAR/SIGEF, matrícula, coordenada;
//  · seletor de camadas com miniaturas (mapa, satélite, híbrido) e as camadas do Geomap num lugar só;
//  · panorama do RS: os municípios pintados por potencial, alertas ou carteira, com ficha do município;
//  · menu do clique direito (ou toque longo): o que tem aqui, ficha do município, rota, cadastro, coordenadas;
//  · tour de boas-vindas e atalhos de teclado.
const V = window.valMapa
const I = { pan: null, porCodigo: new Map(), malha: null, feicoes: [], feiPorCod: new Map(), camada: null, porCamada: new Map(), metrica: 'potencial', panAtivo: true, quebras: [], cart: null, menu: null, sugAtiva: -1, sugItens: [], seq: 0 }
const esc = s => (V ? V.esc(s) : String(s ?? ''))
const fmt = (v, d = 0) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }))
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }
const ler = k => { try { return localStorage.getItem(k) } catch { return null } }
// potencial de grãos: na unidade escolhida (t ou sacas de 60 kg, window.valUnidade)
const abrev = t => (window.valUnidade ? window.valUnidade.curto(t) : t >= 1e6 ? `${fmt(t / 1e6, 1)} mi t` : t >= 1e3 ? `${fmt(t / 1e3, t >= 1e4 ? 0 : 1)} mil t` : `${fmt(t)} t`)
const svg = d => `<svg class="geo-svg" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`
const ICO = {
  busca: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  pessoa: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.8 3.6-5.8 7-5.8s6.2 2 7 5.8"/>'),
  cidade: svg('<path d="M4 20V9l5-3v14M9 20V4l6 3v13M15 20v-8l5 2v6M3 20h18"/>'),
  terra: svg('<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z"/><path d="M9 4v13M15 6.5v13"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  alvo: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  lista: svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  camadas: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  rota: svg('<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>'),
  mais: svg('<path d="M12 5v14M5 12h14"/>'),
  copiar: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  externo: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  painel: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>'),
  fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  ia: svg('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>')
}
const REL = { nome: 'nome completo', parecido: 'nome parecido', parcial: 'parcial', sobrenome: 'mesmo sobrenome' }

if (V) iniciar()
window.valImersivo = { voarMunicipio: (...a) => voarMunicipio(...a), abrirFichaMun: c => abrirFichaMun(c), fecharFichaMun: () => fecharFichaMun(), desenharCamadas: () => desenharCamadas(), pulso: l => pulso(l), nomeMunicipio: c => I.feiPorCod.get(c)?.name || '', municipios: () => I.feicoes.map(f => ({ code: f.code, name: f.name })), pontoMunicipio: c => pontoDentro(c), ICO }

function iniciar() {
  const t = setInterval(() => {
    if (!V.state.map || !V.state.data || !window.valGeo || !document.getElementById('geo-block')) return
    clearInterval(t)
    montarTela()
    montarCamadas()
    carregarPanorama()
  }, 250)
}

// ---------------------------------------------------------------------------------------------
// Tela: mapa em tela cheia, painel flutuante e busca única
// ---------------------------------------------------------------------------------------------
function montarTela() {
  const vista = document.getElementById('view-map'), map = V.state.map
  vista.classList.add('imersivo'); document.body.classList.add('im')
  const topo = () => document.documentElement.style.setProperty('--im-topo', `${document.querySelector('.topbar')?.offsetHeight || 56}px`)
  topo(); addEventListener('resize', topo)

  // botão do painel (aba na borda do painel; no celular, pílula embaixo)
  const btn = document.createElement('button')
  btn.type = 'button'; btn.className = 'im-painel-btn'; btn.id = 'im-painel-btn'
  btn.innerHTML = `${ICO.painel}<span class="lbl">Painel</span>`
  btn.onclick = () => painel(vista.classList.contains('painel-fechado'))
  vista.append(btn)
  const salvo = ler('val-geomap-painel')
  painel(salvo === null ? innerWidth > 900 : salvo === '1', { salvar: false })
  addEventListener('geo:painel', e => { painel(true); const alvo = e.detail?.alvo && document.getElementById(e.detail.alvo); if (alvo) setTimeout(() => alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120) })

  // busca única
  const caixa = document.createElement('div')
  caixa.className = 'im-busca'; caixa.setAttribute('role', 'search')
  caixa.innerHTML = `<span class="im-busca-ico">${ICO.busca}</span>
    <input id="im-q" type="search" autocomplete="off" spellcheck="false" placeholder="Produtor, município, nome no CAR/SIGEF, matrícula ou coordenada" aria-label="Buscar no mapa" role="combobox" aria-expanded="false" aria-controls="im-sug" aria-autocomplete="list">
    <kbd title="Atalho do teclado">/</kbd>
    <div id="im-sug" class="im-sug" role="listbox" hidden></div>`
  vista.append(caixa)
  L.DomEvent.disableClickPropagation(caixa); L.DomEvent.disableScrollPropagation(caixa)
  const q = caixa.querySelector('#im-q')
  let timer
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => sugerir(q.value), 160) })
  q.addEventListener('focus', () => { if (q.value.trim()) sugerir(q.value) })
  q.addEventListener('keydown', teclaBusca)
  q.addEventListener('blur', () => setTimeout(() => { if (!caixa.contains(document.activeElement)) fecharSug() }, 160))
  caixa.querySelector('#im-sug').addEventListener('mousedown', e => e.preventDefault())
  caixa.querySelector('#im-sug').addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) escolher(I.sugItens[Number(li.dataset.i)]) })

  // ajuda (atalhos e tour) no cabeçalho
  const acoes = document.querySelector('.topbar-actions')
  if (acoes && !document.getElementById('im-ajuda-btn')) {
    const a = document.createElement('button')
    a.type = 'button'; a.id = 'im-ajuda-btn'; a.className = 'btn ghost small im-ajuda-btn'; a.title = 'Atalhos e tour (?)'; a.setAttribute('aria-label', 'Ajuda: atalhos e tour')
    a.textContent = '?'; a.onclick = ajuda
    acoes.prepend(a)
  }

  // o mapa ocupa a tela toda: avisa o Leaflet do novo tamanho
  setTimeout(() => map.invalidateSize(), 60)
  map.on('contextmenu', abrirMenu)
  map.on('movestart zoomstart click', fecharMenu)
  document.addEventListener('keydown', atalhos)
  new MutationObserver(() => setTimeout(() => map.invalidateSize(), 40)).observe(vista, { attributes: true, attributeFilter: ['class'] })
  // qualquer mudança de tamanho da área do mapa (janela, cabeçalho, monitor) chega ao Leaflet; sem isso as camadas ficam cortadas
  if (window.ResizeObserver) {
    let quadro = 0
    new ResizeObserver(() => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(() => { const c = map.getContainer(); if (c.clientWidth && c.clientHeight) map.invalidateSize({ pan: false }) }) }).observe(map.getContainer())
  }
}

function painel(abrir, { salvar = true } = {}) {
  const vista = document.getElementById('view-map'), btn = document.getElementById('im-painel-btn')
  vista.classList.toggle('painel-fechado', !abrir)
  if (btn) { btn.setAttribute('aria-expanded', String(abrir)); btn.title = abrir ? 'Esconder o painel (P)' : 'Mostrar o painel (P)' }
  if (salvar) guardar('val-geomap-painel', abrir ? '1' : '0')
}

// ---------------------------------------------------------------------------------------------
// Busca única
// ---------------------------------------------------------------------------------------------
function coordenada(texto) {
  const t = texto.trim()
  let partes = t.split(/\s*;\s*|\s+|,\s+/).filter(Boolean)
  if (partes.length !== 2 && /^-?\d+\.\d+,-?\d+\.\d+$/.test(t)) partes = t.split(',')
  if (partes.length !== 2 || !/[.,]\d/.test(t)) return null
  const [lat, lng] = partes.map(x => Number(x.replace(',', '.')))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (Math.abs(lat) < 1 && Math.abs(lng) < 1)) return null
  return { lat, lng }
}
async function sugerir(texto) {
  const id = ++I.seq, n = norm(texto), q = document.getElementById('im-q')
  if (!n) return fecharSug()
  const palavras = n.split(' ')
  const itens = []
  const c = coordenada(texto)
  if (c) itens.push({ tipo: 'coord', grupo: 'Coordenada', ico: ICO.alvo, titulo: `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`, sub: 'Ir até o ponto e ver o imóvel que está nele', ...c })
  // produtores do VAL (na tela)
  const prods = (V.state.data?.producers || []).filter(p => { const h = norm(`${p.name} ${p.municipality} ${p.consultant || ''}`); return palavras.every(w => h.includes(w)) }).slice(0, 5)
  for (const p of prods) itens.push({ tipo: 'produtor', grupo: 'Produtores do VAL', ico: ICO.pessoa, titulo: p.name, sub: `${p.municipality}/${p.uf || ''}${p.areaHa ? ` · ${fmt(p.areaHa)} ha` : ''}`, id: p.id })
  // municípios (malha do IBGE)
  const muns = I.feicoes.filter(f => { const s = f.slug; return s.startsWith(n) || palavras.every(w => s.split(' ').some(x => x.startsWith(w))) }).slice(0, 4)
  for (const f of muns) { const d = I.porCodigo.get(f.code); itens.push({ tipo: 'municipio', grupo: 'Municípios', ico: ICO.cidade, titulo: f.name, sub: d ? `${abrev(d.potencialAnoBomT)} em ano bom · ${fmt(d.car)} imóveis no CAR` : 'Rio Grande do Sul', code: f.code }) }
  // matrícula: número com pouca letra
  if (!c && /\d/.test(texto) && texto.replace(/[^a-zA-Z]/g, '').length <= 3) {
    const mun = document.getElementById('geo-mun')?.value || ''
    itens.push({ tipo: 'matricula', grupo: 'Matrícula', ico: ICO.doc, titulo: `Buscar a matrícula ${texto.trim()}`, sub: mun ? `no município de ${mun}` : 'em todo o estado · escolha o município no painel para precisar', numero: texto.trim(), mun })
  }
  if (window.valPesquisa && (/\?\s*$/.test(texto) || texto.trim().split(/\s+/).length >= 5)) itens.unshift({ tipo: 'ia', grupo: 'VAL', ico: ICO.ia, titulo: `Perguntar à VAL:“${texto.trim().slice(0, 90)}”`, sub: 'Cruza imóveis, produtores, empresas e municípios e marca no mapa (Q)', q: texto.trim() })
  const nomeNaBase = !/\d/.test(texto) && n.replace(/[^a-z]/g, '').length >= 3
  if (nomeNaBase) itens.push({ tipo: 'carregando', grupo: 'Nome no registro do imóvel (CAR/SIGEF)', ico: ICO.terra, titulo: 'Procurando na base do RS…', sub: '' })
  mostrarSug(itens)
  if (!nomeNaBase) return
  try {
    const r = await V.api(`/api/geo/nome?q=${encodeURIComponent(texto.trim())}&municipio=`)
    if (id !== I.seq || q.value.trim() !== texto.trim()) return
    const base = itens.filter(i => i.tipo !== 'carregando')
    const grupo = 'Nome no registro do imóvel (CAR/SIGEF)'
    if (!r.itens.length) base.push({ tipo: 'vazio', grupo, ico: ICO.terra, titulo: 'Nenhuma área com esse nome', sub: 'Nem todo imóvel tem o nome do dono no registro' })
    for (const it of r.itens.slice(0, 5)) base.push({ tipo: 'imovel', grupo, ico: ICO.terra, titulo: window.valGeo.rotulo(it), sub: `${it.fonte} · ${it.municipio} · ${fmt(it.areaHa)} ha${it.potencialT?.anoBom ? ` · ~${fmt(it.potencialT.anoBom)} t/ano` : ''}`, tag: REL[it.relacao] || '', risco: it.socioambiental?.nivel, item: it })
    if (r.itens.length > 1) base.push({ tipo: 'nome-todos', grupo, ico: ICO.lista, titulo: `Ver as ${fmt(r.total)} áreas no painel`, sub: 'Com pins, seleção, soma do potencial e vínculo', q: texto.trim() })
    mostrarSug(base)
  } catch (e) {
    if (id !== I.seq) return
    mostrarSug(itens.filter(i => i.tipo !== 'carregando').concat([{ tipo: 'vazio', grupo: 'Nome no registro do imóvel (CAR/SIGEF)', ico: ICO.terra, titulo: 'Base de imóveis indisponível agora', sub: e.message }]))
  }
}
function mostrarSug(itens) {
  const box = document.getElementById('im-sug'), q = document.getElementById('im-q')
  I.sugItens = itens; I.sugAtiva = itens.findIndex(selecionavel)
  if (!itens.length) { box.innerHTML = '<p class="im-sug-vazio">Nada encontrado. Tente o sobrenome, o município ou a matrícula.</p>'; box.hidden = false; q.setAttribute('aria-expanded', 'true'); return }
  let grupo = ''
  box.innerHTML = itens.map((it, i) => {
    const cab = it.grupo !== grupo ? `<div class="im-sug-grupo" role="presentation">${esc((grupo = it.grupo))}</div>` : ''
    return `${cab}<div class="im-sug-item ${selecionavel(it) ? '' : 'inerte'} ${i === I.sugAtiva ? 'ativo' : ''}" role="option" id="im-sug-${i}" data-i="${i}" aria-selected="${i === I.sugAtiva}">
      <span class="im-sug-ico">${it.ico}</span><span class="im-sug-txt"><b>${esc(it.titulo)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
      ${it.risco === 'critico' ? '<span class="badge risco-critico">risco</span>' : ''}${it.tag ? `<span class="im-sug-tag">${esc(it.tag)}</span>` : ''}</div>`
  }).join('')
  box.hidden = false; q.setAttribute('aria-expanded', 'true')
  if (I.sugAtiva >= 0) q.setAttribute('aria-activedescendant', `im-sug-${I.sugAtiva}`)
}
const selecionavel = it => it && !['carregando', 'vazio'].includes(it.tipo)
function fecharSug() {
  const box = document.getElementById('im-sug'); if (box) box.hidden = true
  document.getElementById('im-q')?.setAttribute('aria-expanded', 'false')
}
function teclaBusca(e) {
  const box = document.getElementById('im-sug')
  if (e.key === 'Escape') { if (!box.hidden) fecharSug(); else e.target.blur(); e.stopPropagation(); return }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (box.hidden) return sugerir(e.target.value)
    const passo = e.key === 'ArrowDown' ? 1 : -1, n = I.sugItens.length
    let i = I.sugAtiva
    for (let k = 0; k < n; k++) { i = (i + passo + n) % n; if (selecionavel(I.sugItens[i])) break }
    I.sugAtiva = i
    box.querySelectorAll('.im-sug-item').forEach(el => { const on = Number(el.dataset.i) === i; el.classList.toggle('ativo', on); el.setAttribute('aria-selected', String(on)); if (on) el.scrollIntoView({ block: 'nearest' }) })
    e.target.setAttribute('aria-activedescendant', `im-sug-${i}`)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const it = I.sugItens[I.sugAtiva]
    if (selecionavel(it)) return escolher(it)
    const c = coordenada(e.target.value); if (c) return escolher({ tipo: 'coord', ...c })
  }
}
function escolher(it) {
  if (!selecionavel(it)) return
  const map = V.state.map, q = document.getElementById('im-q')
  fecharSug(); q.blur()
  if (it.tipo === 'produtor') {
    const p = V.state.data.producers.find(x => x.id === it.id)
    V.showDetail(it.id)
    if (p?.lat != null) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 13), { duration: 1.1 })
    return
  }
  if (it.tipo === 'municipio') return voarMunicipio(it.code, { ficha: true })
  if (it.tipo === 'ia') { q.value = ''; return window.valPesquisa?.perguntar(it.q) }
  if (it.tipo === 'coord') return voarPonto(L.latLng(it.lat, it.lng))
  if (it.tipo === 'matricula') return window.valGeo.buscarNoPainel('matricula', it.numero, it.mun)
  if (it.tipo === 'imovel') return window.valGeo.mostrarImovel(it.item)
  if (it.tipo === 'nome-todos') return window.valGeo.buscarNoPainel('nome', it.q, document.getElementById('geo-mun')?.value || '')
}
function voarPonto(latlng) {
  const map = V.state.map
  pulso(latlng)
  map.once('moveend', () => setTimeout(() => oQueTemAqui(latlng), 80))
  map.flyTo(latlng, Math.max(map.getZoom(), 15), { duration: 1.2 })
}
// marcador que pulsa por alguns segundos no ponto escolhido
function pulso(latlng) {
  const m = L.marker(latlng, { interactive: false, icon: L.divIcon({ className: 'im-pulso-wrap', html: '<span class="im-pulso"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(V.state.map)
  setTimeout(() => m.remove(), 4200)
}

// ---------------------------------------------------------------------------------------------
// Camadas: seletor com miniaturas, num controle só
// ---------------------------------------------------------------------------------------------
const BASES = [
  { nome: 'Mapa', rotulo: 'Mapa', thumb: 'https://a.tile.openstreetmap.org/7/44/74.png' },
  { nome: 'Satélite', rotulo: 'Satélite', thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/7/74/44' },
  { nome: 'Satélite com nomes', rotulo: 'Híbrido', thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/7/74/44' }
]
// o híbrido contém a camada de satélite: confere ele primeiro
const baseAtual = () => [BASES[2], BASES[1], BASES[0]].find(b => V.state.map.hasLayer(V.state.baseLayers?.[b.nome])) || BASES[0]
function trocarBase(nome) {
  const map = V.state.map, bases = V.state.baseLayers; if (!bases?.[nome]) return
  for (const [n, l] of Object.entries(bases)) if (n !== nome && map.hasLayer(l)) map.removeLayer(l)
  if (!map.hasLayer(bases[nome])) bases[nome].addTo(map)
  map.fire('baselayerchange', { layer: bases[nome], name: nome })   // o app.js guarda a escolha
  desenharCamadas()
}
function montarCamadas() {
  const map = V.state.map
  I.ctlCamadas = L.control({ position: 'bottomright' })
  I.ctlCamadas.onAdd = () => {
    const d = L.DomUtil.create('div', 'im-camadas')
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d)
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-base]'); if (b) return trocarBase(b.dataset.base)
      if (e.target.closest('[data-rapida]')) { const atual = baseAtual(); return trocarBase(atual.nome === 'Mapa' ? 'Satélite com nomes' : 'Mapa') }
      if (e.target.closest('[data-abrir]')) { d.classList.toggle('aberto'); return }
      const un = e.target.closest('[data-unidade]'); if (un) { window.valUnidade?.set(un.dataset.unidade); return }
    })
    d.addEventListener('change', e => {
      const c = e.target.closest('[data-camada]'); if (!c) return
      const on = c.checked
      if (c.dataset.camada === 'panorama') return panorama(on)
      if (c.dataset.camada === 'armazens') return armazens(on)
      if (c.dataset.camada === 'prospectos') return window.valPesquisa?.camada(on)
      if (c.dataset.camada === 'imoveis') { window.valGeo.ligarCamada(on); if (on && map.getZoom() < 11) V.toast('Imóveis rurais aparecem a partir do zoom 11: aproxime o mapa.'); return }
      const camada = c.dataset.camada === 'produtores' ? V.state.layer : V.state.muniLayer
      if (on) { camada.addTo(map); if (camada === V.state.muniLayer) V.renderMunicipalities() } else map.removeLayer(camada)
    })
    return d
  }
  I.ctlCamadas.addTo(map)
  desenharCamadas()
  map.on('layeradd layerremove', e => { if (e.layer === V.state.layer || e.layer === V.state.muniLayer) desenharCamadas() })
  addEventListener('geo:camada', desenharCamadas)
  addEventListener('geo:unidade', () => { desenharCamadas(); if (I.pan) { pintar(); desenharLegenda() } if (I.fmCod) abrirFichaMun(I.fmCod) })
  if (ler('val-geomap-armazens') === '1') armazens(true, { salvar: false })
  document.addEventListener('click', e => { const d = document.querySelector('.im-camadas.aberto'); if (d && !d.contains(e.target)) d.classList.remove('aberto') })
}
function desenharCamadas() {
  const d = document.querySelector('.im-camadas'); if (!d) return
  const map = V.state.map, atual = baseAtual(), outra = atual.nome === 'Mapa' ? BASES[2] : BASES[0]
  const aberto = d.classList.contains('aberto')
  const chk = (id, rotulo, on, sub) => `<label class="im-cam-op"><input type="checkbox" data-camada="${id}" ${on ? 'checked' : ''}><span class="geo-chave-trilho" aria-hidden="true"></span><span><b>${rotulo}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`
  d.innerHTML = `
    <button type="button" class="im-cam-rapida" data-rapida title="Trocar para ${outra.rotulo} (S)" style="--thumb:url('${outra.thumb}')"><span>${outra.rotulo}</span></button>
    <button type="button" class="im-cam-abrir" data-abrir aria-expanded="${aberto}" title="Camadas">${ICO.camadas}<span>Camadas</span></button>
    <div class="im-cam-menu">
      <b class="im-cam-tit">Mapa base</b>
      <div class="im-cam-bases">${BASES.map(b => `<button type="button" data-base="${esc(b.nome)}" class="${b.nome === atual.nome ? 'on' : ''}" style="--thumb:url('${b.thumb}')"><span>${b.rotulo}</span></button>`).join('')}</div>
      <b class="im-cam-tit">Camadas do Geomap</b>
      ${chk('panorama', 'Panorama do RS', I.panAtivo, 'Municípios por potencial, alertas ou carteira (E)')}
      ${chk('imoveis', 'Imóveis rurais', !!window.valGeo?.G.ativo, 'CAR e SIGEF, a partir do zoom 11 (I)')}
      ${chk('produtores', 'Produtores do VAL', map.hasLayer(V.state.layer), 'Cor pela prioridade, tamanho pelo volume')}
      ${chk('prospectos', 'Produtores da base', !!window.valPesquisa?.ativo(), 'Pessoas e empresas dos cadastros públicos, com filtros (R)')}
      ${chk('armazens', 'Armazéns (CONAB)', !!I.armOn, 'Empresas e cooperativas, pela capacidade (A)')}
      ${chk('limites', 'Municípios com produtores', map.hasLayer(V.state.muniLayer), 'Limites do IBGE')}
      <b class="im-cam-tit">Unidade do potencial</b>
      <div class="im-cam-unidade" role="group" aria-label="Unidade do potencial">${[['t', 'Toneladas'], ['sc', 'Sacas de 60 kg']].map(([u, r]) => `<button type="button" data-unidade="${u}" aria-pressed="${(window.valUnidade?.get() || 't') === u}" class="${(window.valUnidade?.get() || 't') === u ? 'on' : ''}">${r}</button>`).join('')}</div>
      ${I.armOn ? '<p class="im-cam-leg"><i style="background:#1555b0"></i>cooperativa <i style="background:#c2410c"></i>empresa <i style="background:#5f6b66"></i>oficial</p>' : ''}
    </div>`
  d.classList.toggle('aberto', aberto)
  d.querySelectorAll('.im-cam-bases [data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === atual.nome))
}

// ---------------------------------------------------------------------------------------------
// Camada de armazéns (CONAB): unidades de empresas e cooperativas, círculo pela capacidade, cor pelo dono.
// SVG num painel próprio: a área vazia deixa o mouse passar para o panorama (canvas) embaixo.
// ---------------------------------------------------------------------------------------------
const COR_DONO = { coop: '#1555b0', priv: '#c2410c', ofic: '#5f6b66' }, ROT_DONO = { coop: 'Cooperativa', priv: 'Empresa privada', ofic: 'Oficial' }
const tCurto = t => (t >= 1e6 ? `${fmt(t / 1e6, 2)} mi t` : t >= 1e3 ? `${fmt(t / 1e3, 0)} mil t` : `${fmt(t)} t`)
async function armazens(on, { salvar = true } = {}) {
  const map = V.state.map
  I.armOn = on
  if (salvar) guardar('val-geomap-armazens', on ? '1' : '0')
  if (!on) { if (I.armCamada) map.removeLayer(I.armCamada); desenharCamadas(); return }
  try {
    if (!I.armCamada) {
      const r = await V.api('/api/geo/armazens')
      if (!map.getPane('imArmazens')) { map.createPane('imArmazens'); map.getPane('imArmazens').style.zIndex = 395 }
      const rend = L.svg({ pane: 'imArmazens', padding: 0.3 })
      I.armCamada = L.layerGroup(r.pontos.map(([lat, lng, t, esp, dono, nome]) => L.circleMarker([lat, lng], { pane: 'imArmazens', renderer: rend, radius: Math.max(3, Math.min(13, Math.sqrt(t) / 24)), color: '#fff', weight: 1.2, fillColor: COR_DONO[dono] || COR_DONO.priv, fillOpacity: 0.88 })
        .bindTooltip(`<b>${esc(nome)}</b><span>${ROT_DONO[dono] || 'Empresa'} · ${esp === 'g' ? 'granel' : 'convencional'}</span><span class="im-tip-v">Capacidade estática: <b>${tCurto(t)}</b></span>`, { className: 'im-tip', direction: 'top', offset: [0, -6] })))
      I.armFonte = r.fonte
    }
    if (I.armOn) I.armCamada.addTo(map)
  } catch (e) { I.armOn = false; V.toast(`Armazéns indisponíveis agora: ${e.message}`, true) }
  desenharCamadas()
}

// ---------------------------------------------------------------------------------------------
// Panorama do RS: municípios pintados por um indicador
// ---------------------------------------------------------------------------------------------
const METRICAS = {
  potencial: { rotulo: 'Potencial', titulo: 'Potencial de grãos em ano bom', fonte: 'IBGE PAM · soja, milho e trigo', rampa: ['#d3eee0', '#9fd8bd', '#5fbb95', '#25916c', '#0b6247'], valor: d => d?.potencialAnoBomT || 0, texto: v => abrev(v), curto: v => abrev(v).replace(/ (t|sc)$/, '') },
  alertas: { rotulo: 'Alertas', titulo: '% dos imóveis do CAR com alerta crítico', fonte: 'INPE, IBAMA e ICMBio', rampa: ['#fbe6c8', '#f6c88f', '#ee9f55', '#d4722a', '#9c4612'], valor: d => (d?.car ? d.criticos / d.car * 100 : 0), texto: v => `${fmt(v, v < 10 ? 1 : 0)}%`, curto: v => `${fmt(v, v < 10 ? 1 : 0)}%` },
  armazem: { rotulo: 'Armazém', titulo: 'Quanto da safra (ano bom) cabe nos armazéns', fonte: 'CONAB (SICARM) e IBGE PAM', rampa: ['#ece4f7', '#cdb8ec', '#a587d9', '#7a57bf', '#4f2d94'], valor: d => (d?.potencialAnoBomT > 0 && d.armazemT > 0 ? d.armazemT / d.potencialAnoBomT * 100 : 0), texto: v => `${fmt(v)}% da safra`, curto: v => `${fmt(v)}%` },
  terra: { rotulo: 'Terra', titulo: 'Valor da terra nua, lavoura boa (R$/ha)', fonte: 'Receita Federal (VTN do ITR, 2026 e 2025)', rampa: ['#f3efd6', '#e2d79b', '#c9b85c', '#a08f2e', '#6e6216'], valor: d => d?.vtnLavouraBoa || 0, texto: v => `R$ ${fmt(v)}/ha`, curto: v => `${fmt(v / 1000, 0)} mil` },
  carteira: { rotulo: 'Carteira VAL', titulo: 'Produtores do VAL no município', fonte: 'Cadastro do VAL', rampa: ['#d6e7fd', '#a9cbf8', '#6ea5ef', '#3a7fdc', '#1555b0'], valor: d => d?.produtoresVal || 0, texto: v => `${fmt(v)} produtor${v === 1 ? '' : 'es'}`, curto: v => fmt(v) }
}
const SEM_DADO = '#aab5b1'
async function carregarPanorama() {
  const map = V.state.map
  I.panAtivo = ler('val-geomap-panorama') !== '0'
  I.metrica = METRICAS[ler('val-geomap-metrica')] ? ler('val-geomap-metrica') : 'potencial'
  try {
    I.malha = await V.loadMesh('RS')
    I.feicoes = I.malha.features.map(f => ({ code: f.properties.code, name: f.properties.name, slug: f.properties.slug || norm(f.properties.name), feature: f, bbox: caixa(f.geometry) }))
    I.feiPorCod = new Map(I.feicoes.map(f => [f.code, f]))
  } catch (e) { console.warn('Panorama: malha indisponível', e); return }
  try { const r = await V.api('/api/geo/panorama'); I.pan = r.itens; I.porCodigo = new Map(r.itens.map(x => [x.codigoIbge, x])) } catch (e) { console.warn('Panorama: dados indisponíveis', e); I.pan = [] }
  if (!map.getPane('imPanorama')) { map.createPane('imPanorama'); map.getPane('imPanorama').style.zIndex = 330 }
  // canvas em vez de SVG: 500 polígonos num quadro só, sem dezenas de camadas para a placa de vídeo pintar
  I.camada = L.geoJSON(I.malha, {
    pane: 'imPanorama',
    renderer: L.canvas({ pane: 'imPanorama', padding: 0.3, tolerance: 2 }),
    style: estiloPan,
    onEachFeature: (f, layer) => {
      I.porCamada.set(f.properties.code, layer)
      layer.bindTooltip(() => dicaMunicipio(f.properties), { sticky: true, direction: 'top', offset: [0, -10], className: 'im-tip', opacity: 1 })
      layer.on('mouseover', () => { if (map.getZoom() < 11) { layer.setStyle({ weight: 2.6, color: '#071b19', opacity: .9 }); layer.bringToFront() } })
      layer.on('mouseout', () => layer.setStyle(estiloPan(f)))
      layer.on('click', e => {
        if (V.state.plan?.active) return   // planejando rota: o clique vai para o mapa (centro da visita)
        L.DomEvent.stopPropagation(e); voarMunicipio(f.properties.code, { ficha: true })
      })
    }
  })
  let perto = map.getZoom() >= 11
  map.on('zoomend', () => {
    if (!I.camada) return
    I.camada.setStyle(estiloPan)
    const agora = map.getZoom() >= 11
    map.getPane('imPanorama').classList.toggle('im-pan-inerte', agora)
    if (agora !== perto) { perto = agora; I.legRecolhida = null; if (I.panAtivo) desenharLegenda() }   // de perto a legenda recolhe; de longe abre
  })
  map.getPane('imPanorama').classList.toggle('im-pan-inerte', map.getZoom() >= 11)
  // com uma ficha aberta, a legenda recolhe para não cobrir a ficha
  map.on('popupopen popupclose', e => { I.fichaAberta = e.type === 'popupopen'; if (I.legRecolhida == null && I.panAtivo) desenharLegenda() })
  const legenda = L.control({ position: 'bottomleft' })
  legenda.onAdd = () => { const d = L.DomUtil.create('div', 'im-pan-leg'); L.DomEvent.disableClickPropagation(d); d.addEventListener('click', cliqueLegenda); return d }
  I.legenda = legenda
  panorama(I.panAtivo, { salvar: false })
  // sem produtores para enquadrar, o mapa abre no Brasil: voa até o RS
  if (map.getZoom() < 6) map.flyToBounds(I.camada.getBounds(), { paddingTopLeft: L.point(innerWidth > 900 && !document.getElementById('view-map').classList.contains('painel-fechado') ? 390 : 20, 20), duration: 1.6 })
  if (ler('val-geomap-tour') !== '1') setTimeout(() => { if (V.state.view === 'map' && document.getElementById('modal').hidden) tour(0) }, 1400)
}
const caixa = g => {
  let o = 180, s = 90, l = -180, n = -90
  const passar = c => { for (const [x, y] of c) { if (x < o) o = x; if (x > l) l = x; if (y < s) s = y; if (y > n) n = y } }
  if (g.type === 'Polygon') g.coordinates.forEach(passar); else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => p.forEach(passar))
  return [o, s, l, n]
}
function anel(pt, r) { let d = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) d = !d } return d }
function municipioNoPonto(lat, lng) {
  for (const f of I.feicoes) {
    const [o, s, l, n] = f.bbox; if (lng < o || lng > l || lat < s || lat > n) continue
    const g = f.feature.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    if (polys.some(p => anel([lng, lat], p[0]) && !p.slice(1).some(h => anel([lng, lat], h)))) return f
  }
  return null
}
// produtores do VAL por município (recalculado a cada desenho: o cadastro muda)
function carteira() {
  const m = new Map()
  for (const p of V.state.data?.producers || []) { if (p.uf && p.uf !== 'RS') continue; const k = norm(p.municipality); m.set(k, (m.get(k) || 0) + 1) }
  return m
}
function dadosMunicipio(code) {
  const d = I.porCodigo.get(code), f = I.feiPorCod.get(code)
  if (!f) return null
  return { ...(d || {}), municipio: d?.municipio || f.name, produtoresVal: I.cart?.get(f.slug) || 0 }
}
function quebras() {
  const met = METRICAS[I.metrica]
  const vals = I.feicoes.map(f => met.valor(dadosMunicipio(f.code))).filter(v => v > 0).sort((a, b) => a - b)
  if (!vals.length) return []
  const q = p => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]
  return [...new Set([q(.2), q(.4), q(.6), q(.8)])]
}
function classe(v) { if (!(v > 0)) return -1; let i = 0; while (i < I.quebras.length && v > I.quebras[i]) i++; return Math.min(i, METRICAS[I.metrica].rampa.length - 1) }
function opacidade() { const z = V.state.map.getZoom(); return z <= 7 ? .72 : z <= 8 ? .64 : z <= 9 ? .52 : z <= 10 ? .34 : .06 }
function estiloPan(f) {
  const d = dadosMunicipio(f.properties.code), c = classe(METRICAS[I.metrica].valor(d)), z = V.state.map.getZoom()
  return { color: z >= 11 ? '#071b19' : '#ffffff', weight: z >= 11 ? 1.2 : .8, opacity: z >= 11 ? .35 : .85, fillColor: c < 0 ? SEM_DADO : METRICAS[I.metrica].rampa[c], fillOpacity: c < 0 ? opacidade() * .3 : opacidade() }
}
function dicaMunicipio(p) {
  const d = dadosMunicipio(p.code), met = METRICAS[I.metrica], v = met.valor(d)
  return `<b>${esc(p.name)}</b><span class="im-tip-v">${esc(met.rotulo)}: <b>${v > 0 ? esc(met.texto(v)) : 'sem dado'}</b></span>${d?.car ? `<span>${fmt(d.car)} imóveis no CAR · ${fmt(d.criticos)} com alerta crítico</span>` : ''}${d?.produtoresVal ? `<span>${fmt(d.produtoresVal)} produtor${d.produtoresVal === 1 ? '' : 'es'} do VAL</span>` : ''}<small>Clique para abrir a ficha</small>`
}
function panorama(on, { salvar = true } = {}) {
  const map = V.state.map
  I.panAtivo = on
  map.getContainer().classList.toggle('im-com-panorama', on)
  if (salvar) guardar('val-geomap-panorama', on ? '1' : '0')
  if (!I.camada) { desenharCamadas(); return }
  if (on) { pintar(); I.camada.addTo(map); I.legenda.addTo(map); desenharLegenda() } else { map.removeLayer(I.camada); I.legenda.remove() }
  desenharCamadas()
}
function pintar() { I.cart = carteira(); I.quebras = quebras(); I.camada?.setStyle(estiloPan) }
// legenda: escala em faixa (cada cor com o intervalo no título); recolhe sozinha de perto (zoom 11+), onde o panorama some
function desenharLegenda() {
  const d = document.querySelector('.im-pan-leg'); if (!d) return
  const met = METRICAS[I.metrica], q = I.quebras
  const cores = met.rampa.slice(0, q.length + 1)
  const faixa = cores.map((cor, i) => {
    const txt = i === 0 ? `até ${met.texto(q[0] ?? 0)}` : i === q.length ? `acima de ${met.texto(q[i - 1])}` : `${met.texto(q[i - 1])} a ${met.texto(q[i])}`
    return `<i style="background:${cor}" title="${esc(txt)}"></i>`
  }).join('')
  const n = I.feicoes.filter(f => met.valor(dadosMunicipio(f.code)) > 0).length
  const recolhida = I.legRecolhida ?? (V.state.map.getZoom() >= 11 || I.fichaAberta || innerWidth <= 900)
  d.classList.toggle('recolhida', recolhida)
  d.innerHTML = `<div class="im-pan-cab"><button type="button" class="im-pan-titulo" data-pan-recolher aria-expanded="${!recolhida}" title="${recolhida ? 'Abrir a legenda' : 'Recolher a legenda'}"><b>Panorama do RS</b>${recolhida ? `<span>· ${esc(met.rotulo)}</span>` : ''}<svg class="geo-svg im-seta" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><button type="button" data-pan-fechar title="Desligar o panorama (E)" aria-label="Desligar o panorama">${ICO.fechar}</button></div>
    ${recolhida ? '' : `<div class="im-metricas" role="tablist" aria-label="Indicador do panorama">${Object.entries(METRICAS).map(([k, m]) => `<button type="button" role="tab" data-metrica="${k}" aria-selected="${k === I.metrica}">${m.rotulo}</button>`).join('')}</div>
    <p class="im-pan-tit">${esc(met.titulo)}</p>
    <div class="im-escala" style="--n:${cores.length}">${faixa}</div>
    <div class="im-escala-rot" style="--n:${cores.length}">${q.map(v => `<span>${esc(met.curto(v))}</span>`).join('')}</div>
    <div class="im-pan-rodape"><span class="im-faixa"><i style="background:${SEM_DADO};opacity:.45"></i>sem dado</span><small>${fmt(n)} de ${fmt(I.feicoes.length)} municípios · ${esc(met.fonte)}</small></div>`}`
}
function cliqueLegenda(e) {
  if (e.target.closest('[data-pan-fechar]')) return panorama(false)
  if (e.target.closest('[data-pan-recolher]')) { I.legRecolhida = !(I.legRecolhida ?? (V.state.map.getZoom() >= 11 || I.fichaAberta || innerWidth <= 900)); return desenharLegenda() }
  const b = e.target.closest('[data-metrica]')
  if (b) { I.metrica = b.dataset.metrica; guardar('val-geomap-metrica', I.metrica); pintar(); desenharLegenda() }
}
// voa até o município; com ficha, abre na hora o painel da direita (que carrega enquanto o mapa voa)
const painelFechado = () => document.getElementById('view-map').classList.contains('painel-fechado')
function voarMunicipio(code, { ficha = false } = {}) {
  const map = V.state.map, layer = I.porCamada.get(code); if (!layer) return
  if (ficha) abrirFichaMun(code)
  const b = layer.getBounds(), largo = innerWidth > 900
  const pTL = L.point(largo && !painelFechado() ? 400 : 24, largo ? 84 : 70)
  const pBR = L.point(largo && ficha ? 470 : 24, !largo && ficha ? Math.round(innerHeight * 0.58) : 24)
  const alvoZoom = Math.min(10, map.getBoundsZoom(b, false, pTL.add(pBR)))
  const px = map.latLngToContainerPoint(b.getCenter()), tam = map.getSize()
  const dentro = px.x > pTL.x && px.x < tam.x - pBR.x && px.y > pTL.y && px.y < tam.y - pBR.y
  if (dentro && Math.abs(map.getZoom() - alvoZoom) <= 1) return   // já está à vista: não mexe no mapa
  map.flyToBounds(b, { paddingTopLeft: pTL, paddingBottomRight: pBR, maxZoom: 10, duration: 1.1 })
}
// um ponto dentro do município (o centro da caixa pode cair fora em município de forma irregular)
function pontoDentro(code) {
  const f = I.feiPorCod.get(code); if (!f) return null
  const [o, s, l, n] = f.bbox, c = [(o + l) / 2, (s + n) / 2]
  if (municipioNoPonto(c[1], c[0])?.code === code) return L.latLng(c[1], c[0])
  for (let k = 1; k <= 6; k++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = c[0] + dx * (l - o) * k / 14, y = c[1] + dy * (n - s) * k / 14; if (municipioNoPonto(y, x)?.code === code) return L.latLng(y, x) }
  return null
}
// ---------------------------------------------------------------------------------------------
// Ficha do município: painel à direita (gaveta de baixo no celular) que carrega por partes.
// A parte local (hectares, porte, socioambiental) responde na hora; culturas, chuva e relevo vêm de fora.
// ---------------------------------------------------------------------------------------------
const SECOES = [
  { id: 'hectares', rotulo: 'Hectares', titulo: 'Hectares e imóveis' },
  { id: 'produtores', rotulo: 'Produtores', titulo: 'Produtores e empresas da base' },
  { id: 'culturas', rotulo: 'Culturas', titulo: 'Culturas na última safra do IBGE' },
  { id: 'credito', rotulo: 'Crédito', titulo: 'Crédito rural e garantias' },
  { id: 'terra', rotulo: 'Valor da terra', titulo: 'Valor da terra nua' },
  { id: 'armazenagem', rotulo: 'Armazéns e logística', titulo: 'Armazenagem e logística' },
  { id: 'estrutura', rotulo: 'Estrutura e pecuária', titulo: 'Estrutura produtiva e pecuária' },
  { id: 'chuva', rotulo: 'Chuva', titulo: 'Chuva nos últimos meses' },
  { id: 'relevo', rotulo: 'Relevo', titulo: 'Relevo' },
  { id: 'ambiental', rotulo: 'Socioambiental', titulo: 'Socioambiental dos imóveis do CAR' },
  { id: 'embargos', rotulo: 'Embargos', titulo: 'Áreas embargadas no município' }
]
const PARTES = { '': ['hectares', 'produtores', 'terra', 'armazenagem', 'estrutura', 'ambiental'], culturas: ['culturas'], credito: ['credito'], chuva: ['chuva'], relevo: ['relevo'], embargos: ['embargos'] }
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotMes = k => { const [a, m] = String(k).split('-'); return `${MESES[Number(m) - 1]}/${a.slice(2)}` }
const pct = (v, d = 0) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, d)}%`)
const dataBr = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '')
const produtoresDe = nome => (V.state.data?.producers || []).filter(p => (!p.uf || p.uf === 'RS') && norm(p.municipality) === norm(nome))

function gavetaMun() {
  let el = document.getElementById('im-fm')
  if (el) return el
  el = document.createElement('aside')
  el.id = 'im-fm'; el.className = 'im-fm'; el.hidden = true; el.tabIndex = -1
  el.setAttribute('aria-label', 'Ficha do município')
  document.getElementById('view-map').append(el)
  L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el)
  el.addEventListener('click', cliqueFichaMun)
  // o cartão do produtor e a ficha do município ocupam o mesmo lado da tela: um fecha o outro
  const det = document.getElementById('detail')
  if (det) new MutationObserver(() => { if (!det.hidden) fecharFichaMun() }).observe(det, { attributes: true, attributeFilter: ['hidden'] })
  return el
}
function abrirFichaMun(code) {
  I.cart ||= carteira()
  const d = dadosMunicipio(code); if (!d) return
  const el = gavetaMun(), seq = (I.fmSeq = (I.fmSeq || 0) + 1)
  I.fmCod = code
  const det = document.getElementById('detail'); if (det && !det.hidden) det.hidden = true
  window.valPesquisa?.fecharIA()
  V.state.map.closePopup(); fecharMenu()
  el.innerHTML = htmlTopoMun(d)
  el.hidden = false; el.scrollTop = 0
  document.getElementById('view-map').classList.add('com-ficha')
  realcarMunicipio(code)
  for (const parte of Object.keys(PARTES)) carregarParteMun(code, parte, seq)
}
function fecharFichaMun() {
  const el = document.getElementById('im-fm'); if (!el || el.hidden) return
  el.hidden = true; I.fmCod = null; I.fmSeq = (I.fmSeq || 0) + 1
  document.getElementById('view-map').classList.remove('com-ficha')
  I.realce?.remove(); I.realce = null
}
// contorno do município escolhido, por cima do panorama
function realcarMunicipio(code) {
  I.realce?.remove()
  const f = I.feiPorCod.get(code); if (!f) return
  I.realce = L.geoJSON(f.feature, { interactive: false, style: { color: '#c8f25e', weight: 3.5, opacity: 1, fill: false } }).addTo(V.state.map)
}
const esqueleto = () => '<div class="im-fm-esq" aria-hidden="true"><i></i><i></i><i></i></div><span class="im-fm-carregando">Carregando…</span>'
function htmlTopoMun(d) {
  const prods = produtoresDe(d.municipio), pctCrit = d.car ? d.criticos / d.car * 100 : 0
  return `
    <header class="im-fm-topo">
      <div><span>Município · RS · IBGE ${esc(d.codigoIbge || '')}</span><h2>${esc(d.municipio)}</h2></div>
      <button type="button" class="im-fm-x" data-fm-fechar title="Fechar (Esc)" aria-label="Fechar a ficha do município">${ICO.fechar}</button>
    </header>
    <nav class="im-fm-nav" aria-label="Seções da ficha">${SECOES.map(s => `<button type="button" data-fm-ir="${s.id}">${s.rotulo}</button>`).join('')}</nav>
    <div class="im-fm-kpis">
      <div><span>Potencial ano bom</span><b>${d.potencialAnoBomT ? abrev(d.potencialAnoBomT) : '—'}</b><small>${d.potencialMediaT ? `média com secas: ${abrev(d.potencialMediaT)}` : 'IBGE PAM'}</small></div>
      <div><span>Lavoura de verão</span><b>${d.lavouraVeraoHa ? `${fmt(d.lavouraVeraoHa)} ha` : '—'}</b><small>soja + milho (IBGE)</small></div>
      <div><span>Imóveis</span><b>${fmt(d.car)} no CAR</b><small>${fmt(d.sigef)} parcelas SIGEF${d.moduloFiscalHa ? ` · MF ${fmt(d.moduloFiscalHa)} ha` : ''}</small></div>
      <div class="${d.criticos ? 'risco' : ''}"><span>Alerta crítico</span><b>${fmt(d.criticos)}</b><small>${d.car ? `${fmt(pctCrit, pctCrit < 10 ? 1 : 0)}% dos imóveis do CAR` : '—'}${d.atencao ? ` · ${fmt(d.atencao)} em atenção` : ''}</small></div>
    </div>
    <div class="im-fm-cart"><b>Carteira do VAL</b>${prods.length ? `<span>${prods.slice(0, 6).map(p => `<a href="#" data-detail="${esc(p.id)}">${esc(p.name)}</a>`).join(', ')}${prods.length > 6 ? ` e mais ${prods.length - 6}` : ''}</span>` : '<span>Nenhum produtor cadastrado aqui.</span>'}${d.imoveisVinculados ? `<small>${fmt(d.imoveisVinculados)} imóve${d.imoveisVinculados === 1 ? 'l vinculado' : 'is vinculados'}</small>` : ''}</div>
    <div class="gf-acoes">
      <button type="button" class="btn small primary" data-m-imoveis>Ver imóveis no mapa</button>
      <button type="button" class="btn small" data-m-nomes>Buscar nomes aqui</button>
      <button type="button" class="btn small ghost" data-m-rel>Relatório</button>
    </div>
    ${SECOES.map(s => `<section class="im-fm-sec" id="fm-${s.id}" aria-busy="true"><h3>${s.titulo}</h3><div class="im-fm-corpo" data-fm-corpo="${s.id}">${esqueleto()}</div></section>`).join('')}`
}
async function carregarParteMun(code, parte, seq) {
  const alvos = PARTES[parte]
  const pintar = (id, html) => { const c = document.querySelector(`[data-fm-corpo="${id}"]`); if (!c) return; c.innerHTML = html; c.parentElement.setAttribute('aria-busy', 'false') }
  alvos.forEach(id => { const c = document.querySelector(`[data-fm-corpo="${id}"]`); if (c) { c.innerHTML = esqueleto(); c.parentElement.setAttribute('aria-busy', 'true') } })
  try {
    const r = await V.api(`/api/geo/municipio/${encodeURIComponent(code)}${parte ? `/${parte}` : ''}`)
    if (I.fmSeq !== seq) return
    if (!parte) { pintar('hectares', htmlHectares(r)); pintar('produtores', htmlProdutoresMun(r)); pintar('terra', htmlTerra(r)); pintar('armazenagem', htmlArmazenagem(r)); pintar('estrutura', htmlEstrutura(r)); pintar('ambiental', htmlAmbiental(r)) } else pintar(parte, RENDER[parte](r))
  } catch (e) {
    if (I.fmSeq !== seq) return
    alvos.forEach(id => pintar(id, `<div class="im-fm-erro"><span>${esc(e.message || 'Não foi possível carregar agora.')}</span><button type="button" class="btn small" data-fm-repetir="${parte || 'local'}">Tentar de novo</button></div>`))
  }
}
function cliqueFichaMun(e) {
  const code = I.fmCod, d = code && dadosMunicipio(code), map = V.state.map
  if (e.target.closest('[data-fm-fechar]')) return fecharFichaMun()
  const ir = e.target.closest('[data-fm-ir]')
  if (ir) { document.getElementById(`fm-${ir.dataset.fmIr}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
  const rep = e.target.closest('[data-fm-repetir]')
  if (rep) return carregarParteMun(code, rep.dataset.fmRepetir === 'local' ? '' : rep.dataset.fmRepetir, I.fmSeq)
  if (!d) return
  if (e.target.closest('[data-m-prospectos]')) { window.valPesquisa?.mostrarMunicipio(code); if (innerWidth <= 900) fecharFichaMun(); return }
  const emp = e.target.closest('[data-m-empresa]')
  if (emp) return window.valPesquisa?.abrirEmpresa(emp.dataset.mEmpresa)
  if (e.target.closest('[data-m-rel]')) return window.open(`/relatorio.html?municipio=${encodeURIComponent(d.municipio)}`, '_blank', 'noopener')
  if (e.target.closest('[data-m-imoveis]')) {
    window.valGeo.ligarCamada(true)
    const p = pontoDentro(code) || I.porCamada.get(code)?.getBounds().getCenter()
    if (p) map.flyTo(p, Math.max(12, map.getZoom()), { duration: 1.1 })
    if (innerWidth <= 900) fecharFichaMun()
    return
  }
  if (e.target.closest('[data-m-nomes]')) {
    const sel = document.getElementById('geo-mun'); if (sel && [...sel.options].some(o => o.value === d.municipio)) sel.value = d.municipio
    window.dispatchEvent(new CustomEvent('geo:painel', { detail: { abrir: true, alvo: 'geo-block' } }))
    if (innerWidth <= 900) fecharFichaMun()
    setTimeout(() => document.getElementById('geo-q')?.focus(), 380)
  }
}

// --- seções -----------------------------------------------------------------------------------
function htmlProdutoresMun(r) {
  const pb = r.produtoresBase, em = r.empresas
  if (!pb && !em) return '<p class="im-fm-vazio">Produtores e empresas ainda não carregados nesta base.</p>'
  const real = v => (v >= 1e6 ? `R$ ${fmt(v / 1e6, 1)} mi` : v >= 1e3 ? `R$ ${fmt(v / 1e3, 0)} mil` : `R$ ${fmt(v)}`)
  return `
    ${pb ? `<div class="im-fm-kpis">
      <div><span>Produtores da base</span><b>${fmt(pb.total)}</b><small>${fmt(pb.comPin)} com pin no mapa</small></div>
      <div><span>Pessoas · empresas</span><b>${fmt(pb.pessoas)} · ${fmt(pb.empresas)}</b><small>${fmt(pb.comArmazem)} com armazém próprio</small></div>
    </div>
    <div class="gf-acoes"><button type="button" class="btn small primary" data-m-prospectos>Mostrar os produtores no mapa</button></div>` : ''}
    ${em ? `<div class="im-fm-sub"><b>${fmt(em.total)} empresas do agro com CNPJ ativo</b><small>${fmt(em.produtoras)} produtoras · ${fmt(em.cooperativas)} cooperativas</small></div>
    ${em.porGrupo.length ? `<div class="im-fm-barras">${em.porGrupo.slice(0, 6).map(g => `<div><span>${esc(g.rotulo)}</span><i style="width:${Math.max(3, g.empresas / em.porGrupo[0].empresas * 100)}%"></i><b>${fmt(g.empresas)}</b></div>`).join('')}</div>` : ''}
    ${em.maiores.length ? `<div class="im-fm-rolar"><table class="im-fm-tab"><thead><tr><th>Maiores pelo capital</th><th>Atividade</th><th>Capital</th></tr></thead><tbody>${em.maiores.slice(0, 8).map(e => `<tr><td><a href="#" data-m-empresa="${esc(e.id)}">${esc(e.nomeFantasia || e.razaoSocial)}</a></td><td>${esc(e.grupoRotulo.split(' (')[0])}</td><td>${e.capitalSocial ? real(e.capitalSocial) : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${fonteFm(esc(em.fonte))}` : ''}
    ${fonteFm('Nomes de cadastros públicos (SIGEF, CONAB, CNPJ). O CAR não publica o dono: confirme pela matrícula ou com o produtor.')}`
}
const linhaFm = (rotulo, valor, sub = '') => `<div class="im-fm-linha"><span>${rotulo}${sub ? `<small>${sub}</small>` : ''}</span><b>${valor}</b></div>`
const fonteFm = txt => `<p class="im-fm-fonte">${txt}</p>`
const PORTES = [
  { k: 'minifundio', rotulo: 'Minifúndio', sub: 'menos de 1 MF', cor: '#cfe9dc' }, { k: 'pequeno', rotulo: 'Pequeno', sub: '1 a 4 MF', cor: '#8fd0b2' },
  { k: 'medio', rotulo: 'Médio', sub: '4 a 15 MF', cor: '#3fae88' }, { k: 'grande', rotulo: 'Grande', sub: 'mais de 15 MF', cor: '#0e6b4f' }
]
function htmlHectares(r) {
  const t = r.territorio
  const portes = PORTES.map(p => ({ ...p, ...(r.portes?.[p.k] || { imoveis: 0, areaHa: 0 }) })), totHa = portes.reduce((s, p) => s + p.areaHa, 0)
  const barra = totHa ? `<div class="im-fm-pilha" role="img" aria-label="Área do CAR por porte">${portes.filter(p => p.areaHa > 0).map(p => `<i style="flex:${p.areaHa};background:${p.cor}" title="${esc(`${p.rotulo}: ${fmt(p.areaHa)} ha (${fmt(p.areaHa / totHa * 100, 0)}%)`)}"></i>`).join('')}</div>` : ''
  return `
    ${linhaFm('Área do município', t.areaMunicipioHa ? `${fmt(t.areaMunicipioHa)} ha` : '—', 'limite oficial do IBGE')}
    ${linhaFm('Cadastrada no CAR', `${fmt(t.areaCarHa)} ha`, `${fmt(t.imoveisCar)} imóveis${t.carSobreMunicipioPct != null ? ` · ${fmt(t.carSobreMunicipioPct, 0)}% da área do município${t.carSobreMunicipioPct > 100 ? ' (há cadastros sobrepostos)' : ''}` : ''}`)}
    ${linhaFm('Área consolidada declarada', `${fmt(t.areaConsolidadaHa)} ha`, 'uso agropecuário anterior a 22/07/2008, declarado no CAR')}
    ${linhaFm('Lavoura estimada nos imóveis', `${fmt(t.lavouraEstimadaHa)} ha`, `calibrada pela lavoura de verão do IBGE (${fmt(t.lavouraVeraoIbgeHa)} ha)`)}
    ${linhaFm('Certificada no SIGEF (INCRA)', `${fmt(t.areaSigefHa)} ha`, `${fmt(t.parcelasSigef)} parcelas`)}
    ${t.assentamentos ? linhaFm('Assentamentos no CAR', fmt(t.assentamentos), 'cadastros do tipo AST') : ''}
    ${totHa ? `<h4>Porte dos imóveis do CAR${r.moduloFiscalHa ? ` · módulo fiscal de ${fmt(r.moduloFiscalHa)} ha` : ''}</h4>${barra}
      <div class="im-fm-tabela im-fm-portes">${portes.map(p => `<div><i style="background:${p.cor}"></i><span>${p.rotulo}<small>${p.sub}</small></span><b>${fmt(p.imoveis)}</b><b>${fmt(p.areaHa)} ha</b><b>${totHa ? fmt(p.areaHa / totHa * 100, 0) : 0}%</b></div>`).join('')}</div>` : ''}
    ${fonteFm('SICAR (CAR), INCRA (SIGEF) e IBGE. Porte pela Lei 8.629/93, em módulos fiscais (MF).')}`
}
const GRAOS_60 = /^(soja|milho|trigo|feij[aã]o|sorgo|cevada|aveia|triticale|canola|girassol)/i
function rendimento(c) {
  const kg = c.atual.rendimentoKgHa; if (!kg) return '—'
  if (GRAOS_60.test(c.cultura)) return `${fmt(kg / 60, 1)} sc/ha`
  if (/^arroz/i.test(c.cultura)) return `${fmt(kg / 50, 0)} sc/ha`   // arroz no RS: saca de 50 kg
  return `${fmt(kg)} kg/ha`
}
// produção na unidade escolhida: grãos de saca de 60 kg em sacas quando a tela está em sc
function producaoCel(c) {
  const p = c.atual.producao; if (!p) return '—'
  if (!/tonelada/i.test(c.unidade)) return `${fmt(p)} <small>${esc(c.unidade)}</small>`
  if (window.valUnidade?.get() === 'sc') return GRAOS_60.test(c.cultura) ? `${fmt(p / 0.06)} sc` : `${fmt(p)} t`
  return fmt(p)
}
function htmlCulturas(r) {
  if (!r.itens?.length) return `<p class="im-fm-vazio">O IBGE não registra lavouras neste município.</p>${fonteFm(esc(r.fonte || 'IBGE PAM'))}`
  const linha = c => `<tr><th scope="row">${esc(c.cultura)}</th><td>${fmt(c.atual.areaPlantadaHa)}</td><td>${producaoCel(c)}</td><td>${rendimento(c)}</td><td class="${c.variacao.rendimentoPct < 0 ? 'neg' : c.variacao.rendimentoPct > 0 ? 'pos' : ''}">${pct(c.variacao.rendimentoPct)}</td><td>${c.atual.valorMilReais ? fmt(c.atual.valorMilReais / 1000, 1) : '—'}</td></tr>`
  const cab = `<thead><tr><th scope="col">Cultura</th><th scope="col">Área (ha)</th><th scope="col">Produção${window.valUnidade?.get() === 'sc' ? '' : ' (t)'}</th><th scope="col">Rendimento</th><th scope="col" title="Rendimento comparado com ${r.anoAnterior}">vs ${r.anoAnterior || '—'}</th><th scope="col">R$ mi</th></tr></thead>`
  const prim = r.itens.slice(0, 7), resto = r.itens.slice(7)
  return `
    <p class="im-fm-lead">Safra <b>${r.ano}</b>: ${fmt(r.totais.areaPlantadaHa)} ha plantados, <b>R$ ${fmt(r.totais.valorMilReais / 1000, 0)} milhões</b> em produção.</p>
    <div class="im-fm-rolar"><table class="im-fm-tab">${cab}<tbody>${prim.map(linha).join('')}</tbody></table></div>
    ${resto.length ? `<details class="im-fm-mais"><summary>Ver as outras ${resto.length} culturas</summary><div class="im-fm-rolar"><table class="im-fm-tab">${cab}<tbody>${resto.map(linha).join('')}</tbody></table></div></details>` : ''}
    ${fonteFm(`${esc(r.fonte)}. Ano ${r.ano}, o mais recente publicado; variação do rendimento contra ${r.anoAnterior}. Sacas de 60 kg (arroz: 50 kg).`)}`
}
function htmlAmbiental(r) {
  const s = r.socioambiental, em = s.embargos
  const lista = (itens, f) => (itens.length ? `<ul class="im-fm-lista">${itens.map(f).join('')}</ul>` : '')
  const anos = s.supressao.porAno.filter(x => x.ano >= 2009).sort((a, b) => a.ano - b.ano)
  const maxHa = Math.max(1, ...anos.map(x => x.ha))
  const barrasAno = anos.length ? `<div class="im-fm-anos" role="img" aria-label="Supressão de vegetação nativa por ano, em hectares">${anos.map(x => `<div title="${esc(`${x.ano}: ${fmt(x.ha, 1)} ha em ${fmt(x.imoveis)} imóve${x.imoveis === 1 ? 'l' : 'is'}`)}" class="${x.ano >= 2021 ? 'eudr' : ''}"><i style="height:${Math.max(4, x.ha / maxHa * 100)}%"></i><small>${String(x.ano).slice(2)}</small></div>`).join('')}</div>` : ''
  const sit = r.situacaoCar.slice(0, 5), totCar = r.situacaoCar.reduce((a, x) => a + x.imoveis, 0)
  return `
    <div class="im-fm-kpis dois">
      <div class="${s.imoveisCritico ? 'risco' : ''}"><span>Alerta crítico</span><b>${fmt(s.imoveisCritico)}</b><small>imóveis do CAR</small></div>
      <div class="${s.imoveisAtencao ? 'atencao' : ''}"><span>Em atenção</span><b>${fmt(s.imoveisAtencao)}</b><small>imóveis do CAR</small></div>
    </div>
    <h4>Áreas embargadas</h4>
    ${em.ativos + em.desembargados ? `<p class="im-fm-lead"><b>${fmt(em.ativos)}</b> embargo${em.ativos === 1 ? '' : 's'} em vigor e ${fmt(em.desembargados)} já desembargado${em.desembargados === 1 ? '' : 's'}, sobre ${fmt(em.imoveis)} imóve${em.imoveis === 1 ? 'l' : 'is'} do CAR (${fmt(em.haNosImoveis, 1)} ha dentro deles).</p>
      ${lista(em.lista.slice(0, 8), x => `<li><span class="badge ${x.desembargado ? '' : 'risco-critico'}">${x.desembargado ? 'desembargado' : 'em vigor'}</span><span>${esc(x.orgao)} nº ${esc(x.numero)}${x.data ? ` · ${dataBr(x.data)}` : ''}${x.situacao ? ` · ${esc(x.situacao.toLowerCase())}` : ''}</span><b>${fmt(x.haNosImoveis, 1)} ha</b></li>`)}
      ${em.lista.length > 8 ? `<p class="im-fm-nota">E mais ${em.lista.length - 8}. A lista completa está no relatório do município.</p>` : ''}` : '<p class="im-fm-vazio">Nenhum embargo do IBAMA sobre imóveis do CAR deste município.</p>'}
    <h4>Supressão de vegetação nativa (PRODES)</h4>
    ${anos.length ? `<p class="im-fm-lead"><b>${fmt(s.supressao.depoisDe2020Ha, 1)} ha</b> depois de 2020 (corte do EUDR) e ${fmt(s.supressao.de2009a2020Ha, 1)} ha de 2009 a 2020, em ${fmt(s.supressao.imoveis)} imóve${s.supressao.imoveis === 1 ? 'l' : 'is'}.</p>${barrasAno}<p class="im-fm-legenda"><i class="eudr"></i>depois de 2020 <i></i>2009 a 2020</p>` : '<p class="im-fm-vazio">Nenhuma supressão mapeada pelo PRODES dentro dos imóveis do CAR.</p>'}
    ${s.terrasIndigenas.lista.length || s.unidadesConservacao.lista.length ? `<h4>Terras indígenas e unidades de conservação</h4>
      ${lista(s.terrasIndigenas.lista, x => `<li><span class="badge risco-critico">TI</span><span>${esc(x.nome)}${x.fase ? ` · ${esc(x.fase.toLowerCase())}` : ''}</span><b>${fmt(x.ha, 1)} ha</b></li>`)}
      ${lista(s.unidadesConservacao.lista, x => `<li><span class="badge ${String(x.grupo).toUpperCase() === 'PI' ? 'risco-critico' : 'risco-atencao'}">${String(x.grupo).toUpperCase() === 'PI' ? 'UC integral' : 'UC uso sust.'}</span><span>${esc(x.nome)}</span><b>${fmt(x.ha, 1)} ha</b></li>`)}` : ''}
    <h4>Situação do CAR</h4>
    <div class="im-fm-tabela im-fm-sit">${sit.map(x => `<div><span>${esc(x.situacao)}</span><b>${fmt(x.imoveis)}</b><b>${fmt(x.imoveis / totCar * 100, x.imoveis / totCar < 0.01 ? 1 : 0)}%</b></div>`).join('')}</div>
    ${fonteFm(`Áreas dentro de imóveis do CAR (cadastros sobrepostos podem contar duas vezes). ${esc((r.camadas?.fontes || []).join(' · '))}. Triagem automática: confirme nas listas oficiais no dia da negociação.`)}`
}
// --- terra, armazenagem e logística, estrutura e pecuária (dados embarcados: scripts/geo-estrutura.mjs) ---------
const tMil = t => (t >= 1e6 ? `${fmt(t / 1e6, 2)} mi t` : t >= 1e3 ? `${fmt(t / 1e3, 0)} mil t` : `${fmt(t)} t`)
function htmlTerra(r) {
  const v = r.estrutura?.vtn
  if (!v) return `<p class="im-fm-vazio">O município não informou o valor da terra nua à Receita Federal em 2025 nem em 2026.</p>${fonteFm(esc(r.fontesEstrutura?.vtn || 'Receita Federal, VTN'))}`
  const classes = [['Lavoura, aptidão boa', v.lavouraBoa], ['Lavoura, aptidão regular', v.lavouraRegular], ['Lavoura, aptidão restrita', v.lavouraRestrita], ['Pastagem plantada', v.pastagemPlantada], ['Silvicultura ou pastagem natural', v.silviculturaOuPastagemNatural], ['Preservação', v.preservacao]]
  const max = Math.max(1, ...classes.map(c => c[1] || 0))
  const lav = r.territorio?.lavouraEstimadaHa
  return `
    <div class="im-fm-kpis dois">
      <div><span>Lavoura boa</span><b>R$ ${fmt(v.lavouraBoa)}/ha</b><small>regular R$ ${fmt(v.lavouraRegular)} · restrita R$ ${fmt(v.lavouraRestrita)}</small></div>
      <div><span>Lavoura do município</span><b>${lav && v.lavouraBoa ? `R$ ${fmt(lav * v.lavouraBoa / 1e9, 1)} bi` : '—'}</b><small>${lav ? `${fmt(lav)} ha estimados × VTN de lavoura boa` : ''}</small></div>
    </div>
    <div class="im-fm-barras">${classes.map(([rot, val]) => `<div><span>${rot}</span><i style="width:${val ? Math.max(3, val / max * 100) : 0}%"></i><b>${val ? `R$ ${fmt(val)}` : 's/ informação'}</b></div>`).join('')}</div>
    ${fonteFm(`${esc(r.fontesEstrutura?.vtn || '')}. Valor de ${v.ano}, informado pelo ${esc(v.informadoPor || 'município')}. É a referência fiscal do ITR para a terra sem benfeitorias, não laudo de avaliação; serve de piso para conversar sobre garantia.`)}`
}
function htmlArmazenagem(r) {
  const a = r.estrutura?.armazens, c = r.estrutura?.censo, l = r.estrutura?.logistica, prod = r.producaoAnoBomT || 0
  const cap = a?.capacidadeT || 0, fazenda = c?.armazemFazendaT || 0
  const cobre = prod ? Math.round(cap / prod * 100) : null
  const donos = a ? [['Cooperativas', a.coop, '#1555b0'], ['Empresas privadas', a.priv, '#c2410c'], ['Oficiais (CONAB e outros)', a.ofic, '#5f6b66']].filter(x => x[1][0]) : []
  return `
    <div class="im-fm-kpis tres">
      <div><span>Armazéns (CONAB)</span><b>${a ? tMil(cap) : '—'}</b><small>${a ? `${fmt(a.unidades)} unidades · ${fmt(a.granelT / Math.max(cap, 1) * 100, 0)}% a granel` : 'nenhuma unidade cadastrada'}</small></div>
      <div class="${cobre != null && cobre < 60 ? 'atencao' : cobre >= 120 ? 'bom' : ''}"><span>Cabe da safra</span><b>${cobre != null ? `${fmt(cobre)}%` : '—'}</b><small>${prod ? `capacidade ÷ ${tMil(prod)} em ano bom` : 'sem produção de grãos no IBGE'}</small></div>
      <div><span>Nas fazendas</span><b>${fazenda ? tMil(fazenda) : '—'}</b><small>${c?.comArmazem ? `${fmt(c.comArmazem)} estabelecimentos (Censo 2017)` : 'Censo Agro 2017'}</small></div>
    </div>
    ${cobre != null ? `<p class="im-fm-lead">${cobre < 60 ? 'Pouco armazém para a safra do município: o produtor precisa vender ou levar o grão para fora logo na colheita.' : cobre < 100 ? 'O armazém do município não cabe a safra inteira de um ano bom.' : 'O município tem armazém para a safra inteira de um ano bom: a venda pode esperar o preço.'}</p>` : ''}
    ${donos.length ? `<div class="im-fm-tabela im-fm-donos">${donos.map(([rot, [n, t], cor]) => `<div><i style="background:${cor}"></i><span>${rot}</span><b>${fmt(n)}</b><b>${tMil(t)}</b></div>`).join('')}${a.pessoaFisica[0] ? `<div><i style="background:#9aa8a3"></i><span>Produtores (pessoa física)<small>já incluídos acima, sem ponto no mapa</small></span><b>${fmt(a.pessoaFisica[0])}</b><b>${tMil(a.pessoaFisica[1])}</b></div>` : ''}</div>` : ''}
    ${l ? `<h4>Logística (linha reta)</h4>
      ${linhaFm('Porto de Rio Grande', `${fmt(l.kmPortoRioGrande)} km`, 'exportação de grãos')}
      ${l.portoMaisProximo !== 'Rio Grande' ? linhaFm(`Porto ou terminal mais perto: ${esc(l.portoMaisProximo)}`, `${fmt(l.kmPortoMaisProximo)} km`, 'hidrovia') : ''}
      ${l.kmTrilho != null ? linhaFm('Trilho mais próximo', `${fmt(l.kmTrilho, l.kmTrilho < 10 ? 1 : 0)} km`, 'malha da Rumo; nem todo trecho está em operação') : ''}` : ''}
    ${fonteFm(`${esc(r.fontesEstrutura?.armazens || 'CONAB')}. ${esc(r.fontesEstrutura?.logistica || '')} Ligue a camada Armazéns no mapa para ver as unidades de empresas e cooperativas.`)}`
}
function htmlEstrutura(r) {
  const c = r.estrutura?.censo, p = r.estrutura?.pecuaria
  if (!c && !p) return '<p class="im-fm-vazio">Sem dados do IBGE para este município.</p>'
  const pct = (a, b) => (a != null && b ? ` (${fmt(a / b * 100, 0)}%)` : '')
  return `
    ${c ? `<h4>Censo Agropecuário 2017</h4>
      ${linhaFm('Estabelecimentos', fmt(c.estab), `${fmt(c.estabFamiliar)} da agricultura familiar${pct(c.estabFamiliar, c.estab)}`)}
      ${linhaFm('Área dos estabelecimentos', `${fmt(c.areaHa)} ha`, `${fmt(c.areaFamiliarHa)} ha da agricultura familiar${pct(c.areaFamiliarHa, c.areaHa)}`)}
      ${linhaFm('Tratores', fmt(c.tratores), `${fmt(c.tratores100cv)} de 100 cv ou mais · em ${fmt(c.comTratores)} estabelecimentos`)}
      ${linhaFm('Irrigação', c.areaIrrigadaHa ? `${fmt(c.areaIrrigadaHa)} ha` : '—', `${fmt(c.irrigados)} estabelecimentos irrigam`)}
      ${linhaFm('Obtiveram financiamento', fmt(c.financiados), [c.finBancos && `${fmt(c.finBancos)} com bancos`, c.finCooperativas && `${fmt(c.finCooperativas)} com cooperativas de crédito`, c.finComerciantes && `${fmt(c.finComerciantes)} com comerciantes de grão`, c.finFornecedores && `${fmt(c.finFornecedores)} com fornecedores de insumo`].filter(Boolean).join(' · ') || 'no ano do censo')}` : ''}
    ${p ? `<h4>Pecuária ${p.ano || ''}</h4>
      <div class="im-fm-kpis tres">
        <div><span>Bovinos</span><b>${fmt(p.bovinos)}</b><small>cabeças</small></div>
        <div><span>Leite</span><b>${p.leiteMilLitros ? `${fmt(p.leiteMilLitros / 1000, 1)} mi L` : '—'}</b><small>${fmt(p.vacasOrdenhadas)} vacas ordenhadas</small></div>
        <div><span>Suínos e aves</span><b>${fmt(p.suinos)}</b><small>suínos · ${fmt(p.galinaceos)} galináceos</small></div>
      </div>` : ''}
    ${fonteFm(`${esc(r.fontesEstrutura?.censo || '')}; ${esc(r.fontesEstrutura?.pecuaria || '')}.`)}`
}

const RENDER = { culturas: htmlCulturas, chuva: r => htmlChuva(r), relevo: r => htmlRelevo(r), credito: r => htmlCredito(r), embargos: r => htmlEmbargos(r) }
function htmlChuva(r) {
  const meses = r.meses || []
  const max = Math.max(1, ...meses.map(x => Math.max(x.mm || 0, x.normalMm || 0)))
  const janela = (rot, j) => (j ? `<div class="${j.desvioPct <= -25 ? 'seco' : j.desvioPct >= 25 ? 'umido' : ''}"><span>${rot}</span><b>${fmt(j.mm)} mm</b><small>${j.normalMm ? `normal ${fmt(j.normalMm)} mm · ${pct(j.desvioPct)}` : 'sem normal'}</small></div>` : '')
  const colunas = meses.map(x => {
    const t = `${rotMes(x.mes)}: ${x.mm == null ? 'sem dado' : `${fmt(x.mm)} mm${x.completo ? '' : ` até agora (${x.dias} de ${x.diasNoMes} dias)`}`}${x.normalMm ? ` · normal ${fmt(x.normalMm)} mm` : ''}${x.desvioPct != null ? ` (${pct(x.desvioPct)})` : ''}${x.maiorChuvaDiaMm ? ` · maior chuva num dia: ${fmt(x.maiorChuvaDiaMm)} mm` : ''}`
    return `<div class="im-fm-col ${x.completo ? '' : 'parcial'} ${x.desvioPct != null && x.desvioPct <= -40 ? 'seco' : ''}" title="${esc(t)}" tabindex="0" aria-label="${esc(t)}">
      <div class="im-fm-col-area"><i class="bar" style="height:${x.mm ? Math.max(2, x.mm / max * 100) : 0}%"></i>${x.normalMm ? `<i class="normal" style="bottom:${x.normalMm / max * 100}%"></i>` : ''}</div><small>${MESES[Number(x.mes.slice(5)) - 1]}</small></div>`
  }).join('')
  return `
    <div class="im-fm-kpis tres">${janela('Últimos 3 meses', r.ultimos3)}${janela('Últimos 6 meses', r.ultimos6)}${janela('Últimos 12 meses', r.ultimos12)}</div>
    <div class="im-fm-chuva" role="img" aria-label="Chuva mensal dos últimos 13 meses, em milímetros, com a normal de cada mês">${colunas}</div>
    <p class="im-fm-legenda"><i class="chuva"></i>chuva do mês <i class="normal"></i>normal do mês <i class="parcial"></i>mês em curso</p>
    ${fonteFm(`${esc(r.fonte || '')}${r.dadosAte ? ` Dados até ${dataBr(r.dadosAte)}.` : ''}`)}`
}
const COR_DECL = { plano: '#dcefe5', suave: '#a9d8be', ondulado: '#e9c98f', forte: '#c98a4b', montanhoso: '#8a4f24' }
function htmlRelevo(r) {
  if (!r?.altitude) return `<p class="im-fm-vazio">Sem dados de relevo para este município.</p>`
  const d = r.declividade, a = r.altitude
  return `
    <div class="im-fm-kpis tres">
      <div><span>Altitude média</span><b>${fmt(a.media)} m</b><small>de ${fmt(a.min)} a ${fmt(a.max)} m</small></div>
      <div><span>Desnível</span><b>${fmt(r.amplitudeM)} m</b><small>80% entre ${fmt(a.p10)} e ${fmt(a.p90)} m</small></div>
      ${d ? `<div class="${d.mecanizavelPct >= 70 ? 'bom' : d.mecanizavelPct < 40 ? 'atencao' : ''}"><span>Mecanizável</span><b>${fmt(d.mecanizavelPct, 0)}%</b><small>declividade até 12%</small></div>` : ''}
    </div>
    ${d ? `<h4>Declividade (classes da Embrapa)</h4>
      <div class="im-fm-pilha" role="img" aria-label="Distribuição da declividade">${d.classes.filter(c => c.pct > 0).map(c => `<i style="flex:${c.pct};background:${COR_DECL[c.classe]}" title="${esc(`${c.rotulo}: ${fmt(c.pct, 1)}%`)}"></i>`).join('')}</div>
      <div class="im-fm-tabela im-fm-decl">${d.classes.map((c, i) => `<div><i style="background:${COR_DECL[c.classe]}"></i><span>${c.rotulo}<small>${i === 0 ? 'até 3%' : c.ate ? `${CLASSES_LIM[i - 1]} a ${c.ate}%` : `acima de ${CLASSES_LIM[i - 1]}%`}</small></span><b>${fmt(c.pct, 0)}%</b></div>`).join('')}</div>` : ''}
    ${fonteFm(`${esc(r.fonte || '')} ${fmt(r.pontos)} pontos amostrados dentro do município; declividade medida entre cada ponto e dois vizinhos a ${fmt(r.distanciaM || 0)} m. É um retrato do município, não de um imóvel.`)}`
}
const CLASSES_LIM = [3, 8, 20, 45]
const GARANTIAS = 'Garantias como penhor, hipoteca, alienação fiduciária e CPR não são públicas por imóvel: ficam nos cartórios de registro de imóveis e nas registradoras de CPR (B3, CERC, CRDC). O custeio registrado no SICOR é o melhor sinal público de lavoura já comprometida com banco ou cooperativa de crédito, porque no custeio agrícola a garantia mais comum é o penhor da própria safra financiada. Não entram CPR, barter nem financiamento de revendas e tradings.'
const mi = v => `R$ ${fmt(v / 1e6, v >= 1e8 ? 0 : 1)} mi`
function htmlCredito(r) {
  const caixa = `<div class="im-fm-aviso"><b>E as garantias?</b><span>${GARANTIAS}</span></div>`
  if (!r.safras?.length) return `<p class="im-fm-vazio">Nenhum custeio rural registrado no SICOR para este município no período.</p>${caixa}${fonteFm(esc(r.fonte || ''))}`
  const kpis = r.safras.slice(0, 3).map(s => `<div class="${s.emCurso ? 'parcial' : ''}"><span>Safra ${s.safra}${s.emCurso ? ' · em curso' : ''}</span><b>${fmt(s.areaHa)} ha</b><small>${mi(s.valor)} em custeio${s.emCurso ? ` até ${rotMes(r.dadosAte)}` : ''}</small></div>`).join('')
  const alvo = r.safras.find(s => !s.emCurso) || r.safras[0]
  const ag = alvo.produtos.filter(p => p.agricola && p.areaHa > 0)
  const linha = p => `<tr><th scope="row">${esc(p.produto)}</th><td>${fmt(p.areaHa)}</td><td>${fmt(p.valor / 1e6, 1)}</td><td>${p.financiadaPct == null ? '—' : `${fmt(p.financiadaPct, 0)}%`}</td></tr>`
  const soja = ag.find(p => /^soja/i.test(p.produto))
  return `
    <div class="im-fm-kpis tres">${kpis}</div>
    ${soja?.financiadaPct != null ? `<p class="im-fm-lead">Na safra ${alvo.safra}, o custeio de soja registrado cobriu <b>${fmt(soja.financiadaPct, 0)}%</b> da área plantada de soja do IBGE (${fmt(soja.areaHa)} de ${fmt(soja.areaPlantadaIbgeHa)} ha).</p>` : ''}
    ${ag.length ? `<h4>Custeio agrícola na safra ${alvo.safra}</h4>
      <div class="im-fm-rolar"><table class="im-fm-tab"><thead><tr><th scope="col">Cultura</th><th scope="col">Área (ha)</th><th scope="col">R$ mi</th><th scope="col" title="Área financiada ÷ área plantada do IBGE na mesma safra">% da área</th></tr></thead><tbody>${ag.slice(0, 8).map(linha).join('')}</tbody></table></div>
      ${ag.length > 8 ? `<p class="im-fm-nota">E mais ${ag.length - 8} culturas.</p>` : ''}` : ''}
    ${alvo.valorPecuaria ? linhaFm('Custeio pecuário na mesma safra', mi(alvo.valorPecuaria), 'bovinos, leite, aves, suínos e outros') : ''}
    ${caixa}
    ${fonteFm(`${esc(r.fonte)}. Safra de julho a junho, pelo mês de emissão do contrato. Dados até ${rotMes(r.dadosAte)}.`)}`
}
function htmlEmbargos(r) {
  if (!r.total) return `<p class="im-fm-vazio">Nenhum embargo do IBAMA registrado neste município.</p>${fonteFm(esc(r.fonte))}`
  return `
    <p class="im-fm-lead"><b>${fmt(r.total)}</b> termo${r.total === 1 ? '' : 's'} de embargo do IBAMA no município, somando <b>${fmt(r.areaHa, 1)} ha</b>${r.ultimo ? `; o mais recente em ${dataBr(r.ultimo)}` : ''}${r.primeiro && r.total > 1 ? ` e o mais antigo em ${dataBr(r.primeiro)}` : ''}.</p>
    ${r.recentes.length ? `<h4>Mais recentes</h4><ul class="im-fm-lista">${r.recentes.slice(0, 8).map(x => `<li><span class="badge">${x.data ? x.data.slice(0, 4) : '—'}</span><span>Termo nº ${esc(x.numero || '—')}${x.data ? ` · ${dataBr(x.data)}` : ''}${x.bioma ? ` · ${esc(x.bioma)}` : ''}</span><b>${fmt(x.areaHa, 1)} ha</b></li>`).join('')}</ul>` : ''}
    ${fonteFm(`${esc(r.fonte)} Os que caem dentro de imóveis do CAR, com a situação (em vigor ou desembargado), estão em Socioambiental, acima. Confirme na consulta pública do IBAMA no dia da negociação.`)}`
}


// ---------------------------------------------------------------------------------------------
// Menu do clique direito (toque longo no celular)
// ---------------------------------------------------------------------------------------------
function abrirMenu(e) {
  fecharMenu()
  const map = V.state.map, { lat, lng } = e.latlng, f = I.feicoes.length ? municipioNoPonto(lat, lng) : null
  const m = L.DomUtil.create('div', 'im-menu', map.getContainer())
  m.setAttribute('role', 'menu')
  const itens = [
    ['aqui', ICO.terra, 'O que tem aqui?', 'Imóvel do CAR/SIGEF neste ponto'],
    f && ['mun', ICO.cidade, `Ficha de ${f.name}`, 'Potencial, imóveis, alertas e carteira'],
    ['rota', ICO.rota, 'Planejar rota daqui', 'Produtores num raio a partir do ponto'],
    ['novo', ICO.mais, 'Cadastrar produtor aqui', 'Com o ponto já marcado'],
    ['copiar', ICO.copiar, 'Copiar coordenadas', `${lat.toFixed(6)}, ${lng.toFixed(6)}`],
    ['google', ICO.externo, 'Abrir no Google Maps', 'Para traçar o caminho até o ponto']
  ].filter(Boolean)
  m.innerHTML = itens.map(([id, ico, t, s]) => `<button type="button" role="menuitem" data-menu="${id}"><span class="im-sug-ico">${ico}</span><span class="im-sug-txt"><b>${esc(t)}</b><small>${esc(s)}</small></span></button>`).join('')
  const p = e.containerPoint, tam = map.getSize()
  m.style.left = `${Math.min(p.x, tam.x - 280)}px`; m.style.top = `${Math.min(p.y, tam.y - (itens.length * 52 + 16))}px`
  L.DomEvent.disableClickPropagation(m); L.DomEvent.disableScrollPropagation(m)
  L.DomEvent.on(m, 'contextmenu', L.DomEvent.preventDefault)
  m.addEventListener('click', ev => {
    const b = ev.target.closest('[data-menu]'); if (!b) return
    fecharMenu()
    const acao = b.dataset.menu
    if (acao === 'aqui') { pulso(e.latlng); return oQueTemAqui(e.latlng) }
    if (acao === 'mun') return voarMunicipio(f.code, { ficha: true })
    if (acao === 'rota') {
      const t = document.getElementById('plan-toggle')
      if (!t.checked) { t.checked = true; t.dispatchEvent(new Event('change')) }
      map.fire('click', { latlng: e.latlng, layerPoint: map.latLngToLayerPoint(e.latlng), containerPoint: e.containerPoint })
      painel(true); setTimeout(() => document.getElementById('plan-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 500)
      return
    }
    if (acao === 'novo') return V.openProducerForm({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), uf: 'RS', municipality: f?.name || '', locationPrecision: 'exact' })
    if (acao === 'copiar') { navigator.clipboard?.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`).then(() => V.toast('Coordenadas copiadas.'), () => V.toast(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)); return }
    if (acao === 'google') window.open(`https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`, '_blank', 'noopener')
  })
  I.menu = m
  m.querySelector('button')?.focus({ preventScroll: true })
}
function fecharMenu() { I.menu?.remove(); I.menu = null }
async function oQueTemAqui(latlng) {
  const map = V.state.map
  try {
    const r = await V.api(`/api/geo/ponto?lat=${latlng.lat.toFixed(6)}&lng=${latlng.lng.toFixed(6)}&raio=0.3`)
    if (!r.dentro.length) {
      const f = municipioNoPonto(latlng.lat, latlng.lng)
      L.popup({ className: 'geo-ficha-pop' }).setLatLng(latlng).setContent(`<div class="geo-ficha"><b class="gf-nome">Nenhum imóvel da base neste ponto</b><span class="gf-sub">${r.perto.length ? `${r.perto.length} imóve${r.perto.length === 1 ? 'l' : 'is'} a menos de 300 m. Ligue a camada Imóveis rurais para ver.` : 'Pode ser área urbana, estrada, rio ou imóvel ainda fora do CAR/SIGEF.'}${f ? ` · ${esc(f.name)}` : ''}</span></div>`).openOn(map)
      return
    }
    const [p, ...outros] = r.dentro
    window.valGeo.mostrarImovel(p, { latlng, outros, voar: false })
  } catch (e) { V.toast(e.message, true) }
}

// ---------------------------------------------------------------------------------------------
// Atalhos, ajuda e tour
// ---------------------------------------------------------------------------------------------
function atalhos(e) {
  if (V.state.view !== 'map' || e.defaultPrevented) return
  const alvo = e.target, digitando = alvo.closest?.('input, textarea, select, [contenteditable="true"]')
  if (e.key === 'Escape') {
    const aberto = I.menu || !document.getElementById('im-sug')?.hidden || document.querySelector('.im-camadas.aberto')
    fecharMenu(); fecharSug(); document.querySelector('.im-camadas')?.classList.remove('aberto')
    if (!aberto && !V.state.map._popup && window.valPesquisa?.iaAberta()) return window.valPesquisa.fecharIA()
    if (!aberto && !V.state.map._popup) fecharFichaMun()   // nada mais aberto: Esc fecha a ficha do município
    return
  }
  if (!document.getElementById('modal').hidden || document.querySelector('.im-tour, .im-ajuda')) return
  if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return focarBusca() }
  if (digitando || e.ctrlKey || e.metaKey || e.altKey) return
  const k = e.key.toLowerCase()
  if (e.key === '/') { e.preventDefault(); return focarBusca() }
  if (k === 'p') return painel(document.getElementById('view-map').classList.contains('painel-fechado'))
  if (k === 'e') return panorama(!I.panAtivo)
  if (k === 'a') return armazens(!I.armOn)
  if (k === 'r') return window.valPesquisa?.camada(!window.valPesquisa.ativo())
  if (k === 'q') { e.preventDefault(); return window.valPesquisa?.abrirIA() }
  if (k === 'i') { const on = !window.valGeo.G.ativo; window.valGeo.ligarCamada(on); if (on && V.state.map.getZoom() < 11) V.toast('Imóveis rurais aparecem a partir do zoom 11: aproxime o mapa.'); return }
  if (k === 's') return trocarBase(baseAtual().nome === 'Mapa' ? 'Satélite com nomes' : 'Mapa')
  if (e.key === '?') return ajuda()
}
function focarBusca() { const q = document.getElementById('im-q'); q.focus(); q.select() }
function ajuda() {
  if (document.querySelector('.im-ajuda')) return
  const d = document.createElement('div'); d.className = 'im-ajuda'
  const linha = (teclas, txt) => `<li><span>${teclas.map(t => `<kbd>${t}</kbd>`).join(' ')}</span>${txt}</li>`
  d.innerHTML = `<div class="im-ajuda-card" role="dialog" aria-modal="true" aria-labelledby="im-ajuda-t">
      <button type="button" class="im-ajuda-x" data-fechar aria-label="Fechar">${ICO.fechar}</button>
      <b id="im-ajuda-t">Como mexer no mapa</b>
      <ul>
        ${linha(['/'], 'Busca única: produtor, município, nome, matrícula ou coordenada')}
        ${linha(['Ctrl', 'K'], 'Também abre a busca')}
        ${linha(['P'], 'Mostra ou esconde o painel')}
        ${linha(['E'], 'Liga ou desliga o panorama do RS')}
        ${linha(['I'], 'Liga ou desliga os imóveis rurais (zoom 11+)')}
        ${linha(['A'], 'Liga ou desliga os armazéns da CONAB')}
        ${linha(['R'], 'Liga ou desliga os produtores da base (pins com filtros)')}
        ${linha(['Q'], 'VAL: pergunte em português sobre a base')}
        ${linha(['S'], 'Troca mapa e satélite')}
        ${linha(['Esc'], 'Fecha menus e fichas')}
        ${linha(['Clique direito'], 'Menu do ponto (no celular, segure o dedo)')}
        ${linha(['Ctrl', 'clique'], 'Seleciona vários imóveis de uma vez')}
      </ul>
      <div class="im-ajuda-acoes"><button type="button" class="btn small" data-tour>Rever o tour</button><button type="button" class="btn small primary" data-fechar>Entendi</button></div>
    </div>`
  const fechar = () => { d.remove(); document.removeEventListener('keydown', tecla, true) }
  const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); fechar() } }
  d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-fechar]')) return fechar()
    if (e.target.closest('[data-tour]')) { fechar(); if (V.state.view !== 'map') V.setView('map'); setTimeout(() => tour(0), 150) }
  })
  document.addEventListener('keydown', tecla, true)
  document.body.append(d)
  d.querySelector('[data-fechar].primary').focus()
}
const PASSOS = [
  { alvo: '.im-busca', titulo: 'Busca única', texto: 'Digite o nome de um produtor do VAL, um município, o nome que aparece no registro do imóvel, uma matrícula ou uma coordenada. O mapa voa até o resultado. Atalho: tecla /.' },
  { alvo: '#view-map .map-panel', titulo: 'Painel', texto: 'Filtros dos produtores, planejamento de rota e a busca de imóveis com seleção, soma do potencial e vínculo. Esconda com a tecla P para ter o mapa inteiro.', antes: () => painel(true) },
  { alvo: '.im-pan-leg', titulo: 'Panorama do RS', texto: 'Os 497 municípios pintados pelo potencial de grãos, pelos alertas socioambientais ou pela carteira do VAL. Clique num município para voar até ele e abrir a ficha.', antes: () => { if (innerWidth <= 900) painel(false, { salvar: false }); if (!I.panAtivo) panorama(true) } },
  { alvo: '.im-camadas', titulo: 'Camadas', texto: 'Troque mapa e satélite e ligue os imóveis rurais do CAR e do SIGEF (a partir do zoom 11). Clique num imóvel para ver a ficha: área, potencial, porte, risco e vínculo.' },
  { alvo: '#map', titulo: 'Clique direito no mapa', texto: 'Em qualquer ponto: o que tem aqui, ficha do município, rota a partir dali, cadastro de produtor com o ponto marcado e coordenadas. No celular, segure o dedo no mapa.', centro: true }
]
function tour(i) {
  document.querySelector('.im-tour')?.remove()
  const p = PASSOS[i]
  if (!p) { guardar('val-geomap-tour', '1'); return }
  if (p.antes) p.antes()
  setTimeout(() => {
    const alvo = document.querySelector(p.alvo), r = alvo?.getBoundingClientRect()
    if (!r || !r.width) return tour(i + 1)
    const foco = p.centro ? { x: r.left + r.width / 2 - 70, y: r.top + r.height / 2 - 70, w: 140, h: 140 } : { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 }
    const d = document.createElement('div'); d.className = 'im-tour'
    d.innerHTML = `<div class="im-tour-foco ${p.centro ? 'redondo' : ''}" style="left:${foco.x}px;top:${foco.y}px;width:${foco.w}px;height:${foco.h}px"></div>
      <div class="im-tour-balao" role="dialog" aria-modal="true" aria-labelledby="im-tour-t">
        <small>${i + 1} de ${PASSOS.length}</small><b id="im-tour-t">${esc(p.titulo)}</b><p>${esc(p.texto)}</p>
        <div class="im-tour-acoes"><button type="button" class="btn ghost small" data-t="pular">Pular</button><span></span>${i ? '<button type="button" class="btn small" data-t="voltar">Voltar</button>' : ''}<button type="button" class="btn primary small" data-t="prox">${i === PASSOS.length - 1 ? 'Começar' : 'Próximo'}</button></div>
      </div>`
    document.body.append(d)
    // balão: ao lado do foco, dentro da tela
    const b = d.querySelector('.im-tour-balao'), bw = b.offsetWidth, bh = b.offsetHeight, m = 14
    let x = foco.x + foco.w + m, y = foco.y
    if (x + bw > innerWidth - m) { x = Math.max(m, Math.min(foco.x, innerWidth - bw - m)); y = foco.y + foco.h + m; if (y + bh > innerHeight - m) y = foco.y - bh - m }
    b.style.left = `${Math.max(m, x)}px`; b.style.top = `${Math.max(m, Math.min(y, innerHeight - bh - m))}px`
    const sair = () => { d.remove(); document.removeEventListener('keydown', tecla, true) }
    const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); sair(); guardar('val-geomap-tour', '1') } }
    document.addEventListener('keydown', tecla, true)
    d.addEventListener('click', e => {
      const t = e.target.closest('[data-t]')?.dataset.t; if (!t) return
      sair()
      if (t === 'pular') return guardar('val-geomap-tour', '1')
      tour(t === 'voltar' ? i - 1 : i + 1)
    })
    b.querySelector('[data-t="prox"]').focus()
  }, p.antes ? 420 : 0)
}
