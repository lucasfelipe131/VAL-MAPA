-- VAL Geomap — tabelas documentais (id + JSONB). Idempotente.
CREATE TABLE IF NOT EXISTS mapa_producers (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mapa_intents (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mapa_market_refs (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mapa_interactions (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mapa_producers_municipality ON mapa_producers ((data->>'municipality'));
CREATE INDEX IF NOT EXISTS idx_mapa_intents_producer ON mapa_intents ((data->>'producerId'));
CREATE INDEX IF NOT EXISTS idx_mapa_interactions_producer ON mapa_interactions ((data->>'producerId'));
-- Motor geo: vínculo entre produtor e imóvel rural (CAR/SIGEF). Tabela nova; não altera as anteriores.
CREATE TABLE IF NOT EXISTS mapa_geo_links (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mapa_geo_links_producer ON mapa_geo_links ((data->>'producerId'));
-- Documentos anexados ao produtor (matrícula, KML, laudos). Arquivo em bytea, metadados em JSONB.
CREATE TABLE IF NOT EXISTS mapa_documents (
  id UUID PRIMARY KEY,
  producer_id TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  content BYTEA NOT NULL,
  size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mapa_documents_producer ON mapa_documents (producer_id);
