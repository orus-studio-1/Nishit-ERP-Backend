ALTER TABLE "DeliveryNoteItem" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;
ALTER TABLE "DeliveryNoteItem" ADD CONSTRAINT "DeliveryNoteItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "DeliveryNoteItem_warehouseId_idx" ON "DeliveryNoteItem"("warehouseId");
