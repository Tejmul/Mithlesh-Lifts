"use server";

import { redirect } from "next/navigation";
import { logout } from "@/lib/server/admin/auth";

export async function signOutAction() {
  await logout();
  redirect("/admin/login");
}
