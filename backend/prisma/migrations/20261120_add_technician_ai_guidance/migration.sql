-- CreateTable
CREATE TABLE IF NOT EXISTS "TechnicianAiGuidance" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "possibleCauses" JSONB,
    "inspectionChecklist" JSONB,
    "estimatedMaterials" JSONB,
    "safeHandlingSteps" JSONB,
    "stopAndEscalateWhen" JSONB,
    "uncertaintyNote" TEXT,
    "isSafetyHazard" BOOLEAN NOT NULL DEFAULT false,
    "hazardType" TEXT,
    "hazardWarning" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianAiGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TechnicianAiGuidance_ticketId_key" ON "TechnicianAiGuidance"("ticketId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TechnicianAiGuidance_status_retryCount_idx" ON "TechnicianAiGuidance"("status", "retryCount");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TechnicianAiGuidance_ticketId_fkey'
    ) THEN
        ALTER TABLE "TechnicianAiGuidance" ADD CONSTRAINT "TechnicianAiGuidance_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
