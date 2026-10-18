CREATE TABLE llm_credential (
  org_id text PRIMARY KEY REFERENCES organization (id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  encrypted_key text NOT NULL,
  base_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
