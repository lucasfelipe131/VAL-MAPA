-- VAL Mapa — tabelas documentais (id + JSONB). Idempotente.
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
