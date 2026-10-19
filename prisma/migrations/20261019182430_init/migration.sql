-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "coachTimeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "callMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 240,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 21,
    "manageCutoffMinutes" INTEGER NOT NULL DEFAULT 120,
    "meetingUrl" TEXT,
    "teamNotificationEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyHours" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "WeeklyHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayOff" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "DayOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "phoneVerifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT,
    "campaign" TEXT,
    "manychatSubscriberId" TEXT,
    "marketingConsentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pendingPhoneE164" TEXT,
    "phoneE164" TEXT,
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "fullName" TEXT,
    "email" TEXT,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "campaign" TEXT,
    "manychatSubscriberId" TEXT,
    "bookingId" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "blockedUntil" TIMESTAMPTZ(3) NOT NULL,
    "customerTimeZone" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "meetingUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT,
    "campaign" TEXT,
    "internalNotes" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMPTZ(3),
    "rescheduledAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendAfter" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyHours_weekday_idx" ON "WeeklyHours"("weekday");

-- CreateIndex
CREATE UNIQUE INDEX "DayOff_date_key" ON "DayOff"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_phoneE164_key" ON "Lead"("phoneE164");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSession_tokenHash_key" ON "BookingSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSession_bookingId_key" ON "BookingSession"("bookingId");

-- CreateIndex
CREATE INDEX "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_idempotencyKey_key" ON "Booking"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Booking_startsAt_idx" ON "Booking"("startsAt");

-- CreateIndex
CREATE INDEX "Booking_status_startsAt_idx" ON "Booking"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_leadId_idx" ON "Booking"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_status_sendAfter_idx" ON "Notification"("status", "sendAfter");

-- CreateIndex
CREATE INDEX "Notification_bookingId_idx" ON "Notification"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_adminUserId_idx" ON "AdminSession"("adminUserId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma cannot express.
-- ---------------------------------------------------------------------------

-- Double-booking protection at the database level: active bookings may not overlap,
-- including the buffer ([startsAt, blockedUntil)). A concurrent insert for the same
-- slot fails with SQLSTATE 23P01 (exclusion_violation).
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (tstzrange("startsAt", "blockedUntil", '[)') WITH &&)
  WHERE ("status" IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW'));

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_valid_range"
  CHECK ("endsAt" > "startsAt" AND "blockedUntil" >= "endsAt");

ALTER TABLE "WeeklyHours" ADD CONSTRAINT "WeeklyHours_valid"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

ALTER TABLE "Settings" ADD CONSTRAINT "Settings_singleton" CHECK ("id" = 1);
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_sane" CHECK (
  "callMinutes" BETWEEN 10 AND 240 AND "bufferMinutes" >= 0 AND
  "slotIntervalMinutes" BETWEEN 5 AND 240 AND "minNoticeMinutes" >= 0 AND
  "maxAdvanceDays" BETWEEN 1 AND 365 AND "manageCutoffMinutes" >= 0
);
