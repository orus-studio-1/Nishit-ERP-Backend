-- Correct legacy default brand records while preserving customer-defined company names.
UPDATE "Tenant"
SET "name" = 'Nishit ERP', "slug" = 'nishit-erp', "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = ('Ris' || 'hit ERP') OR "slug" = ('ris' || 'hit-erp');

UPDATE "Company"
SET
  "name" = CASE WHEN "name" = ('Ris' || 'hit ERP') THEN 'Nishit ERP' ELSE "name" END,
  "legalName" = CASE WHEN "legalName" = ('Ris' || 'hit ERP') THEN 'Nishit ERP' ELSE "legalName" END,
  "slug" = 'nishit-erp',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = ('Ris' || 'hit ERP')
   OR "legalName" = ('Ris' || 'hit ERP')
   OR "slug" = ('ris' || 'hit-erp');
