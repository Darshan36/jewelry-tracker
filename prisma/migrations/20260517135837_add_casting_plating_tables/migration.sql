-- CreateTable
CREATE TABLE "casting_plating_vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "casting_plating_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casting_entries" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vendorId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyPhone" TEXT,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "notes" TEXT,
    "billId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "casting_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casting_line_items" (
    "id" TEXT NOT NULL,
    "castingEntryId" TEXT NOT NULL,
    "materialDescription" TEXT NOT NULL,
    "weightKg" DECIMAL(10,3) NOT NULL,
    "ratePerKg" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "casting_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casting_payments" (
    "id" TEXT NOT NULL,
    "castingEntryId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "type" "PaymentType" NOT NULL DEFAULT 'PAYMENT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "casting_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plating_entries" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vendorId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyPhone" TEXT,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "notes" TEXT,
    "billId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plating_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plating_line_items" (
    "id" TEXT NOT NULL,
    "platingEntryId" TEXT NOT NULL,
    "materialDescription" TEXT NOT NULL,
    "weightKg" DECIMAL(10,3) NOT NULL,
    "ratePerKg" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plating_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plating_payments" (
    "id" TEXT NOT NULL,
    "platingEntryId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "type" "PaymentType" NOT NULL DEFAULT 'PAYMENT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plating_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "casting_plating_vendors_phone_idx" ON "casting_plating_vendors"("phone");

-- CreateIndex
CREATE INDEX "casting_plating_vendors_deletedAt_idx" ON "casting_plating_vendors"("deletedAt");

-- CreateIndex
CREATE INDEX "casting_plating_vendors_name_idx" ON "casting_plating_vendors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "casting_entries_billId_key" ON "casting_entries"("billId");

-- CreateIndex
CREATE INDEX "casting_entries_vendorId_idx" ON "casting_entries"("vendorId");

-- CreateIndex
CREATE INDEX "casting_entries_deletedAt_idx" ON "casting_entries"("deletedAt");

-- CreateIndex
CREATE INDEX "casting_entries_date_idx" ON "casting_entries"("date");

-- CreateIndex
CREATE INDEX "casting_line_items_castingEntryId_idx" ON "casting_line_items"("castingEntryId");

-- CreateIndex
CREATE INDEX "casting_payments_castingEntryId_idx" ON "casting_payments"("castingEntryId");

-- CreateIndex
CREATE INDEX "casting_payments_castingEntryId_type_idx" ON "casting_payments"("castingEntryId", "type");

-- CreateIndex
CREATE INDEX "casting_payments_deletedAt_idx" ON "casting_payments"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "plating_entries_billId_key" ON "plating_entries"("billId");

-- CreateIndex
CREATE INDEX "plating_entries_vendorId_idx" ON "plating_entries"("vendorId");

-- CreateIndex
CREATE INDEX "plating_entries_deletedAt_idx" ON "plating_entries"("deletedAt");

-- CreateIndex
CREATE INDEX "plating_entries_date_idx" ON "plating_entries"("date");

-- CreateIndex
CREATE INDEX "plating_line_items_platingEntryId_idx" ON "plating_line_items"("platingEntryId");

-- CreateIndex
CREATE INDEX "plating_payments_platingEntryId_idx" ON "plating_payments"("platingEntryId");

-- CreateIndex
CREATE INDEX "plating_payments_platingEntryId_type_idx" ON "plating_payments"("platingEntryId", "type");

-- CreateIndex
CREATE INDEX "plating_payments_deletedAt_idx" ON "plating_payments"("deletedAt");

-- AddForeignKey
ALTER TABLE "casting_entries" ADD CONSTRAINT "casting_entries_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "casting_plating_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casting_entries" ADD CONSTRAINT "casting_entries_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casting_line_items" ADD CONSTRAINT "casting_line_items_castingEntryId_fkey" FOREIGN KEY ("castingEntryId") REFERENCES "casting_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casting_payments" ADD CONSTRAINT "casting_payments_castingEntryId_fkey" FOREIGN KEY ("castingEntryId") REFERENCES "casting_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plating_entries" ADD CONSTRAINT "plating_entries_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "casting_plating_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plating_entries" ADD CONSTRAINT "plating_entries_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plating_line_items" ADD CONSTRAINT "plating_line_items_platingEntryId_fkey" FOREIGN KEY ("platingEntryId") REFERENCES "plating_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plating_payments" ADD CONSTRAINT "plating_payments_platingEntryId_fkey" FOREIGN KEY ("platingEntryId") REFERENCES "plating_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
