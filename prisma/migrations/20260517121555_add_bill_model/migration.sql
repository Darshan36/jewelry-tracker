-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "attachedToType" TEXT,
    "attachedToId" TEXT,
    "status" "BillStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bills_r2Key_key" ON "bills"("r2Key");

-- CreateIndex
CREATE INDEX "bills_uploadedById_idx" ON "bills"("uploadedById");

-- CreateIndex
CREATE INDEX "bills_attachedToType_attachedToId_idx" ON "bills"("attachedToType", "attachedToId");

-- CreateIndex
CREATE INDEX "bills_deletedAt_idx" ON "bills"("deletedAt");

-- CreateIndex
CREATE INDEX "bills_status_idx" ON "bills"("status");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
