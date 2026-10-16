-- Generation and independent review are separate durable paid boundaries on one job.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS draft jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_step text NOT NULL DEFAULT 'prepare';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_request_body jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_invocation_id text UNIQUE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_result jsonb;

-- Existing source synchronisation clears request_body on invalidation / rights erasure.
-- Extend that same erasure boundary to every new copy of source-derived material.
-- Invocation IDs survive for reconciliation; neither unknown call is ever reissued.
CREATE OR REPLACE FUNCTION erase_editorial_material() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_body IS NULL THEN
    NEW.draft := NULL;
    NEW.review_request_body := NULL;
    NEW.review_result := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jobs_erase_editorial_material ON jobs;
CREATE TRIGGER jobs_erase_editorial_material BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION erase_editorial_material();
