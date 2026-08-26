DO $$
DECLARE
  fallback_company TEXT;
BEGIN
  SELECT id INTO fallback_company FROM "Company" ORDER BY "createdAt" ASC LIMIT 1;
  IF fallback_company IS NULL THEN
    RETURN;
  END IF;

  UPDATE "Lead" l SET "companyId" = u."companyId" FROM "User" u WHERE l."createdById" = u.id AND l."companyId" IS NULL AND u."companyId" IS NOT NULL;
  UPDATE "Activity" a SET "companyId" = u."companyId" FROM "User" u WHERE a."userId" = u.id AND a."companyId" IS NULL AND u."companyId" IS NOT NULL;
  UPDATE "CrmOrganization" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Contact" c SET "companyId" = l."companyId" FROM "Lead" l WHERE c."leadId" = l.id AND c."companyId" IS NULL AND l."companyId" IS NOT NULL;
  UPDATE "Opportunity" o SET "companyId" = l."companyId" FROM "Lead" l WHERE o."leadId" = l.id AND o."companyId" IS NULL AND l."companyId" IS NOT NULL;

  UPDATE "Account" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "FiscalYear" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "JournalEntry" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "NumberingSeries" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Category" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Unit" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Product" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Warehouse" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "StockLevel" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "StockMovement" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "StockLedgerEntry" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "InventoryValuationLayer" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "StockReservation" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "StockEntry" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Batch" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "SerialNumber" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "PriceList" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "ItemPrice" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "PricingRule" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Department" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Position" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Customer" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Supplier" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Quotation" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "SalesOrder" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "SalesInvoice" si SET "companyId" = u."companyId" FROM "User" u WHERE si."createdById" = u.id AND si."companyId" IS NULL AND u."companyId" IS NOT NULL;
  UPDATE "SalesInvoice" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "SalesInvoice" si SET "companyId" = c."companyId" FROM "Customer" c WHERE si."customerId" = c.id AND c."companyId" IS NOT NULL;
  UPDATE "DeliveryNote" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "TaxTemplate" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Payment" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "PaymentEntry" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "CreditNote" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "GeneralLedgerEntry" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Budget" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "BankStatementLine" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "PrintFormat" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "SubscriptionTemplate" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "AuditLog" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "PurchaseOrder" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "PurchaseInvoice" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Contact" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Opportunity" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Lead" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
  UPDATE "Activity" SET "companyId" = fallback_company WHERE "companyId" IS NULL;
END $$;
