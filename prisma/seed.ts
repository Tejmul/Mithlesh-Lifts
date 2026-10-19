/** Idempotent seed: settings row + placeholder weekly hours. Run with `npm run db:seed`. No admin user here. */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

    if ((await db.weeklyHours.count()) === 0) {
      // Placeholder hours — change them in /admin/availability.
      // Mon–Sat (1–6), 10:00–13:00 and 17:00–20:00 in the coach's time zone.
      const data = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        { weekday, startMinute: 10 * 60, endMinute: 13 * 60 },
        { weekday, startMinute: 17 * 60, endMinute: 20 * 60 },
      ]);
      await db.weeklyHours.createMany({ data });
      console.log("Seeded placeholder weekly hours.");
    }
    console.log("Seed complete.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
