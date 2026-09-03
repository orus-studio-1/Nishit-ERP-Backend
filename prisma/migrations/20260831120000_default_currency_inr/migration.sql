-- Keep existing multi-currency records unchanged; only new omitted values default to INR.
DO $$
DECLARE
  currency_column RECORD;
BEGIN
  FOR currency_column IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('currency', 'defaultCurrency')
      AND column_default LIKE '%USD%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %L',
      currency_column.table_schema,
      currency_column.table_name,
      currency_column.column_name,
      'INR'
    );
  END LOOP;
END $$;
