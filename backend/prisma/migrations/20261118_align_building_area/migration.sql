-- Bring databases created from the original baseline in line with the area model.
-- PostgreSQL renames preserve existing ticket references and QR records.
DO $$
BEGIN
  IF to_regclass('"EquipmentAsset"') IS NOT NULL THEN
    ALTER TABLE "EquipmentAsset" RENAME TO "BuildingArea";
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
               AND table_name = 'BuildingArea' AND column_name = 'areaName') THEN
      UPDATE "BuildingArea" SET "areaName" = "assetName" WHERE "areaName" IS NULL;
      ALTER TABLE "BuildingArea" ALTER COLUMN "areaName" SET NOT NULL;
      ALTER TABLE "BuildingArea" ALTER COLUMN "assetName" DROP NOT NULL;
    ELSE
      ALTER TABLE "BuildingArea" RENAME COLUMN "assetName" TO "areaName";
    END IF;
    ALTER TABLE "IncidentTicket" RENAME COLUMN "assetId" TO "areaId";
    ALTER TABLE "BuildingArea" RENAME CONSTRAINT "EquipmentAsset_pkey" TO "BuildingArea_pkey";
    ALTER TABLE "IncidentTicket" RENAME CONSTRAINT "IncidentTicket_assetId_fkey" TO "IncidentTicket_areaId_fkey";
    ALTER INDEX "EquipmentAsset_qrCode_idx" RENAME TO "BuildingArea_qrCode_idx";
    ALTER INDEX "EquipmentAsset_qrCode_key" RENAME TO "BuildingArea_qrCode_key";
  END IF;
END $$;
