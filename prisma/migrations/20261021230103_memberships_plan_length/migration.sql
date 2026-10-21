-- CreateEnum
CREATE TYPE "PlanUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "durationCount" INTEGER,
ADD COLUMN     "durationUnit" "PlanUnit";

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "amountInr" INTEGER NOT NULL,
    "paidVia" TEXT NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_quoteId_key" ON "Membership"("quoteId");

-- CreateIndex
CREATE INDEX "Membership_leadId_validUntil_idx" ON "Membership"("leadId", "validUntil");

-- CreateIndex
CREATE INDEX "Membership_validUntil_idx" ON "Membership"("validUntil");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
