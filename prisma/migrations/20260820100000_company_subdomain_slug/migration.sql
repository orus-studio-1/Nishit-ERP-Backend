-- Add slug column to Company table for multi-tenant workspace subdomains
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- Safely backfill unique slugs for all existing companies based on name
WITH ranked AS (
  SELECT id, name,
    COALESCE(
      NULLIF(LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g')), ''),
      'company'
    ) AS base_slug,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(
        NULLIF(LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g')), ''),
        'company'
      )
      ORDER BY "createdAt" ASC
    ) AS rnk
  FROM "Company"
)
UPDATE "Company" c
SET "slug" = CASE 
  WHEN r.rnk = 1 THEN r.base_slug
  ELSE r.base_slug || '-' || r.rnk
END
FROM ranked r
WHERE c.id = r.id;

-- Fallback for any empty or null slug
UPDATE "Company"
SET "slug" = 'company-' || LOWER(SUBSTRING(id FROM 1 FOR 8))
WHERE "slug" IS NULL OR "slug" = '';

-- Alter column to NOT NULL
ALTER TABLE "Company" ALTER COLUMN "slug" SET NOT NULL;

-- Create unique index on Company slug
CREATE UNIQUE INDEX IF NOT EXISTS "Company_slug_key" ON "Company"("slug");
