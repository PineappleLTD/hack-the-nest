"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "@/lib/products";
import { money } from "@/lib/format";
import { VendorBadge } from "./VendorBadge";

const CONDITION_LABEL: Record<string, string> = {
  new: "New",
  used: "Used",
  refurbished: "Refurbished",
  unknown: "",
};

export function ProductCard({ p, dealCount = 0, index = 0 }: { p: Product; dealCount?: number; index?: number }) {
  const [imgOk, setImgOk] = useState(Boolean(p.imageUrl));
  return (
    <article
      className="fade-up group flex flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.25)]"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <a href={p.url} target="_blank" rel="noopener noreferrer" className="block aspect-square bg-white p-6">
        {imgOk && p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgOk(false)}
            className="h-full w-full object-contain transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-xl bg-stone-50 text-stone-300">
            <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 7h12l-1 13H7L6 7Z" />
              <path d="M9 7a3 3 0 0 1 6 0" />
            </svg>
          </div>
        )}
      </a>
      <div className="flex flex-1 flex-col gap-2 border-t border-stone-100 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <VendorBadge id={p.vendor} name={p.vendorName} />
          {CONDITION_LABEL[p.condition] && (
            <span className="text-[11px] font-medium text-stone-500">{CONDITION_LABEL[p.condition]}</span>
          )}
          {dealCount > 0 && (
            <Link
              href={`/deals?store=${encodeURIComponent(p.vendor)}`}
              className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
            >
              {dealCount} deal{dealCount === 1 ? "" : "s"}
            </Link>
          )}
        </div>
        <h3 className="line-clamp-2 text-sm leading-snug text-stone-800">{p.title}</h3>
        <div className="mt-auto flex items-end justify-between pt-1">
          <span className="text-xl font-semibold tracking-tight">{money(p.price, p.currency)}</span>
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-stone-500 underline-offset-4 hover:text-stone-900 hover:underline"
          >
            View on {p.vendorName} →
          </a>
        </div>
      </div>
    </article>
  );
}
