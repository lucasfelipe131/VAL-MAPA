# VAL Geomap

Mapeamento geográfico de produtores com viés de decisão comercial, levantamento de dados para apresentações e gráficos de acompanhamento. Derivado da base da **VAL Grãos (SOG)**: reaproveita a marca oficial da VAL (ativo original em `public/brand`) e a regra de priorização explicável (`sog-rules-v1` → `mapa-rules-v1`), em um ambiente simples e independente.

## O que faz

- **Mapa**: base OpenStreetMap ou satélite (Esri World Imagery, com ou sem nomes), produtores georreferenciados, cor por prioridade e tamanho por volume potencial. Filtros por cultura, UF, relacionamento, prioridade e busca. Agrupamento por município. **Planejar rota**: clique no mapa, escolha um raio e veja quem está ao alcance, ordenado por score.
- **Produtores**: cadastro com **mini-mapa** (clique, arraste o marcador ou use o GPS do aparelho para marcar a propriedade), volumes em toneladas ou sacas, região, safra, produtividade (sc/ha) e frete (CIF/FOB). Importação em lote por **Excel (.xlsx) ou CSV** com detecção automática do cabeçalho e valores padrão para colunas ausentes, exportação CSV, geocodificação por município e dados de exemplo.
- **Decisão**: ranking com score 0–100 e explicação (potencial 30 + relacionamento 25 + mercado e preço 30 + janela 15), próxima ação sugerida, intenções comerciais com ciclo de estados e cotações por praça.
- **Acompanhamento**: KPIs e gráficos (potencial por UF, volume por cultura, carteira por prioridade, interações por mês, funil de relacionamento, intenções por estado), todos com download em PNG.
- **Apresentação**: dashboard com **filtros** (UF, região, município, cultura, consultor, prioridade, safra), **mapa** dos produtores filtrados, potencial por região e município (t e sacas), gráficos e prioridades da semana, pronto para imprimir ou salvar em PDF, com resumo em texto para colar em slides.

O score é uma ordenação heurística e auditável, não uma probabilidade de compra. Nenhuma negociação é executada automaticamente.

## Motor geo: imóveis rurais (CAR e SIGEF)

Módulo independente (`server/geo-inteligencia.js` + `public/geo-inteligencia.js`), que não altera cadastro, score nem as outras telas:

- **Busca pelo nome do produtor**, mesmo sem cadastro no VAL. Procura o nome no registro do imóvel (o SIGEF traz o nome da área, que muitas vezes é o do dono), sem acento e palavra a palavra, em **toda a base**: o município escolhido só põe as áreas dele primeiro, porque o produtor pode ter terra no vizinho. Aceita **grafia parecida** ("Franscisco" acha "Francisco") e ignora "família", "grupo", "filho" e afins. Cada resultado diz a relação: **nome completo**, **nome parecido**, **parcial** ou **mesmo sobrenome** (parente ou área da família, para conferir). Um sobrenome sozinho só entra quando é raro na base. As áreas recebem **pins** no mapa.
- **Completar produtores**: lista os produtores do VAL com a melhor pista de área de cada um. No cadastro do produtor, a seção **Sugestões de áreas** mostra o que bate pelo nome e o que está **no ponto do cadastro** (e perto dele), com "Ver" e "Vincular". Nada é vinculado sem clique: o ponto pode estar na sede ou na área de outro dono.
- **Busca por matrícula** com município, porque o número se repete entre cartórios. Entende "12.345", "R.6-0986", "AV-2/986" e listas.
- **Vínculo de áreas a produtores** (coleção `geo_links`), ou **cadastro de produtor novo** a partir das áreas selecionadas, com o ponto na maior área, a lavoura estimada e o potencial.
- **Potencial por área** calibrado pelo IBGE. Lavoura estimada = área consolidada do CAR × (lavoura de verão do município ÷ áreas-base dos imóveis do CAR). Potencial = lavoura × soja, milho e trigo na proporção plantada no município (PAM 2021–2025: ano bom e média com secas). Parcela SIGEF dentro de um CAR não soma duas vezes e, sozinha, conta a parte dela.
- **Camada de imóveis** da janela do mapa (a partir do zoom 11): laranja sem produtor, azul vinculado, tracejado para parcela SIGEF dentro de um CAR.
- No detalhe do produtor, a seção **Áreas no CAR/SIGEF** mostra as áreas vinculadas e o potencial delas, com "Usar no cadastro" para gravar área e volume.
- **Análise socioambiental** (triagem para compra de grãos): cada imóvel é cruzado com desmatamento e supressão de vegetação nativa do INPE (PRODES Pampa e Mata Atlântica, desde 2009), terras indígenas, unidades de conservação e embargos do IBAMA e do ICMBio. Resultado: **crítico** (embargo ativo, terra indígena ou UC de proteção integral acima de 1 ha, supressão depois de 31/12/2020, a data de corte do EUDR), **atenção** (supressão entre 2009 e 2020, UC de uso sustentável, embargo já desembargado, CAR suspenso) ou **sem alerta**, sempre com o motivo, a área e a fonte. No mapa, imóvel crítico tem contorno vermelho. É triagem com dados públicos: não substitui a análise documental.
- **Porte** pela Lei 8.629/93, somando os módulos fiscais das áreas: minifúndio, pequeno (perfil Pronaf), médio (perfil Pronamp) ou grande. O enquadramento no crédito também depende da renda bruta.
- **Relatórios** para imprimir ou salvar em PDF (`/relatorio.html`): o **do produtor** (no cadastro dele) traz mapa das áreas, matrículas e cartório, situação do CAR, lavoura e potencial por cultura, porte, análise socioambiental, cadastro comercial com prioridade, histórico e documentos. O **do município** (no painel do mapa) traz potencial e mercado (IBGE e custeio do SICOR), porte dos imóveis, cobertura da carteira do VAL, os maiores imóveis sem produtor e os alertas socioambientais.
- **Documentos** no cadastro do produtor: matrícula, KML do GeoMart, laudos, contratos (PDF, KML/KMZ, imagens, Office, CSV, TXT, ZIP, até 10 MB). Ficam na tabela `mapa_documents` (arquivo em `bytea`), saem sempre como download e são apagados junto com o produtor ou no "APAGAR TUDO".

### Mapa imersivo (`public/geo-imersivo.js`)

- **Mapa em tela cheia** com o painel flutuante, que esconde e mostra pela aba na borda ou pela tecla **P**. No celular, o painel vira uma gaveta que sobe de baixo.
- **Busca única** sobre o mapa (tecla **/** ou **Ctrl+K**): produtor do VAL, município, nome no registro do imóvel (CAR/SIGEF), matrícula ou coordenada. O mapa voa até o resultado e abre a ficha.
- **Panorama do RS**: os 497 municípios pintados pelo potencial de grãos (IBGE), pela parcela de imóveis do CAR com alerta crítico ou pela carteira do VAL. Passar o mouse mostra os números; clicar voa até o município e abre a **ficha do município** (abaixo). De perto (zoom 11+) o panorama vira só contorno e a legenda recolhe.
- **Ficha do imóvel** ao clicar num imóvel: área, lavoura, potencial por cultura, matrícula, porte, motivos socioambientais e quem está vinculado, com **Vincular** direto, **Novo produtor**, **Aproximar** e o relatório do município. **Ctrl + clique** seleciona vários de uma vez para o painel.
- **Camadas** num controle só, com miniaturas de mapa, satélite e híbrido (tecla **S**) e as chaves do panorama (**E**), dos imóveis rurais (**I**), dos produtores e dos limites.
- **Clique direito** (ou toque longo) em qualquer ponto: o que tem aqui, ficha do município, planejar rota dali, cadastrar produtor com o ponto marcado, copiar coordenadas e abrir no Google Maps.
- **Tour** de boas-vindas no primeiro acesso e o botão **?** no cabeçalho com os atalhos.

### Ficha do município (`/api/geo/municipio/:codigo`)

Painel à direita (gaveta de baixo no celular) que carrega por seções, cada uma com a fonte escrita embaixo:

| Seção | Rota | Fonte | Como chega |
|---|---|---|---|
| Hectares e porte | `/api/geo/municipio/:codigo` | IBGE (malha), SICAR, INCRA | da base, na hora |
| Culturas | `…/culturas` | IBGE PAM, tabela 5457 do SIDRA (último ano publicado e o anterior) | na hora, cache de 7 dias |
| Crédito rural e garantias | `…/credito` | BCB, Matriz de Dados do Crédito Rural (OData do SICOR): custeio por safra e cultura | `data/geo/municipios-credito.json` |
| Chuva | `…/chuva` | NASA POWER: chuva diária estimada (MERRA-2/GEOS-IT) e normal 2001–2025 | na hora, cache de 6 horas |
| Relevo | `…/relevo` | OpenTopoData, SRTM 30 m: altitude e declividade (classes da Embrapa) | `data/geo/municipios-relevo.json` |
| Valor da terra nua | `/api/geo/municipio/:codigo` | Receita Federal, VTN do ITR 2026 (ou 2025), R$/ha por aptidão; 199 municípios do RS informaram | `data/geo/municipios-estrutura.json` |
| Armazenagem e logística | `/api/geo/municipio/:codigo` | CONAB (SICARM): capacidade por dono e quanto da safra cabe; DNIT/ANTAQ: distância ao porto de Rio Grande, ao porto ou terminal mais perto e ao trilho | `data/geo/municipios-estrutura.json` |
| Estrutura e pecuária | `/api/geo/municipio/:codigo` | IBGE, Censo Agro 2017 (estabelecimentos, tratores, irrigação, armazém na fazenda, financiamento) e PPM (rebanhos e leite) | `data/geo/municipios-estrutura.json` |
| Socioambiental | `/api/geo/municipio/:codigo` | INPE (PRODES, TI, UC), IBAMA e SICAR cruzados nos imóveis do CAR | da base, na hora |
| Áreas embargadas | `…/embargos` | IBAMA, camada pública do PAMGIA (município inteiro; sem nome nem CPF/CNPJ) | na hora, cache de 12 horas |

A camada **Armazéns** do mapa (tecla **A**, rota `/api/geo/armazens`) mostra as 2.761 unidades de empresas e cooperativas, com tamanho pela capacidade; armazéns de pessoa física entram só nos totais do município. O panorama ganhou as métricas **Armazém** (quanto da safra cabe nos armazéns) e **Terra** (VTN de lavoura boa). `municipios-estrutura.json` e `armazens-rs.json` são gerados por `scripts/geo-estrutura.mjs` (rodar de novo a cada ano, ou quando sair a tabela nova do VTN).

Os arquivos `municipios-*.json` são gerados por `scripts/geo-municipios.mjs` (`--relevo` uma vez; `--credito` todo mês, para trazer os contratos novos). Garantias registradas (penhor, hipoteca, alienação fiduciária, CPR) não são públicas por imóvel; a ficha mostra o custeio do SICOR como o sinal público mais próximo e explica isso. A chuva é estimativa por satélite e modelo, não medida de pluviômetro: o portal do INMET recusa download automático.

Rotas (com sessão): `GET /api/geo/status`, `/api/geo/panorama`, `/api/geo/municipio/:codigo[/culturas|credito|chuva|relevo|embargos]`, `/api/geo/municipios`, `/api/geo/imoveis?bbox=o,s,l,n`, `/api/geo/imoveis/:id`, `/api/geo/nome?q=&municipio=[&estrito=1]`, `/api/geo/matricula?numero=&municipio=`, `/api/geo/ponto?lat=&lng=[&raio=km]`, `/api/geo/sugestoes[?producerId=]`, `/api/geo/relatorio/produtor?producerId=`, `/api/geo/relatorio/municipio?municipio=`, `GET|POST /api/geo/vinculos`, `DELETE /api/geo/vinculos/:id`, `GET /api/geo/documentos?producerId=`, `POST /api/geo/documentos?producerId=&nome=&categoria=&descricao=` (corpo = arquivo), `GET|DELETE /api/geo/documentos/:id`.

Base: o **Rio Grande do Sul inteiro** (497 municípios), em `data/geo/imoveis-*.ndjson.gz`, um arquivo por região do IBGE (as regiões grandes divididas em lotes, cada arquivo abaixo do limite de 100 MB do GitHub). O servidor lê todos os `imoveis*.ndjson.gz` da pasta e começa a carga logo depois de subir, em partes, sem travar o app; a primeira busca espera a carga terminar. A geometria fica como fatia do arquivo descompactado (sem cópia, fora do heap do Node), e o `npm start` sobe o Node com até 4 GB de heap. Para atualizar ou trocar de região, gere o recorte de cada lote com `ferramentas/recortar-imoveis.js --municipios lista.json` (projeto "mapa slg cvale") e rode `node scripts/geo-build.mjs --imoveis <recorte.js> --mercado <mercado.json> --camadas <camadas.json.gz> --regiao "nome" --saida data/geo/imoveis-<lote>.ndjson.gz`. Fontes:
- CAR: GeoServer público do SICAR (`sicar:sicar_imoveis_rs`).
- Área consolidada: base de downloads do SICAR.
- SIGEF: Geoportal do INCRA (`geonode:sigef_geo`), com matrícula, cartório (CNS) e nome da área.
- Mercado: IBGE PAM (tabela 1612) e Banco Central SICOR.
- Socioambiental (`node scripts/geo-camadas.mjs --municipios lista.json --bbox o,s,l,n`, ou `--base` de uma base pronta; depois `geo-build.mjs ... --camadas camadas.json.gz`): INPE TerraBrasilis (PRODES, terras indígenas e unidades de conservação dos biomas), ICMBio (embargos, opcional: o serviço da INDE às vezes não responde e a fonte registra quando ficou de fora) e IBAMA dados abertos (termos de embargo). Do embargo ficam só número, data, município, área, situação e geometria; nome e CPF/CNPJ não são gravados.

O CAR público não traz o nome do dono nem a matrícula. Esses dados vêm das parcelas SIGEF que caem dentro de cada CAR. Um imóvel só no CAR, sem SIGEF, não aparece na busca por nome.

## Rodar localmente

```bash
npm install
npm test
npm start
```

Abra `http://localhost:8080`. Sem `DATABASE_URL`, os dados ficam em `.data/mapa.json`.

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | PostgreSQL. As tabelas são criadas automaticamente na inicialização. |
| `MAPA_ACCESS_PASSWORD` | Senha única de acesso. Vazia = ambiente aberto. |
| `MAPA_SESSION_SECRET` | Segredo (≥ 32 caracteres) para assinar a sessão. |
| `PORT` | Porta HTTP (padrão 8080). |

## Deploy na Railway

O `railway.json` usa o `Dockerfile`, inicia com `npm start` e verifica `/live`. Adicione um PostgreSQL ao projeto e referencie `${{Postgres.DATABASE_URL}}` no serviço.

## Importação automática na inicialização

Arquivos em `data/import/*.json` (`{batch, defaults, approximateLocation, rows}`) são importados uma única vez ao iniciar o servidor; o lote é identificado pela chave externa `batch:nome`. Com `approximateLocation`, as coordenadas padrão do município recebem um pequeno deslocamento por produtor e o cadastro fica marcado como "aproximado" até ser ajustado no mini-mapa. O lote `milho-2627-sao-luiz-gonzaga.json` carrega o levantamento da área de milho 26/27 de São Luiz Gonzaga (RS).

## Importação de planilhas

Aceita `.xlsx` ou CSV (separador `;` ou `,`). O cabeçalho é detectado automaticamente (primeira linha com a coluna do produtor e outra coluna reconhecida). Colunas reconhecidas: produtor/nome, município, UF, região, latitude, longitude, área (ha), produtividade (sc/ha), produção em sacas, volume (t), armazenagem, CIF, FOB, culturas, relacionamento, consultor, telefone, último contato, safra, observações. Sem volume informado, o potencial é área × produtividade. Linhas com mesmo nome e município atualizam o cadastro existente sem apagar campos que a planilha não traz. Baixe o modelo pelo menu ⋯ da tela Produtores.

## Estrutura

- `server.js`: servidor HTTP, API e arquivos estáticos.
- `server/rules.js`: validação e motor `mapa-rules-v1`.
- `server/store.js`: PostgreSQL (JSONB) ou arquivo JSON.
- `server/geocode.js`: geocodificação com cache e limite de taxa.
- `server/xlsx.js` e `server/import.js`: leitor de .xlsx sem dependências e mapeamento de colunas.
- `data/import/`: lotes importados automaticamente na inicialização.
- `public/`: interface (Leaflet + Chart.js, sem build).
- `test/`: testes do motor (`node --test`).
