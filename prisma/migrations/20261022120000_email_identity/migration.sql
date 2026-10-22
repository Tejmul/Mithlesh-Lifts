-- DropIndex
DROP INDEX "Lead_email_idx";

-- DropIndex
DROP INDEX "Lead_phoneE164_key";

-- AlterTable
ALTER TABLE "BookingSession" ADD COLUMN     "emailCodeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailCodeExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "emailCodeHash" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "pendingEmail" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(3),
ALTER COLUMN "phoneVerifiedAt" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_email_key" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_phoneE164_idx" ON "Lead"("phoneE164");

