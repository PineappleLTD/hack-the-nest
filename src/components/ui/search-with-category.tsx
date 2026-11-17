"use client"

import { useEffect, useId, useMemo, useRef } from "react"
import { ImagePlus, Loader2, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type SearchMode = "shop" | "sell"

const PLACEHOLDER: Record<SearchMode, string> = {
  shop: "Search for a product",
  sell: "What are you selling?",
}

type Props = {
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
  value: string
  onValueChange: (value: string) => void
  /** Enter or the search button: run now instead of waiting for typing to pause */
  onSubmit: () => void
  busy?: boolean
  /** Sell only: an optional photo for the listing */
  photo?: File | null
  onPhotoChange?: (file: File | null) => void
  autoFocus?: boolean
  className?: string
}

export default function SearchWithCategory({
  mode,
  onModeChange,
  value,
  onValueChange,
  onSubmit,
  busy,
  photo,
  onPhotoChange,
  autoFocus,
  className,
}: Props) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className={cn("w-full", className)}
    >
      <Label htmlFor={id} className="sr-only">
        {PLACEHOLDER[mode]}
      </Label>

      <div className="flex h-14 overflow-hidden rounded-md border border-input bg-black/70 backdrop-blur-md transition-colors duration-300 focus-within:border-brand/70">
        {/* Shop or Sell */}
        <Select value={mode} onValueChange={(v) => onModeChange(v as SearchMode)}>
          <SelectTrigger
            aria-label="Shop or sell"
            className="h-full w-[88px] shrink-0 rounded-none border-0 border-r border-input bg-transparent pl-3.5 pr-2.5 text-[15px] sm:w-[104px] sm:pl-4 sm:pr-3 font-medium text-foreground ring-offset-0 focus:ring-0 focus-visible:bg-white/5"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-input bg-popover">
            <SelectItem value="shop">Shop</SelectItem>
            <SelectItem value="sell">Sell</SelectItem>
          </SelectContent>
        </Select>

        {/* Search input */}
        <Input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={PLACEHOLDER[mode]}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-base sm:px-4 sm:text-[17px] shadow-none ring-offset-0 focus-visible:outline-none focus-visible:ring-0"
        />

        {/* Clear */}
        {value && (
          <div className="flex shrink-0 items-center pr-1">
            <button
              type="button"
              onClick={() => {
                onValueChange("")
                document.getElementById(id)?.focus()
              }}
              className="grid h-10 w-10 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Sell: optional photo */}
        {mode === "sell" && onPhotoChange && (
          <div className="flex shrink-0 items-center pr-1">
            {preview ? (
              <button
                type="button"
                onClick={() => onPhotoChange(null)}
                className="group relative h-10 w-10 overflow-hidden rounded-sm"
                aria-label="Remove photo"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="" className="h-full w-full object-cover" />
                <span className="absolute inset-0 grid place-items-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <X className="h-4 w-4" />
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="grid h-10 w-10 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Add a photo"
                title="Add a photo (optional)"
              >
                <ImagePlus className="h-5 w-5" strokeWidth={1.5} />
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

        {/* Search button */}
        <Button
          type="submit"
          aria-label={mode === "shop" ? "Search" : "Price it"}
          className="h-full w-14 shrink-0 rounded-none bg-brand p-0 text-black ring-offset-0 hover:bg-[#ff7440]"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" strokeWidth={2.25} />}
        </Button>
      </div>
    </form>
  )
}
