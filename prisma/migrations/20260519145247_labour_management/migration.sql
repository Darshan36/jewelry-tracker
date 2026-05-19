-- CreateEnum
CREATE TYPE "EmployeePaymentType" AS ENUM ('SALARY', 'WAGE');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "ratePerPiece" BIGINT;

-- CreateTable
CREATE TABLE "piece_entries" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "ratePerPiece" BIGINT NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,

    CONSTRAINT "piece_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payments" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "EmployeePaymentType" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,

    CONSTRAINT "employee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "piece_entries_employeeId_date_deletedAt_idx" ON "piece_entries"("employeeId", "date", "deletedAt");

-- CreateIndex
CREATE INDEX "piece_entries_date_deletedAt_idx" ON "piece_entries"("date", "deletedAt");

-- CreateIndex
CREATE INDEX "employee_payments_employeeId_periodStart_periodEnd_deletedA_idx" ON "employee_payments"("employeeId", "periodStart", "periodEnd", "deletedAt");

-- CreateIndex
CREATE INDEX "employee_payments_type_periodStart_deletedAt_idx" ON "employee_payments"("type", "periodStart", "deletedAt");

-- CreateIndex
CREATE INDEX "employee_payments_deletedAt_idx" ON "employee_payments"("deletedAt");

-- AddForeignKey
ALTER TABLE "piece_entries" ADD CONSTRAINT "piece_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_entries" ADD CONSTRAINT "piece_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_entries" ADD CONSTRAINT "piece_entries_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_entries" ADD CONSTRAINT "piece_entries_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
