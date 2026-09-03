ALTER TABLE "DeliveryNote"
  ADD COLUMN IF NOT EXISTS "shipmentStatus" TEXT NOT NULL DEFAULT 'NOT_DISPATCHED',
  ADD COLUMN IF NOT EXISTS "transporter" TEXT,
  ADD COLUMN IF NOT EXISTS "trackingNo" TEXT,
  ADD COLUMN IF NOT EXISTS "expectedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "proofOfDelivery" TEXT;

CREATE INDEX IF NOT EXISTS "DeliveryNote_shipmentStatus_expectedDeliveryAt_idx"
  ON "DeliveryNote"("shipmentStatus", "expectedDeliveryAt");
