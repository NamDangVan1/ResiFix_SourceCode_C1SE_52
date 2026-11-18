-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'ELEVATOR', 'HVAC', 'ACCESS_SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('SCENE_BEFORE', 'REPAIR_PROOF');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_INCIDENT_AI', 'AI_TIMEOUT_ALERT', 'TASK_ASSIGNED', 'STATUS_UPDATED', 'TICKET_CLOSED');

-- CreateEnum
CREATE TYPE "PriorityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('RESIDENT', 'TECHNICIAN', 'BMB');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED');

-- CreateTable
CREATE TABLE "EquipmentAsset" (
    "id" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "category" "IncidentCategory" NOT NULL,
    "locationLabel" TEXT NOT NULL,
    "buildingBlock" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentTicket" (
    "id" TEXT NOT NULL,
    "ticketCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isVoiceInput" BOOLEAN NOT NULL DEFAULT false,
    "locationNote" TEXT NOT NULL,
    "assetId" TEXT,
    "isQrScannedByRes" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "aiSuggestedCategory" "IncidentCategory",
    "aiSuggestedPriority" "PriorityLevel",
    "aiLatencyMs" INTEGER,
    "isAiValidJson" BOOLEAN NOT NULL DEFAULT true,
    "isAiFallbackManual" BOOLEAN NOT NULL DEFAULT false,
    "aiRawResponse" JSONB,
    "finalCategory" "IncidentCategory",
    "finalPriority" "PriorityLevel",
    "bmbAdminNote" TEXT,
    "bmbApprovedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignedTechId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "isQrVerifiedByTech" BOOLEAN NOT NULL DEFAULT false,
    "techRepairNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "status" "TicketStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedConfirmedAt" TIMESTAMP(3),
    "ratingStars" INTEGER,
    "ratingComment" TEXT,
    "residentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "fcmSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMedia" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "publicId" TEXT,
    "mediaType" "MediaType" NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStatusLog" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "Role" NOT NULL DEFAULT 'RESIDENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "apartmentCode" TEXT,
    "buildingBlock" TEXT,
    "floorNumber" INTEGER,
    "specialty" "IncidentCategory",
    "specialtyLabel" TEXT,
    "shiftName" TEXT,
    "isOnDuty" BOOLEAN NOT NULL DEFAULT false,
    "fcmToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentAsset_qrCode_idx" ON "EquipmentAsset"("qrCode" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentAsset_qrCode_key" ON "EquipmentAsset"("qrCode" ASC);

-- CreateIndex
CREATE INDEX "IncidentTicket_assignedTechId_status_idx" ON "IncidentTicket"("assignedTechId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "IncidentTicket_residentId_status_idx" ON "IncidentTicket"("residentId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "IncidentTicket_status_idx" ON "IncidentTicket"("status" ASC);

-- CreateIndex
CREATE INDEX "IncidentTicket_ticketCode_idx" ON "IncidentTicket"("ticketCode" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentTicket_ticketCode_key" ON "IncidentTicket"("ticketCode" ASC);

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId" ASC, "isRead" ASC);

-- CreateIndex
CREATE INDEX "TicketMedia_ticketId_mediaType_idx" ON "TicketMedia"("ticketId" ASC, "mediaType" ASC);

-- CreateIndex
CREATE INDEX "TicketStatusLog_ticketId_createdAt_idx" ON "TicketStatusLog"("ticketId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "User_apartmentCode_idx" ON "User"("apartmentCode" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone" ASC);

-- CreateIndex
CREATE INDEX "User_role_isOnDuty_idx" ON "User"("role" ASC, "isOnDuty" ASC);

-- AddForeignKey
ALTER TABLE "IncidentTicket" ADD CONSTRAINT "IncidentTicket_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EquipmentAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTicket" ADD CONSTRAINT "IncidentTicket_assignedTechId_fkey" FOREIGN KEY ("assignedTechId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTicket" ADD CONSTRAINT "IncidentTicket_bmbApprovedById_fkey" FOREIGN KEY ("bmbApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTicket" ADD CONSTRAINT "IncidentTicket_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMedia" ADD CONSTRAINT "TicketMedia_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMedia" ADD CONSTRAINT "TicketMedia_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusLog" ADD CONSTRAINT "TicketStatusLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusLog" ADD CONSTRAINT "TicketStatusLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
