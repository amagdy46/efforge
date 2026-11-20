CREATE TABLE note (
  id text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id text,
  title text NOT NULL,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO note (title) VALUES
  ('Welcome to your new app'),
  ('Notes are read through the Database service');
