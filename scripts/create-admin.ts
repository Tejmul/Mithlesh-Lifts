/**
 * Create or update an admin user.
 *   npm run admin:create -- --email you@example.com --name "Mithilesh"
 * Password: ADMIN_PASSWORD env var, or typed at a hidden prompt. Minimum 12 characters.
 * Updating an existing user's password signs out all of their sessions.
 */
import "dotenv/config";
import { randomBytes, scrypt } from "crypto";
import { createInterface } from "readline";
import { Writable } from "stream";
import { promisify } from "util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// Same format as hashPassword() in lib/server/crypto.ts (that module is server-only, so it can't be imported here).
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}

function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Pass --email you@example.com');
  if (!name) throw new Error('Pass --name "Your Name"');

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) throw new Error("Set ADMIN_PASSWORD or run in an interactive terminal.");
    password = await promptHidden("Password (min 12 characters): ");
    const again = await promptHidden("Repeat password: ");
    if (password !== again) throw new Error("Passwords don't match.");
  }
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  if (password.length > 500) throw new Error("Password is too long.");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const passwordHash = await hashPassword(password);
    const existing = await db.adminUser.findUnique({ where: { email } });
    if (existing) {
      await db.$transaction([
        db.adminUser.update({ where: { id: existing.id }, data: { name, passwordHash } }),
        db.adminSession.deleteMany({ where: { adminUserId: existing.id } }),
      ]);
      console.log(`Updated admin ${email} (existing sessions signed out).`);
    } else {
      await db.adminUser.create({ data: { email, name, passwordHash } });
      console.log(`Created admin ${email}. Sign in at /admin/login.`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
