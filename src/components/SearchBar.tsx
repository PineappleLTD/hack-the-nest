"use client";

import { useEffect, useState } from "react";

type Props = {
  initial?: string;
  placeholder?: string;
  size?: "lg" | "md";
  autoFocus?: boolean;
  onSearch: (q: string) => void;
};

export function SearchBar({ initial = "", placeholder = "Search for anything", size = "md", autoFocus, onSearch }: Props) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);

  const lg = size === "lg";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q) onSearch(q);
      }}
      className={`group flex w-full items-center gap-2 rounded-full border border-stone-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] transition focus-within:border-stone-400 ${
        lg ? "px-6 py-4" : "px-5 py-2.5"
      }`}
    >
      <svg className={`shrink-0 text-stone-400 ${lg ? "h-5 w-5" : "h-4 w-4"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full bg-transparent outline-none placeholder:text-stone-400 ${lg ? "text-lg" : "text-base"}`}
      />
      <button
        type="submit"
        className={`shrink-0 rounded-full bg-stone-900 font-medium text-stone-50 transition hover:bg-stone-700 ${
          lg ? "px-5 py-2 text-sm" : "px-4 py-1.5 text-sm"
        }`}
      >
        Search
      </button>
    </form>
  );
}
