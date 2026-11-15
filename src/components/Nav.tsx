"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CartMark } from "./CartMark";

const LINKS = [
  { href: "/", label: "Shop" },
  { href: "/sell", label: "Sell" },
  { href: "/deals", label: "Deals" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/" className="group flex items-center gap-2.5 rounded-sm text-[17px] font-semibold tracking-[-0.02em] text-foreground">
        <CartMark className="h-[22px] w-[26px] text-foreground transition-transform duration-500 ease-out-expo group-hover:translate-x-[3px]" />
        agent shop
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-sm px-3 py-1.5 transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
