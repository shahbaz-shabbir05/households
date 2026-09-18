-- Bootstrap: primitives every later migration depends on.

-- UUIDv7: a time-ordered UUID. Built on gen_random_uuid(), a Postgres
-- built-in, so no extension (and no superuser) is required to deploy.
--
-- Layout: 48 bits of Unix-millisecond timestamp, version nibble 7, then
-- randomness. The variant nibble is taken straight from gen_random_uuid(),
-- which already sets the RFC 4122 10xx variant.
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
DECLARE
  unix_ms bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  ts_hex  text   := lpad(to_hex(unix_ms), 12, '0');
  rnd     text   := replace(gen_random_uuid()::text, '-', '');
BEGIN
  RETURN (
    substr(ts_hex, 1, 8) || '-' ||
    substr(ts_hex, 9, 4) || '-' ||
    '7' || substr(rnd, 14, 3) || '-' ||
    substr(rnd, 17, 4) || '-' ||
    substr(rnd, 21, 12)
  )::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Keeps `updated_at` honest without every service remembering to set it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
