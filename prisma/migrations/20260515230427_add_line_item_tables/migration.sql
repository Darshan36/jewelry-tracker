-- CreateTable
CREATE TABLE "sale_line_items" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "rate" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_line_items" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "rate" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_line_items_saleId_idx" ON "sale_line_items"("saleId");

-- CreateIndex
CREATE INDEX "purchase_line_items_purchaseId_idx" ON "purchase_line_items"("purchaseId");

-- AddForeignKey
ALTER TABLE "sale_line_items" ADD CONSTRAINT "sale_line_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_line_items" ADD CONSTRAINT "purchase_line_items_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 7 data migration — copy each existing Sale's qty/rate/itemDescription
-- into one SaleLineItem row, same for Purchase. The next migration drops the
-- legacy columns from the parent tables. gen_random_uuid()::text yields a
-- string ID that matches the Prisma `String @id` column type; Prisma client
-- generates cuid() for new rows going forward (mixed ID formats are fine —
-- both are unique-string).
INSERT INTO "sale_line_items" ("id", "saleId", "itemDescription", "qty", "rate", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  "itemDescription",
  "qty",
  "rate",
  NOW()
FROM "sales"
WHERE "itemDescription" IS NOT NULL;

INSERT INTO "purchase_line_items" ("id", "purchaseId", "itemDescription", "qty", "rate", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  "itemDescription",
  "qty",
  "rate",
  NOW()
FROM "purchases"
WHERE "itemDescription" IS NOT NULL;
