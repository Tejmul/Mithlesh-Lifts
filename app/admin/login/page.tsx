import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function AdminLoginPage() {
  return (
    <main className="adm-login">
      <div className="adm-login-card">
        <p className="adm-eyebrow">Coach Scale Systems</p>
        <h1 className="adm-h1">Team sign in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
