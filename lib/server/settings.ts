import "server-only";
import type { Settings, WeeklyHours, DayOff } from "@/generated/prisma/client";
import { db, type Tx } from "./db";

/** The singleton settings row; created with defaults on first read. */
export async function getSettings(client: Tx | typeof db = db): Promise<Settings> {
  return client.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function getWeeklyHours(client: Tx | typeof db = db): Promise<WeeklyHours[]> {
  return client.weeklyHours.findMany({ orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] });
}

export async function getDaysOff(client: Tx | typeof db = db): Promise<DayOff[]> {
  return client.dayOff.findMany({ orderBy: { date: "asc" } });
}

export type { Settings, WeeklyHours, DayOff };
