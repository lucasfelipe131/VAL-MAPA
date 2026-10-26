# VAL Mapa

Mapeamento geográfico de produtores com viés de decisão comercial, levantamento de dados para apresentações e gráficos de acompanhamento. Derivado da base da **VAL Grãos (SOG)**: reaproveita a marca oficial da VAL (ativo original em `public/brand`) e a regra de priorização explicável (`sog-rules-v1` → `mapa-rules-v1`), em um ambiente simples e independente.

## O que faz

- **Mapa**: base OpenStreetMap ou satélite (Esri World Imagery, com ou sem nomes), produtores georreferenciados, cor por prioridade e tamanho por volume potencial. Filtros por cultura, UF, relacionamento, prioridade e busca. Agrupamento por município. **Planejar rota**: clique no mapa, escolha um raio e veja quem está ao alcance, ordenado por score.
- **Produtores**: cadastro com **mini-mapa** (clique, arraste o marcador ou use o GPS do aparelho para marcar a propriedade), volumes em toneladas ou sacas, região, safra, produtividade (sc/ha) e frete (CIF/FOB). Importação em lote por **Excel (.xlsx) ou CSV** com detecção automática do cabeçalho e valores padrão para colunas ausentes, exportação CSV, geocodificação por município e dados de exemplo.
- **Decisão**: ranking com score 0–100 e explicação (potencial 30 + relacionamento 25 + mercado e preço 30 + janela 15), próxima ação sugerida, intenções comerciais com ciclo de estados e cotações por praça.
- **Acompanhamento**: KPIs e gráficos (potencial por UF, volume por cultura, carteira por prioridade, interações por mês, funil de relacionamento, intenções por estado), todos com download em PNG.
- **Apresentação**: dashboard com **filtros** (UF, região, município, cultura, consultor, prioridade, safra), **mapa** dos produtores filtrados, potencial por região e município (t e sacas), gráficos e prioridades da semana, pronto para imprimir ou salvar em PDF, com resumo em texto para colar em slides.

O score é uma ordenação heurística e auditável, não uma probabilidade de compra. Nenhuma negociação é executada automaticamente.

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
