"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const TYPES = [
  { value: "", label: "Tất cả" },
  { value: "expense", label: "Chi" },
  { value: "income", label: "Thu" },
  { value: "transfer", label: "Chuyển ví" },
];

export function TxFilters({
  wallets,
  categories,
}: {
  wallets: { id: number; name: string }[];
  categories: { id: number; name: string; icon: string; type: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (patch: Record<string, string>) => {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const type = params.get("loai") ?? "";
  const hasFilters = ["loai", "vi", "dm", "q"].some((k) => params.get(k));

  return (
    <div className="space-y-3">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: q.trim() });
        }}
        className="relative"
      >
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q.trim() !== (params.get("q") ?? "") && update({ q: q.trim() })}
          placeholder="Tìm ghi chú, danh mục…"
          enterKeyHint="search"
          className="field pl-10"
        />
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className="chip shrink-0"
            aria-pressed={type === t.value}
            onClick={() => update({ loai: t.value, dm: "" })}
          >
            {t.label}
          </button>
        ))}
        <select
          aria-label="Lọc theo ví"
          value={params.get("vi") ?? ""}
          onChange={(e) => update({ vi: e.target.value })}
          className="chip shrink-0 appearance-none pr-3"
        >
          <option value="">Mọi ví</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Lọc theo danh mục"
          value={params.get("dm") ?? ""}
          onChange={(e) => update({ dm: e.target.value })}
          className="chip shrink-0 appearance-none pr-3"
        >
          <option value="">Mọi danh mục</option>
          {categories
            .filter((c) => !type || c.type === type)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            className="chip shrink-0"
            onClick={() => {
              setQ("");
              update({ loai: "", vi: "", dm: "", q: "" });
            }}
          >
            <X size={14} /> Bỏ lọc
          </button>
        )}
      </div>
    </div>
  );
}
