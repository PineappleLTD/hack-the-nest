"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Shop" },
  { href: "/sell", label: "Sell" },
  { href: "/deals", label: "Deals" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/" className="font-serif text-2xl tracking-tight">
        Agent Shop
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                active ? "bg-stone-900 text-stone-50" : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
