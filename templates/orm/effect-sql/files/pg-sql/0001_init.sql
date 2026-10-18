CREATE TABLE note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO note (title) VALUES
  ('Welcome to your new app'),
  ('Notes are read through the Database service');
