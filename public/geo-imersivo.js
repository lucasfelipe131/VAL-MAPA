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
const abrev = t => (t >= 1e6 ? `${fmt(t / 1e6, 1)} mi t` : t >= 1e3 ? `${fmt(t / 1e3, t >= 1e4 ? 0 : 1)} mil t` : `${fmt(t)} t`)
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
  fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>')
}
const REL = { nome: 'nome completo', parecido: 'nome parecido', parcial: 'parcial', sobrenome: 'mesmo sobrenome' }

if (V) iniciar()

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
    })
    d.addEventListener('change', e => {
      const c = e.target.closest('[data-camada]'); if (!c) return
      const on = c.checked
      if (c.dataset.camada === 'panorama') return panorama(on)
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
      ${chk('limites', 'Municípios com produtores', map.hasLayer(V.state.muniLayer), 'Limites do IBGE')}
    </div>`
  d.classList.toggle('aberto', aberto)
  d.querySelectorAll('.im-cam-bases [data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === atual.nome))
}

// ---------------------------------------------------------------------------------------------
// Panorama do RS: municípios pintados por um indicador
// ---------------------------------------------------------------------------------------------
const METRICAS = {
  potencial: { rotulo: 'Potencial', titulo: 'Potencial de grãos em ano bom', fonte: 'IBGE PAM · soja, milho e trigo', rampa: ['#d3eee0', '#9fd8bd', '#5fbb95', '#25916c', '#0b6247'], valor: d => d?.potencialAnoBomT || 0, texto: v => abrev(v), curto: v => abrev(v).replace(' t', '') },
  alertas: { rotulo: 'Alertas', titulo: '% dos imóveis do CAR com alerta crítico', fonte: 'INPE, IBAMA e ICMBio', rampa: ['#fbe6c8', '#f6c88f', '#ee9f55', '#d4722a', '#9c4612'], valor: d => (d?.car ? d.criticos / d.car * 100 : 0), texto: v => `${fmt(v, v < 10 ? 1 : 0)}%`, curto: v => `${fmt(v, v < 10 ? 1 : 0)}%` },
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
  I.camada = L.geoJSON(I.malha, {
    pane: 'imPanorama',
    style: estiloPan,
    onEachFeature: (f, layer) => {
      I.porCamada.set(f.properties.code, layer)
      layer.bindTooltip(() => dicaMunicipio(f.properties), { sticky: true, direction: 'top', offset: [0, -10], className: 'im-tip', opacity: 1 })
      layer.on('mouseover', () => { if (map.getZoom() < 11) { layer.setStyle({ weight: 2.6, color: '#071b19', opacity: .9 }); layer.bringToFront() } })
      layer.on('mouseout', () => layer.setStyle(estiloPan(f)))
      layer.on('click', e => {
        if (V.state.plan?.active) return   // planejando rota: o clique vai para o mapa (centro da visita)
        L.DomEvent.stopPropagation(e); voarMunicipio(f.properties.code, { ficha: true, latlng: e.latlng })
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
  return { className: 'im-pan-p', color: z >= 11 ? '#071b19' : '#ffffff', weight: z >= 11 ? 1.2 : .8, opacity: z >= 11 ? .35 : .85, fillColor: c < 0 ? SEM_DADO : METRICAS[I.metrica].rampa[c], fillOpacity: c < 0 ? opacidade() * .3 : opacidade() }
}
function dicaMunicipio(p) {
  const d = dadosMunicipio(p.code), met = METRICAS[I.metrica], v = met.valor(d)
  return `<b>${esc(p.name)}</b><span class="im-tip-v">${esc(met.rotulo)}: <b>${v > 0 ? esc(met.texto(v)) : 'sem dado'}</b></span>${d?.car ? `<span>${fmt(d.car)} imóveis no CAR · ${fmt(d.criticos)} com alerta crítico</span>` : ''}${d?.produtoresVal ? `<span>${fmt(d.produtoresVal)} produtor${d.produtoresVal === 1 ? '' : 'es'} do VAL</span>` : ''}<small>Clique para abrir a ficha</small>`
}
function panorama(on, { salvar = true } = {}) {
  const map = V.state.map
  I.panAtivo = on
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
// voa até o município e abre a ficha dele
function voarMunicipio(code, { ficha = false, latlng = null } = {}) {
  const map = V.state.map, layer = I.porCamada.get(code); if (!layer) return
  const b = layer.getBounds()
  const abrir = () => ficha && fichaMunicipio(code, latlng || pontoDentro(code) || b.getCenter())
  const esquerda = innerWidth > 900 && !document.getElementById('view-map').classList.contains('painel-fechado') ? 400 : 30
  if (map.getBounds().contains(b) && map.getZoom() >= map.getBoundsZoom(b, false, L.point(esquerda + 30, 60)) - 1) return abrir()
  map.once('moveend', () => setTimeout(abrir, 60))
  map.flyToBounds(b, { paddingTopLeft: L.point(esquerda, 90), paddingBottomRight: L.point(30, 30), duration: 1.2 })
}
// um ponto dentro do município (o centro da caixa pode cair fora em município de forma irregular)
function pontoDentro(code) {
  const f = I.feiPorCod.get(code); if (!f) return null
  const [o, s, l, n] = f.bbox, c = [(o + l) / 2, (s + n) / 2]
  if (municipioNoPonto(c[1], c[0])?.code === code) return L.latLng(c[1], c[0])
  for (let k = 1; k <= 6; k++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = c[0] + dx * (l - o) * k / 14, y = c[1] + dy * (n - s) * k / 14; if (municipioNoPonto(y, x)?.code === code) return L.latLng(y, x) }
  return null
}
function fichaMunicipio(code, latlng) {
  const map = V.state.map
  I.cart ||= carteira()
  const d = dadosMunicipio(code); if (!d) return
  const prods = (V.state.data?.producers || []).filter(p => (!p.uf || p.uf === 'RS') && norm(p.municipality) === norm(d.municipio))
  const pctCrit = d.car ? d.criticos / d.car * 100 : 0
  const el = document.createElement('div'); el.className = 'im-mun'
  el.innerHTML = `
    <div class="im-mun-topo"><span>Município · RS</span><b>${esc(d.municipio)}</b></div>
    <div class="im-mun-kpis">
      <div><span>Potencial ano bom</span><b>${d.potencialAnoBomT ? abrev(d.potencialAnoBomT) : '—'}</b><small>${d.potencialMediaT ? `média com secas: ${abrev(d.potencialMediaT)}` : 'IBGE PAM'}</small></div>
      <div><span>Lavoura de verão</span><b>${d.lavouraVeraoHa ? `${fmt(d.lavouraVeraoHa)} ha` : '—'}</b><small>soja + milho (IBGE)</small></div>
      <div><span>Imóveis</span><b>${fmt(d.car)} no CAR</b><small>${fmt(d.sigef)} parcelas SIGEF${d.moduloFiscalHa ? ` · MF ${fmt(d.moduloFiscalHa)} ha` : ''}</small></div>
      <div class="${d.criticos ? 'risco' : ''}"><span>Alerta crítico</span><b>${fmt(d.criticos)}</b><small>${d.car ? `${fmt(pctCrit, pctCrit < 10 ? 1 : 0)}% dos imóveis do CAR` : '—'}${d.atencao ? ` · ${fmt(d.atencao)} em atenção` : ''}</small></div>
    </div>
    <div class="im-mun-cart"><b>Carteira do VAL</b>${prods.length ? `<span>${prods.slice(0, 4).map(p => `<a href="#" data-detail="${esc(p.id)}">${esc(p.name)}</a>`).join(', ')}${prods.length > 4 ? ` e mais ${prods.length - 4}` : ''}</span>` : '<span>Nenhum produtor cadastrado aqui.</span>'}${d.imoveisVinculados ? `<small>${fmt(d.imoveisVinculados)} imóve${d.imoveisVinculados === 1 ? 'l vinculado' : 'is vinculados'}</small>` : ''}</div>
    <div class="gf-acoes">
      <button type="button" class="btn small primary" data-m-imoveis>Ver imóveis</button>
      <button type="button" class="btn small" data-m-nomes>Buscar nomes aqui</button>
      <button type="button" class="btn small ghost" data-m-rel>Relatório</button>
    </div>`
  el.addEventListener('click', e => {
    if (e.target.closest('[data-m-rel]')) return window.open(`/relatorio.html?municipio=${encodeURIComponent(d.municipio)}`, '_blank', 'noopener')
    if (e.target.closest('[data-m-imoveis]')) {
      map.closePopup(); window.valGeo.ligarCamada(true)
      map.flyTo(latlng, Math.max(12, map.getZoom()), { duration: 1.1 }); return
    }
    if (e.target.closest('[data-m-nomes]')) {
      map.closePopup()
      const sel = document.getElementById('geo-mun'); if (sel && [...sel.options].some(o => o.value === d.municipio)) sel.value = d.municipio
      window.dispatchEvent(new CustomEvent('geo:painel', { detail: { abrir: true, alvo: 'geo-block' } }))
      setTimeout(() => document.getElementById('geo-q')?.focus(), 380)
    }
  })
  L.DomEvent.disableScrollPropagation(el)
  const esquerda = innerWidth > 900 && !document.getElementById('view-map').classList.contains('painel-fechado') ? 400 : 20
  L.popup({ className: 'geo-ficha-pop im-mun-pop', maxWidth: 360, minWidth: 300, autoPanPaddingTopLeft: L.point(esquerda, 80), autoPanPaddingBottomRight: L.point(30, 30) }).setLatLng(latlng).setContent(el).openOn(map)
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
    if (acao === 'mun') return fichaMunicipio(f.code, e.latlng)
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
  if (e.key === 'Escape') { fecharMenu(); fecharSug(); document.querySelector('.im-camadas')?.classList.remove('aberto'); return }
  if (!document.getElementById('modal').hidden || document.querySelector('.im-tour, .im-ajuda')) return
  if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return focarBusca() }
  if (digitando || e.ctrlKey || e.metaKey || e.altKey) return
  const k = e.key.toLowerCase()
  if (e.key === '/') { e.preventDefault(); return focarBusca() }
  if (k === 'p') return painel(document.getElementById('view-map').classList.contains('painel-fechado'))
  if (k === 'e') return panorama(!I.panAtivo)
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
