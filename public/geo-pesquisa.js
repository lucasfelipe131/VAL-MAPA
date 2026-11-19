// VAL Geomap — pesquisa: produtores da base e pesquisa com IA. Carregado depois de geo-imersivo.js.
//  · Produtores da base (tecla R): pessoas e empresas dos cadastros públicos (nome da parcela SIGEF, armazém de
//    pessoa física da CONAB, CNPJ do agro) já com pin, por município; os filtros só escolhem o que aparece.
//    "Cadastrar no VAL" leva o nome e as áreas para o cadastro do produtor (nada entra sozinho na carteira).
//  · Pesquisa com IA (tecla Q, ou a busca com uma pergunta): pergunta em português, a IA consulta a base e
//    responde com os itens marcados no mapa.
const V = window.valMapa
const P = { ativo: false, camada: null, rend: null, itens: [], total: 0, comPin: 0, seq: 0, timer: null, filtros: { municipio: '', areaMin: 0, tipo: '', fonte: '', naoClientes: false, semCritico: false }, aberto: true, lista: false,
  ia: { status: null, conversa: [], ocupado: false, camada: null } }
const esc = s => (V ? V.esc(s) : String(s ?? ''))
const fmt = (v, d = 0) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }))
const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }
const ler = k => { try { return localStorage.getItem(k) } catch { return null } }
const real = v => (v >= 1e6 ? `R$ ${fmt(v / 1e6, 1)} mi` : v >= 1e3 ? `R$ ${fmt(v / 1e3, 0)} mil` : `R$ ${fmt(v)}`)
const tCurto = t => (t >= 1e6 ? `${fmt(t / 1e6, 1)} mi t` : t >= 1e3 ? `${fmt(t / 1e3, t >= 1e4 ? 0 : 1)} mil t` : `${fmt(t)} t`)
const potC = t => (window.valUnidade ? window.valUnidade.curto(t) : tCurto(t))
const COR = { pessoa: '#0f766e', empresa: '#b45309', cliente: '#4d7c0f', risco: '#d92d20', ia: '#c8f25e' }
const ROT_FONTE = { sigef: 'área no SIGEF', conab: 'armazém próprio (CONAB)', cnpj: 'CNPJ do agro' }
const ico = n => window.valImersivo?.ICO?.[n] || ''

if (V) iniciar()

function iniciar() {
  const t = setInterval(() => {
    if (!V.state.map || !window.valImersivo || !window.valGeo || !document.querySelector('.im-busca')) return
    clearInterval(t)
    try { Object.assign(P.filtros, JSON.parse(ler('val-geomap-pb-filtros') || '{}')) } catch { /* filtros padrão */ }
    const salvo = ler('val-geomap-pb-aberto'); P.aberto = salvo === null ? innerWidth > 900 : salvo !== '0'   // no celular começa recolhido
    V.state.map.on('moveend', () => { if (P.ativo && !P.filtros.municipio) { clearTimeout(P.timer); P.timer = setTimeout(carregar, 300) } })
    montarBotaoIA()
    if (ler('val-geomap-pb') === '1') camada(true, { salvar: false })
    addEventListener('geo:unidade', () => { if (P.ativo) { desenharPins(); estado() } })
  }, 300)
}

// ---------------------------------------------------------------------------------------------
// Produtores da base: camada de pins com filtros
// ---------------------------------------------------------------------------------------------
function camada(on, { salvar = true } = {}) {
  const map = V.state.map
  P.ativo = on
  if (salvar) guardar('val-geomap-pb', on ? '1' : '0')
  if (!map.getPane('imProspectos')) { map.createPane('imProspectos'); map.getPane('imProspectos').style.zIndex = 397 }
  P.rend ||= L.svg({ pane: 'imProspectos', padding: 0.3 })
  P.camada ||= L.layerGroup()
  if (on) { P.camada.addTo(map); cartaoFiltros(); carregar() } else { map.removeLayer(P.camada); document.getElementById('im-pb')?.remove() }
  window.valImersivo.desenharCamadas()
}
function mostrarMunicipio(code) {
  P.filtros.municipio = code; guardarFiltros()
  if (!P.ativo) camada(true); else { cartaoFiltros(); carregar() }
  window.valImersivo.voarMunicipio(code)
}
const guardarFiltros = () => guardar('val-geomap-pb-filtros', JSON.stringify(P.filtros))
function consulta(extra = {}) {
  const f = { ...P.filtros, ...extra }, sp = new URLSearchParams()
  if (f.municipio) sp.set('municipio', f.municipio)
  else { const b = V.state.map.getBounds(); sp.set('bbox', [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => v.toFixed(4)).join(',')) }
  if (f.areaMin) sp.set('areaMin', f.areaMin)
  if (f.tipo) sp.set('tipo', f.tipo)
  if (f.fonte) sp.set('fonte', f.fonte)
  if (f.naoClientes) sp.set('naoClientes', '1')
  if (f.semCritico) sp.set('semCritico', '1')
  sp.set('limite', '3000')
  return sp.toString()
}
async function carregar() {
  if (!P.ativo) return
  const map = V.state.map, seq = ++P.seq
  if (!P.filtros.municipio && map.getZoom() < 9) { P.camada.clearLayers(); P.itens = []; P.total = 0; return estado('Escolha um município ou aproxime o mapa (zoom 9 ou mais) para ver os produtores.') }
  estado('Carregando…')
  try {
    const r = await V.api(`/api/geo/produtores-base?${consulta()}`)
    if (seq !== P.seq) return
    P.itens = r.itens; P.total = r.total; P.comPin = r.comPin; P.clientes = r.clientes
    desenharPins()
    estado()
  } catch (e) { if (seq === P.seq) estado(e.message, true) }
}
function raio(p) { const v = p.potencialT || p.areaHa * 2 || p.armazemT / 2 || 0; return Math.max(4, Math.min(14, 3.5 + Math.sqrt(v) / 7)) }
function desenharPins() {
  P.camada.clearLayers()
  for (const p of P.itens) {
    if (!p.ponto) continue
    const cor = p.cliente ? COR.cliente : COR[p.tipo] || COR.pessoa
    L.circleMarker([p.ponto[1], p.ponto[0]], { pane: 'imProspectos', renderer: P.rend, radius: raio(p), color: p.risco === 'critico' ? COR.risco : '#fff', weight: p.risco === 'critico' ? 2.4 : 1.3, fillColor: cor, fillOpacity: 0.9 })
      .bindTooltip(`<b>${esc(p.nome)}</b><span>${p.tipo === 'empresa' ? 'Empresa' : 'Pessoa'} · ${esc(p.municipio)}${p.cliente ? ' · cliente VAL' : ''}</span><span class="im-tip-v">${p.areaHa ? `${fmt(p.areaHa)} ha` : ''}${p.potencialT ? ` · ~${potC(p.potencialT)}` : ''}${p.armazemT ? ` · armazém ${tCurto(p.armazemT)}` : ''}</span>`, { className: 'im-tip', direction: 'top', offset: [0, -6] })
      .on('click', e => { L.DomEvent.stopPropagation(e); abrirProspecto(p.id, p) })
      .addTo(P.camada)
  }
  // quem só tem CNPJ não tem o ponto da lavoura: um pin de grupo no município, com a quantidade, abre a lista
  const sem = P.itens.filter(p => !p.ponto), ll = sem.length && P.filtros.municipio ? window.valImersivo.pontoMunicipio?.(P.filtros.municipio) : null
  if (ll) {
    L.marker(ll, { pane: 'imProspectos', keyboard: true, title: `${sem.length} produtores só com CNPJ`, icon: L.divIcon({ className: 'im-pb-grupo-wrap', html: `<span class="im-pb-grupo">${fmt(sem.length)}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] }) })
      .bindTooltip(`<b>${fmt(sem.length)} produtor${sem.length === 1 ? '' : 'es'} só com CNPJ</b><span>O CNPJ não traz o ponto da lavoura: o pin fica no município.</span><span class="im-tip-v">Clique para ver a lista</span>`, { className: 'im-tip', direction: 'top', offset: [0, -16] })
      .on('click', e => { L.DomEvent.stopPropagation(e); P.lista = true; P.aberto = true; cartaoFiltros() })
      .addTo(P.camada)
  }
}
function cartaoFiltros() {
  let el = document.getElementById('im-pb')
  if (!el) {
    el = document.createElement('div'); el.id = 'im-pb'; el.className = 'im-pb'
    document.getElementById('view-map').append(el)
    L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el)
    el.addEventListener('change', e => {
      const c = e.target.closest('[data-pb]'); if (!c) return
      const k = c.dataset.pb
      P.filtros[k] = c.type === 'checkbox' ? c.checked : k === 'areaMin' ? Number(c.value) : c.value
      guardarFiltros(); carregar()
      if (k === 'municipio' && c.value) window.valImersivo.voarMunicipio(c.value)
    })
    el.addEventListener('click', e => {
      if (e.target.closest('[data-pb-fechar]')) return camada(false)
      if (e.target.closest('[data-pb-min]')) { P.aberto = !P.aberto; guardar('val-geomap-pb-aberto', P.aberto ? '1' : '0'); return cartaoFiltros() }
      if (e.target.closest('[data-pb-lista]')) { P.lista = !P.lista; return estado() }
      const it = e.target.closest('[data-pb-item]')
      if (it) { const p = P.itens.find(x => x.id === it.dataset.pbItem); if (p) abrirProspecto(p.id, p, { voar: true }) }
    })
  }
  const f = P.filtros, muns = window.valImersivo.municipios().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const op = (v, rot, atual) => `<option value="${esc(v)}" ${String(atual) === String(v) ? 'selected' : ''}>${esc(rot)}</option>`
  el.classList.toggle('min', !P.aberto)
  el.innerHTML = `
    <div class="im-pb-topo">
      <button type="button" class="im-pb-tit" data-pb-min aria-expanded="${P.aberto}" title="${P.aberto ? 'Recolher os filtros' : 'Mostrar os filtros'}"><span class="im-pb-ponto" aria-hidden="true"></span><b>Produtores da base</b><span id="im-pb-cont"></span></button>
      <button type="button" class="im-pb-x" data-pb-fechar title="Desligar a camada (R)" aria-label="Desligar a camada de produtores da base">${ico('fechar')}</button>
    </div>
    <div class="im-pb-corpo" ${P.aberto ? '' : 'hidden'}>
      <div class="im-pb-filtros">
        <label class="im-pb-campo largo"><span>Município</span><select data-pb="municipio">${op('', 'Área visível do mapa', f.municipio)}${muns.map(m => op(m.code, m.name, f.municipio)).join('')}</select></label>
        <label class="im-pb-campo"><span>Área</span><select data-pb="areaMin">${[[0, 'Qualquer área'], [20, '20 ha ou mais'], [50, '50 ha ou mais'], [100, '100 ha ou mais'], [300, '300 ha ou mais'], [1000, '1.000 ha ou mais']].map(([v, r]) => op(v, r, f.areaMin)).join('')}</select></label>
        <label class="im-pb-campo"><span>Quem</span><select data-pb="tipo">${op('', 'Pessoas e empresas', f.tipo)}${op('pessoa', 'Só pessoas', f.tipo)}${op('empresa', 'Só empresas', f.tipo)}</select></label>
        <label class="im-pb-campo largo"><span>Fonte do nome</span><select data-pb="fonte">${op('', 'Qualquer fonte', f.fonte)}${op('sigef', 'Com área no SIGEF', f.fonte)}${op('conab', 'Com armazém próprio (CONAB)', f.fonte)}${op('cnpj', 'Com CNPJ do agro', f.fonte)}</select></label>
        <label class="im-pb-chk"><input type="checkbox" data-pb="naoClientes" ${f.naoClientes ? 'checked' : ''}><span>Só quem ainda não é cliente</span></label>
        <label class="im-pb-chk"><input type="checkbox" data-pb="semCritico" ${f.semCritico ? 'checked' : ''}><span>Sem risco socioambiental crítico</span></label>
      </div>
      <div class="im-pb-rodape"><span class="im-pb-leg"><i style="background:${COR.pessoa}"></i>pessoa <i style="background:${COR.empresa}"></i>empresa <i style="background:${COR.cliente}"></i>cliente VAL <i class="anel"></i>risco crítico</span><button type="button" class="btn small ghost" data-pb-lista>${P.lista ? 'Esconder lista' : 'Lista'}</button></div>
      <div class="im-pb-msg" id="im-pb-msg" role="status" aria-live="polite"></div>
      <ol class="im-pb-lista" id="im-pb-lista" hidden></ol>
    </div>`
  estado()
}
function estado(msg, erro = false) {
  const cont = document.getElementById('im-pb-cont'), box = document.getElementById('im-pb-msg'), lista = document.getElementById('im-pb-lista')
  if (!cont) return
  const semPin = P.total ? P.itens.filter(p => !p.ponto).length : 0
  cont.textContent = msg ? '' : P.total ? `${fmt(P.total)}${P.total > P.itens.length ? ` (${fmt(P.itens.length)} maiores)` : ''}` : '0'
  if (box) {
    box.className = `im-pb-msg ${erro ? 'erro' : ''}`
    box.innerHTML = msg ? esc(msg) : P.total ? `${fmt(P.comPin)} com pin${semPin ? ` · ${fmt(semPin)} só com CNPJ, sem local exato (na lista)` : ''}${P.clientes ? ` · ${fmt(P.clientes)} já são clientes` : ''}` : 'Nenhum produtor com esses filtros aqui.'
  }
  if (lista) {
    lista.hidden = !P.lista || !P.itens.length
    if (!lista.hidden) lista.innerHTML = P.itens.slice(0, 150).map(p => `<li><button type="button" data-pb-item="${esc(p.id)}"><b>${esc(p.nome)}</b><small>${esc(p.municipio)} · ${p.areaHa ? `${fmt(p.areaHa)} ha` : p.tipo === 'empresa' ? 'empresa' : 'pessoa'}${p.potencialT ? ` · ~${potC(p.potencialT)}` : ''}${p.cliente ? ' · cliente' : ''}${p.ponto ? '' : ' · sem pin'}</small></button></li>`).join('')
  }
  const btn = document.querySelector('[data-pb-lista]'); if (btn) btn.textContent = P.lista ? 'Esconder lista' : 'Lista'
}

// o popup não fica embaixo do cartão de filtros nem da gaveta da direita
function folgaPopup() {
  const vista = document.getElementById('view-map'), pb = document.getElementById('im-pb')
  const topo = pb ? pb.getBoundingClientRect().bottom - vista.getBoundingClientRect().top + 12 : 80
  const direita = vista.classList.contains('com-ficha') && innerWidth > 900 ? 470 : 30
  return { autoPanPaddingTopLeft: L.point(20, Math.max(80, topo)), autoPanPaddingBottomRight: L.point(direita, 30) }
}
// cartão do produtor da base: popup no pin (ou caixa no meio da tela, quando não tem local exato)
async function abrirProspecto(id, resumo = null, { voar = false } = {}) {
  const map = V.state.map
  let p = resumo
  const el = document.createElement('div'); el.className = 'geo-ficha im-pb-card'
  const desenhar = (d, carregando) => { el.innerHTML = htmlProspecto(d, carregando) }
  if (p) desenhar(p, true)
  else el.innerHTML = '<p class="im-fm-carregando">Carregando…</p>'
  const mostrar = () => {
    if (p?.ponto) {
      const ll = L.latLng(p.ponto[1], p.ponto[0])
      if (voar) { map.once('moveend', () => L.popup({ className: 'geo-ficha-pop', maxWidth: 360, minWidth: 300, ...folgaPopup() }).setLatLng(ll).setContent(el).openOn(map)); map.flyTo(ll, Math.max(map.getZoom(), 13), { duration: 0.9 }) }
      else L.popup({ className: 'geo-ficha-pop', maxWidth: 360, minWidth: 300, ...folgaPopup() }).setLatLng(ll).setContent(el).openOn(map)
    } else dialogo(el)
  }
  if (p) mostrar()
  try {
    const d = await V.api(`/api/geo/produtores-base/${encodeURIComponent(id)}`)
    const primeiro = !p; p = d; desenhar(d, false)
    if (primeiro) mostrar()
    el.onclick = e => acaoProspecto(e, d)
  } catch (e) { el.innerHTML = `<p class="im-fm-erro"><span>${esc(e.message)}</span></p>`; if (!p) dialogo(el) }
}
function htmlProspecto(p, carregando) {
  const fontes = Object.entries(p.fontes || {}).filter(([, n]) => n > 0)
  const emp = p.empresasDetalhe?.length ? p.empresasDetalhe : p.empresas || []
  return `
    <div class="gf-topo"><span class="gf-fonte ${p.tipo === 'empresa' ? 'sigef' : 'car'}">${p.tipo === 'empresa' ? 'Empresa' : 'Pessoa'}</span><span class="gf-mun">${esc(p.municipio)}</span>${p.risco === 'critico' ? '<span class="badge risco-critico">risco</span>' : ''}</div>
    <b class="gf-nome">${esc(p.nome)}</b>
    <span class="gf-sub">Produtor da base · ${fontes.map(([k, n]) => `${n > 1 && k === 'sigef' ? `${fmt(n)} parcelas no SIGEF` : ROT_FONTE[k]}`).join(' · ')}</span>
    <div class="gf-kpis">
      <div><span>Área ligada</span><b>${p.areaHa ? `${fmt(p.areaHa)} ha` : '—'}</b></div>
      <div><span>Lavoura est.</span><b>${p.lavouraHa ? `${fmt(p.lavouraHa)} ha` : '—'}</b></div>
      <div><span>${p.armazemT && !p.potencialT ? 'Armazém' : 'Potencial'}</span><b>${p.potencialT ? `~${potC(p.potencialT)}` : p.armazemT ? tCurto(p.armazemT) : '—'}</b></div>
    </div>
    <ul class="gf-linhas">
      ${p.cliente ? `<li class="gf-vinc">Já é cliente do VAL: <a href="#" data-detail="${esc(p.cliente.id)}">${esc(p.cliente.nome)}</a> <small>(${esc(p.cliente.por)})</small></li>` : ''}
      ${p.armazemT ? `<li>Armazém próprio na CONAB: <b>${tCurto(p.armazemT)}</b> de capacidade</li>` : ''}
      ${emp.slice(0, 3).map(e => `<li><a href="#" data-pb-emp="${esc(e.id)}"><b>${esc(e.razaoSocial)}</b></a> <small>CNPJ ${esc(e.cnpj)}${e.atividade ? ` · ${esc(e.atividade.replace(/^\d+\s*/, ''))}` : e.grupo ? ` · ${esc(e.grupo)}` : ''}${e.capitalSocial ? ` · capital ${real(e.capitalSocial)}` : ''}${e.socio ? ` · sócio ${esc(e.socio)}` : ''}</small></li>`).join('')}
      ${p.imoveis?.length ? `<li>${p.imoveis.slice(0, 3).map(i => `<a href="#" data-pb-imovel="${esc(i.id)}">${esc(i.nome || i.fonte)}</a> (${fmt(i.areaHa)} ha)`).join(', ')}${p.imoveis.length > 3 ? ` e mais ${p.imoveis.length - 3}` : ''}</li>` : ''}
    </ul>
    <p class="gf-mais-aviso">Nome tirado de cadastro público: é pista, não prova de quem é o dono. Confirme pela matrícula ou com o produtor.</p>
    <div class="gf-acoes">
      ${p.cliente ? `<button type="button" class="btn small primary" data-detail="${esc(p.cliente.id)}">Abrir cliente</button>` : `<button type="button" class="btn small primary" data-pb-cadastrar ${carregando ? 'disabled' : ''}>Cadastrar no VAL</button>`}
      ${p.areas ? `<button type="button" class="btn small" data-pb-areas ${carregando ? 'disabled' : ''}>Ver as áreas</button>` : ''}
      <button type="button" class="btn small ghost" data-pb-mun="${esc(p.codigoIbge)}">Município</button>
    </div>`
}
function acaoProspecto(e, p) {
  const map = V.state.map
  const det = e.target.closest('[data-detail]'); if (det) { e.preventDefault(); map.closePopup(); fecharDialogo(); return V.showDetail(det.dataset.detail) }
  const emp = e.target.closest('[data-pb-emp]'); if (emp) { e.preventDefault(); return abrirEmpresa(emp.dataset.pbEmp) }
  const im = e.target.closest('[data-pb-imovel]'); if (im) { e.preventDefault(); const i = p.imoveis.find(x => x.id === im.dataset.pbImovel); fecharDialogo(); return i && window.valGeo.mostrarImovel(i) }
  if (e.target.closest('[data-pb-mun]')) { map.closePopup(); fecharDialogo(); return window.valImersivo.voarMunicipio(p.codigoIbge, { ficha: true }) }
  if (e.target.closest('[data-pb-areas]')) {
    if (!p.imoveis?.length) return
    const ids = p.imoveis.map(i => i.id)
    const b = p.imoveis.reduce((x, i) => [[Math.min(x[0][0], i.bbox[1]), Math.min(x[0][1], i.bbox[0])], [Math.max(x[1][0], i.bbox[3]), Math.max(x[1][1], i.bbox[2])]], [[90, 180], [-90, -180]])
    map.closePopup(); fecharDialogo()
    map.once('moveend', () => window.valGeo.destacar(ids))
    map.flyToBounds(b, { padding: [70, 70], maxZoom: 15, duration: 1 })
    return
  }
  if (e.target.closest('[data-pb-cadastrar]')) {
    map.closePopup(); fecharDialogo()
    if (p.imoveis?.length) return window.valGeo.novoProdutorComAreas(p.imoveis, p.nome)
    const ponto = p.ponto || (p.armazens?.[0] ? [p.armazens[0][1], p.armazens[0][0]] : null)
    return V.openProducerForm({ name: p.nome, uf: 'RS', municipality: p.municipio, ibgeCode: p.codigoIbge, lat: ponto ? ponto[1] : '', lng: ponto ? ponto[0] : '', locationPrecision: ponto ? 'exact' : 'municipality', relationship: 'prospect' })
  }
}

// cartão de empresa (CNPJ do agro)
async function abrirEmpresa(cnpj) {
  const el = document.createElement('div'); el.className = 'geo-ficha im-emp-card'; el.innerHTML = '<p class="im-fm-carregando">Carregando…</p>'
  dialogo(el)
  try {
    const e = await V.api(`/api/geo/empresas/${encodeURIComponent(cnpj)}`)
    el.innerHTML = `
      <div class="gf-topo"><span class="gf-fonte sigef">${e.cooperativa ? 'Cooperativa' : 'Empresa'}</span><span class="gf-mun">${esc(e.municipio)}</span></div>
      <b class="gf-nome">${esc(e.razaoSocial)}</b>
      <span class="gf-sub">${e.nomeFantasia ? `${esc(e.nomeFantasia)} · ` : ''}CNPJ ${esc(e.cnpj)} · ${e.matriz ? 'matriz' : 'filial'}${e.inicio ? ` · desde ${esc(e.inicio.slice(0, 4))}` : ''}</span>
      <ul class="gf-linhas">
        <li>${esc(e.atividade)}</li>
        ${e.atividadesAgro.length ? `<li><small>Também: ${e.atividadesAgro.slice(0, 4).map(esc).join('; ')}</small></li>` : ''}
        <li>${e.capitalSocial ? `Capital social <b>${real(e.capitalSocial)}</b> · ` : ''}${esc(e.porte)}${e.natureza ? ` · ${esc(e.natureza)}` : ''}</li>
        ${e.local ? `<li><small>${esc([e.local.lg, e.local.b, e.local.cep ? `CEP ${e.local.cep}` : ''].filter(Boolean).join(' · '))}</small></li>` : ''}
      </ul>
      ${e.socios?.length ? `<div class="gf-nomes"><span class="gf-mais-tit">Quadro de sócios (${fmt(e.totalSocios)})</span><ul>${e.socios.slice(0, 10).map(s => `<li><b>${esc(s.nome)}</b><small>${esc(s.qualificacao)}${s.desde ? ` · desde ${esc(s.desde)}` : ''}</small></li>`).join('')}</ul></div>` : ''}
      <p class="gf-mais-aviso">Receita Federal, dados abertos do CNPJ. Telefone, e-mail e CPF não são guardados.</p>
      <div class="gf-acoes"><button type="button" class="btn small" data-emp-nome>Procurar áreas com esse nome</button><button type="button" class="btn small ghost" data-fechar>Fechar</button></div>`
    el.onclick = ev => {
      if (ev.target.closest('[data-emp-nome]')) { fecharDialogo(); const nome = e.socios?.find(s => s.tipo === 'pessoa')?.nome || e.razaoSocial; window.valGeo.buscarNoPainel('nome', nome, e.municipio) }
    }
  } catch (err) { el.innerHTML = `<p class="im-fm-erro"><span>${esc(err.message)}</span></p>` }
}
function dialogo(conteudo) {
  fecharDialogo()
  const d = document.createElement('div'); d.className = 'im-ajuda im-dialogo'
  const card = document.createElement('div'); card.className = 'im-ajuda-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true')
  card.innerHTML = `<button type="button" class="im-ajuda-x" data-fechar aria-label="Fechar">${ico('fechar')}</button>`
  card.append(conteudo); d.append(card)
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-fechar]')) fecharDialogo() })
  P.teclaDialogo = e => { if (e.key === 'Escape') { e.stopPropagation(); fecharDialogo() } }
  document.addEventListener('keydown', P.teclaDialogo, true)
  document.body.append(d)
}
function fecharDialogo() { document.querySelector('.im-dialogo')?.remove(); if (P.teclaDialogo) document.removeEventListener('keydown', P.teclaDialogo, true); P.teclaDialogo = null }

// ---------------------------------------------------------------------------------------------
// Pesquisa com IA
// ---------------------------------------------------------------------------------------------
const EXEMPLOS = [
  'Quais são os 10 maiores produtores da base em Santo Ângelo que ainda não são clientes?',
  'Compare Ijuí, Cruz Alta e Tupanciretã em potencial, armazenagem e valor da terra',
  'Quais municípios têm mais safra do que armazém?',
  'Empresas de grãos com capital acima de R$ 1 milhão em Palmeira das Missões',
  'Imóveis com mais de 500 ha e embargo ativo no RS',
  'Quem pode ser o dono das maiores áreas sem vínculo em Cruz Alta?'
]
function montarBotaoIA() {
  const caixa = document.querySelector('.im-busca')
  if (!caixa || caixa.querySelector('.im-ia-btn')) return
  const b = document.createElement('button')
  b.type = 'button'; b.className = 'im-ia-btn'; b.title = 'Pesquisa com IA (Q)'; b.setAttribute('aria-label', 'Abrir a pesquisa com IA')
  b.innerHTML = `${ico('ia')}<span>IA</span>`
  b.onclick = () => abrirIA()
  caixa.querySelector('kbd')?.before(b)
}
function gavetaIA() {
  let el = document.getElementById('im-ia')
  if (el) return el
  el = document.createElement('aside')
  el.id = 'im-ia'; el.className = 'im-fm im-ia'; el.hidden = true; el.setAttribute('aria-label', 'Pesquisa com IA')
  el.innerHTML = `
    <header class="im-fm-topo"><div><span>Pesquisa com IA</span><h2>Pergunte à base</h2></div><button type="button" class="im-fm-x" data-ia-fechar title="Fechar (Esc)" aria-label="Fechar a pesquisa com IA">${ico('fechar')}</button></header>
    <div class="ia-aviso" id="ia-aviso" hidden></div>
    <div class="ia-conversa" id="ia-conversa" aria-live="polite"></div>
    <form class="ia-form" id="ia-form">
      <textarea id="ia-q" rows="2" maxlength="2000" placeholder="Pergunte sobre produtores, áreas, empresas ou municípios do RS" aria-label="Sua pergunta"></textarea>
      <button type="submit" class="btn small primary" id="ia-enviar">Perguntar</button>
    </form>
    <p class="ia-rodape"><span>A IA consulta só a base do Geomap. Nomes de donos são pistas de cadastros públicos.</span><button type="button" data-ia-limpar>Nova conversa</button></p>`
  document.getElementById('view-map').append(el)
  L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el)
  const q = el.querySelector('#ia-q')
  el.querySelector('#ia-form').addEventListener('submit', e => { e.preventDefault(); const t = q.value; q.value = ''; perguntar(t) })
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('#ia-form').requestSubmit() } if (e.key === 'Escape') { e.stopPropagation(); fecharIA() } })
  el.addEventListener('click', cliqueIA)
  const det = document.getElementById('detail')
  if (det) new MutationObserver(() => { if (!det.hidden) fecharIA() }).observe(det, { attributes: true, attributeFilter: ['hidden'] })
  return el
}
const iaAberta = () => !document.getElementById('im-ia')?.hidden && Boolean(document.getElementById('im-ia'))
async function abrirIA() {
  const el = gavetaIA()
  window.valImersivo.fecharFichaMun()
  const det = document.getElementById('detail'); if (det && !det.hidden) det.hidden = true
  el.hidden = false
  document.getElementById('view-map').classList.add('com-ficha', 'com-ia')
  desenharConversa()
  setTimeout(() => el.querySelector('#ia-q')?.focus(), 60)
  if (!P.ia.status) {
    try { P.ia.status = await V.api('/api/geo/ia') } catch (e) { P.ia.status = { disponivel: false, motivo: e.message } }
    const aviso = document.getElementById('ia-aviso')
    if (aviso && !P.ia.status.disponivel) { aviso.hidden = false; aviso.innerHTML = `<b>IA desligada neste servidor</b><span>${esc(P.ia.status.motivo || '')} Quem administra o servidor cria a chave no console da Anthropic e põe na variável ANTHROPIC_API_KEY do Railway.</span>` }
  }
}
function fecharIA() {
  const el = document.getElementById('im-ia'); if (!el || el.hidden) return
  el.hidden = true
  document.getElementById('view-map').classList.remove('com-ia')
  if (document.getElementById('im-fm')?.hidden !== false) document.getElementById('view-map').classList.remove('com-ficha')
}
function cliqueIA(e) {
  if (e.target.closest('[data-ia-fechar]')) return fecharIA()
  if (e.target.closest('[data-ia-limpar]')) { P.ia.conversa = []; P.ia.camada?.clearLayers(); return desenharConversa() }
  const ex = e.target.closest('[data-ia-ex]'); if (ex) return perguntar(ex.dataset.iaEx)
  const mapa = e.target.closest('[data-ia-mapa]'); if (mapa) { const it = P.ia.conversa[Number(mapa.dataset.iaMapa)]; if (it) marcarNoMapa(it, { voar: true }); return }
  const ref = e.target.closest('[data-ref]'); if (!ref) return
  e.preventDefault()
  const k = ref.dataset.ref.indexOf(':'), t = ref.dataset.ref.slice(0, k), id = ref.dataset.ref.slice(k + 1)   // ids do CAR têm ':' dentro
  const it = P.ia.conversa[Number(ref.dataset.n)], r = it?.refs?.[t]?.[id]
  if (t === 'i' && r) { if (innerWidth <= 900) fecharIA(); return window.valGeo.mostrarImovel(r) }
  if (t === 'p') { if (innerWidth <= 900) fecharIA(); return abrirProspecto(id, r || null, { voar: true }) }
  if (t === 'e') return abrirEmpresa(id)
  if (t === 'm') { fecharIA(); return window.valImersivo.voarMunicipio(id, { ficha: true }) }
  if (t === 'v') return V.showDetail(id)
}
async function perguntar(texto) {
  const q = String(texto || '').trim()
  await abrirIA()
  if (!q || P.ia.ocupado) return
  P.ia.ocupado = true
  const item = { pergunta: q, resposta: '', passos: [], estado: 'pensando', t0: Date.now() }
  const historico = P.ia.conversa.filter(x => x.estado === 'ok').slice(-6).map(x => ({ pergunta: x.pergunta, resposta: x.resposta }))
  P.ia.conversa.push(item); desenharConversa()
  try {
    const resp = await fetch('/api/geo/ia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pergunta: q, historico, unidade: window.valUnidade?.get() || 't' }) })
    if (!resp.ok || !resp.body) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || j.message || `Erro ${resp.status}`) }
    const leitor = resp.body.getReader(), dec = new TextDecoder()
    let buf = '', fim = false
    while (!fim) {
      const { value, done } = await leitor.read(); if (done) break
      buf += dec.decode(value, { stream: true })
      let k
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const bloco = buf.slice(0, k); buf = buf.slice(k + 2)
        const tipo = (bloco.match(/^event: (.+)$/m) || [])[1], dado = (bloco.match(/^data: (.+)$/m) || [])[1]
        if (!tipo || !dado) continue
        const d = JSON.parse(dado)
        if (tipo === 'passo') { item.passos.push(d.texto); desenharConversa() }
        if (tipo === 'erro') { item.estado = 'erro'; item.erro = d.mensagem; fim = true }
        if (tipo === 'fim') { Object.assign(item, { resposta: d.resposta, refs: d.referencias, mapa: d.mapa, uso: d.uso, ms: d.ms, cortada: d.cortada, estado: 'ok' }); fim = true; marcarNoMapa(item, { voar: true }) }
      }
    }
    if (item.estado === 'pensando') { item.estado = 'erro'; item.erro = 'A conexão caiu antes da resposta. Tente de novo.' }
  } catch (e) { item.estado = 'erro'; item.erro = e.message }
  finally { P.ia.ocupado = false; desenharConversa() }
}
function desenharConversa() {
  const box = document.getElementById('ia-conversa'); if (!box) return
  const btn = document.getElementById('ia-enviar'); if (btn) { btn.disabled = P.ia.ocupado; btn.textContent = P.ia.ocupado ? 'Pesquisando…' : 'Perguntar' }
  if (!P.ia.conversa.length) {
    box.innerHTML = `<div class="ia-vazio"><p>Pergunte em português. A IA cruza imóveis do CAR e do SIGEF, produtores da base, empresas do agro, dados dos municípios e a carteira do VAL, e marca no mapa o que citar.</p>
      <span>Experimente</span><div class="ia-exemplos">${EXEMPLOS.map(x => `<button type="button" data-ia-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`
    return
  }
  box.innerHTML = P.ia.conversa.map((it, n) => `
    <div class="ia-q">${esc(it.pergunta)}</div>
    <div class="ia-r ${it.estado}">
      ${it.estado === 'pensando' ? `<div class="ia-passos"><span class="ia-girando" aria-hidden="true"></span><b>Pesquisando na base…</b>${it.passos.map(p => `<small>✓ ${esc(p)}</small>`).join('')}</div>` : ''}
      ${it.estado === 'erro' ? `<p class="ia-erro">${esc(it.erro)}</p>` : ''}
      ${it.estado === 'ok' ? `<div class="ia-texto">${md(it.resposta, it.refs, n)}</div>
        <div class="ia-meta">${(it.mapa?.i?.length || it.mapa?.p?.length) ? `<button type="button" class="btn small" data-ia-mapa="${n}">${ico('alvo')}Mostrar ${fmt((it.mapa.i.length || 0) + (it.mapa.p.length || 0))} no mapa</button>` : ''}<small>${it.passos.length} consulta${it.passos.length === 1 ? '' : 's'} à base · ${fmt((it.ms || 0) / 1000, 0)} s${it.cortada ? ' · resposta cortada' : ''}</small></div>` : ''}
    </div>`).join('')
  box.scrollTop = box.scrollHeight
}
// Markdown simples e seguro: escapa tudo antes; marcações [[t:id]] viram chips
const ROT_REF = { i: 'imóvel', p: 'produtor', e: 'CNPJ', m: 'município', v: 'cliente' }
function md(texto, refs = {}, n = 0) {
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[\[([imepv]):([^\]\s|]{1,80})\]\]/g, (tudo, t, id) => (refs?.[t]?.[id] ? `<button type="button" class="ia-chip ia-chip-${t}" data-ref="${t}:${esc(id)}" data-n="${n}" title="Mostrar no mapa">${ico('alvo')}${ROT_REF[t]}</button>` : ''))
  const linhas = esc(texto).split('\n'), out = []
  let lista = null, tabela = null
  const fecha = () => { if (lista) { out.push(`<${lista.t}>${lista.itens.map(x => `<li>${inline(x)}</li>`).join('')}</${lista.t}>`); lista = null } if (tabela) { const [cab, ...corpo] = tabela.filter(l => !/^\|?\s*:?-{2,}/.test(l)); const cel = l => l.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim())); out.push(`<div class="im-fm-rolar"><table class="im-fm-tab"><thead><tr>${cel(cab).map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${corpo.map(l => `<tr>${cel(l).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); tabela = null } }
  for (const l of linhas) {
    const t = l.trim()
    if (/^\|.*\|$/.test(t)) { if (lista) fecha(); (tabela ||= []).push(t); continue }
    if (tabela) fecha()
    const ul = t.match(/^[-*•]\s+(.*)$/), ol = t.match(/^\d+[.)]\s+(.*)$/)
    if (ul || ol) { const tipo = ul ? 'ul' : 'ol'; if (lista && lista.t !== tipo) fecha(); (lista ||= { t: tipo, itens: [] }).itens.push((ul || ol)[1]); continue }
    fecha()
    if (!t) continue
    const h = t.match(/^#{1,4}\s+(.*)$/)
    out.push(h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(t)}</p>`)
  }
  fecha()
  return out.join('')
}
function marcarNoMapa(it, { voar = false } = {}) {
  const map = V.state.map
  if (!map.getPane('imIA')) { map.createPane('imIA'); map.getPane('imIA').style.zIndex = 398 }
  P.ia.rend ||= L.svg({ pane: 'imIA', padding: 0.3 })
  P.ia.camada ||= L.layerGroup().addTo(map)
  P.ia.camada.clearLayers()
  const pts = []
  const marca = (ll, rot, sub, clique) => {
    pts.push(ll)
    L.circleMarker(ll, { pane: 'imIA', renderer: P.ia.rend, radius: 8, color: '#0b2b27', weight: 2.2, fillColor: COR.ia, fillOpacity: 0.95 })
      .bindTooltip(`<b>${esc(rot)}</b><span>${esc(sub)}</span>`, { className: 'im-tip', direction: 'top', offset: [0, -8] }).on('click', e => { L.DomEvent.stopPropagation(e); clique() }).addTo(P.ia.camada)
  }
  for (const id of it.mapa?.i || []) { const r = it.refs.i[id]; if (r?.ponto) marca([r.ponto[1], r.ponto[0]], window.valGeo.rotulo(r), `${r.fonte} · ${r.municipio} · ${fmt(r.areaHa)} ha`, () => window.valGeo.mostrarImovel(r)) }
  for (const id of it.mapa?.p || []) { const r = it.refs.p[id]; if (r?.ponto) marca([r.ponto[1], r.ponto[0]], r.nome, `Produtor da base · ${r.municipio}`, () => abrirProspecto(id, r)) }
  if (voar && pts.length) {
    const largo = innerWidth > 900
    map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: [largo && !document.getElementById('view-map').classList.contains('painel-fechado') ? 420 : 40, 80], paddingBottomRight: [largo ? 480 : 40, largo ? 40 : Math.round(innerHeight * 0.55)], maxZoom: 13, duration: 1.1 })
  }
}

window.valPesquisa = { camada, ativo: () => P.ativo, mostrarMunicipio, abrirProspecto, abrirEmpresa, abrirIA, fecharIA, iaAberta, perguntar }
