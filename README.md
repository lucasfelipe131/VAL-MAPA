# VAL Mapa

Mapeamento geográfico de produtores com viés de decisão comercial, levantamento de dados para apresentações e gráficos de acompanhamento. Derivado da base da **VAL Grãos (SOG)**: reaproveita a identidade VAL e a regra de priorização explicável (`sog-rules-v1` → `mapa-rules-v1`), em um ambiente simples e independente.

## O que faz

- **Mapa**: produtores georreferenciados, cor por prioridade e tamanho por volume potencial. Filtros por cultura, UF, relacionamento, prioridade e busca. Agrupamento por município. **Planejar rota**: clique no mapa, escolha um raio e veja quem está ao alcance, ordenado por score.
- **Produtores**: cadastro, edição, importação em lote por CSV (colar ou enviar arquivo), exportação CSV, geocodificação por município (OpenStreetMap/Nominatim) e dados de exemplo para demonstração.
- **Decisão**: ranking com score 0–100 e explicação (potencial 30 + relacionamento 25 + mercado e preço 30 + janela 15), próxima ação sugerida, intenções comerciais com ciclo de estados e cotações por praça.
- **Acompanhamento**: KPIs e gráficos (potencial por UF, volume por cultura, carteira por prioridade, interações por mês, funil de relacionamento, intenções por estado), todos com download em PNG.
- **Apresentação**: página limpa com KPIs, gráficos, potencial por município e prioridades da semana, pronta para imprimir ou salvar em PDF, com resumo em texto para colar em slides.

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

## Importação CSV

Colunas reconhecidas (separador `;` ou `,`): `nome`, `municipio`, `uf`, `latitude`, `longitude`, `area_ha`, `culturas`, `armazenagem_t`, `volume_estimado_t`, `relacionamento`, `consultor`, `telefone`, `ultimo_contato`, `observacoes`. Baixe o modelo pelo menu ⋯ da tela Produtores. Linhas com mesmo nome e município atualizam o cadastro existente.

## Estrutura

- `server.js`: servidor HTTP, API e arquivos estáticos.
- `server/rules.js`: validação e motor `mapa-rules-v1`.
- `server/store.js`: PostgreSQL (JSONB) ou arquivo JSON.
- `server/geocode.js`: geocodificação com cache e limite de taxa.
- `public/`: interface (Leaflet + Chart.js, sem build).
- `test/`: testes do motor (`node --test`).
