import Link from "next/link";
import { CartMark } from "./CartMark";

export function Nav() {
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-5xl items-center px-4 py-5 sm:px-6">
      <Link href="/" className="group flex items-center gap-2.5 rounded-sm text-[17px] font-semibold tracking-[-0.02em] text-foreground">
        <CartMark className="h-[22px] w-[26px] text-foreground transition-transform duration-500 ease-out-expo group-hover:translate-x-[3px]" />
        agent shop
      </Link>
    </header>
  );
}
