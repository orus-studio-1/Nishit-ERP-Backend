-- DropForeignKey
ALTER TABLE "BatchGenealogy" DROP CONSTRAINT "BatchGenealogy_inputBatchId_fkey";

-- DropForeignKey
ALTER TABLE "BatchGenealogy" DROP CONSTRAINT "BatchGenealogy_inputProductId_fkey";

-- DropForeignKey
ALTER TABLE "BatchGenealogy" DROP CONSTRAINT "BatchGenealogy_outputBatchId_fkey";

-- DropForeignKey
ALTER TABLE "BatchGenealogy" DROP CONSTRAINT "BatchGenealogy_outputProductId_fkey";

-- DropForeignKey
ALTER TABLE "StockReconciliation" DROP CONSTRAINT "StockReconciliation_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "StockReconciliationItem" DROP CONSTRAINT "StockReconciliationItem_reconciliationId_fkey";

-- DropForeignKey
ALTER TABLE "StockTransferOrder" DROP CONSTRAINT "StockTransferOrder_destinationWarehouseId_fkey";

-- DropForeignKey
ALTER TABLE "StockTransferOrder" DROP CONSTRAINT "StockTransferOrder_sourceWarehouseId_fkey";

-- DropForeignKey
ALTER TABLE "StockTransferOrder" DROP CONSTRAINT "StockTransferOrder_transitWarehouseId_fkey";

-- DropForeignKey
ALTER TABLE "StockTransferOrderItem" DROP CONSTRAINT "StockTransferOrderItem_transferOrderId_fkey";

-- AddForeignKey
ALTER TABLE "BatchGenealogy" ADD CONSTRAINT "BatchGenealogy_outputBatchId_fkey" FOREIGN KEY ("outputBatchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchGenealogy" ADD CONSTRAINT "BatchGenealogy_inputBatchId_fkey" FOREIGN KEY ("inputBatchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchGenealogy" ADD CONSTRAINT "BatchGenealogy_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchGenealogy" ADD CONSTRAINT "BatchGenealogy_inputProductId_fkey" FOREIGN KEY ("inputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReconciliation" ADD CONSTRAINT "StockReconciliation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReconciliationItem" ADD CONSTRAINT "StockReconciliationItem_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "StockReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferOrder" ADD CONSTRAINT "StockTransferOrder_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferOrder" ADD CONSTRAINT "StockTransferOrder_transitWarehouseId_fkey" FOREIGN KEY ("transitWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferOrder" ADD CONSTRAINT "StockTransferOrder_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferOrderItem" ADD CONSTRAINT "StockTransferOrderItem_transferOrderId_fkey" FOREIGN KEY ("transferOrderId") REFERENCES "StockTransferOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "StockReconciliationItem_reconciliationId_productId_batchId_seri" RENAME TO "StockReconciliationItem_reconciliationId_productId_batchId__key";
