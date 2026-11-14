import { vendorById } from "@/lib/vendors";

export function VendorBadge({ id, name }: { id: string; name?: string }) {
  const v = vendorById(id);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
        v?.badge ?? "bg-stone-100 text-stone-700 ring-stone-200"
      }`}
    >
      {name ?? v?.name ?? id}
    </span>
  );
}
