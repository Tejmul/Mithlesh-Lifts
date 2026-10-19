import { db } from "@/lib/server/db";

/** Wipes all rows between integration tests (keeps the schema). */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  if (list) await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Inserts default settings + Mon–Sat 07:00–21:00 working hours in the given time zone. */
export async function seedSchedule(opts: { timeZone?: string; minNoticeMinutes?: number } = {}) {
  await db.settings.upsert({
    where: { id: 1 },
    update: { coachTimeZone: opts.timeZone ?? "Asia/Kolkata", minNoticeMinutes: opts.minNoticeMinutes ?? 0 },
    create: { id: 1, coachTimeZone: opts.timeZone ?? "Asia/Kolkata", minNoticeMinutes: opts.minNoticeMinutes ?? 0 },
  });
  await db.weeklyHours.createMany({
    data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 7 * 60, endMinute: 21 * 60 })),
  });
}
