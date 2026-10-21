"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/follow-ups", label: "Follow-ups" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="adm-nav-list">
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <li key={link.href}>
            <Link href={link.href} className="adm-nav-link" aria-current={active ? "page" : undefined}>
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
