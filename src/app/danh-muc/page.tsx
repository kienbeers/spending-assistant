import { Plus, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import {
  addKeywordAction,
  createCategoryAction,
  deleteCategoryAction,
  deleteKeywordAction,
  toggleCategoryFixedAction,
  updateCategoryAction,
} from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { getCategories, getKeywords } from "@/lib/repo";
import type { CategoryType } from "@/lib/seed";

export const metadata: Metadata = { title: "Danh mục" };

export default async function CategoriesPage({ searchParams }: PageProps<"/danh-muc">) {
  await connection();
  const { loai } = await searchParams;
  const type: CategoryType = loai === "income" ? "income" : "expense";
  const categories = getCategories().filter((c) => c.type === type);
  const keywords = getKeywords();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Danh mục & từ khóa</h1>
        <p className="text-[13px] text-ink-3">
          Khi nhập nhanh, câu chứa từ khóa sẽ tự vào danh mục đó (từ khóa dài được ưu tiên). App cũng tự học khi
          bạn chọn danh mục cho một ghi chú ngắn.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
        {(["expense", "income"] as const).map((t) => (
          <Link
            key={t}
            href={t === "income" ? "/danh-muc?loai=income" : "/danh-muc"}
            aria-current={type === t ? "page" : undefined}
            className="flex min-h-10 items-center justify-center rounded-lg text-sm font-medium text-ink-3 aria-[current=page]:bg-surface aria-[current=page]:text-ink aria-[current=page]:shadow-sm"
          >
            {t === "expense" ? "Khoản chi" : "Khoản thu"}
          </Link>
        ))}
      </div>

      <ul className="space-y-2">
        {categories.map((c) => {
          const own = keywords.filter((k) => k.categoryId === c.id);
          return (
            <li key={c.id} className="card p-4">
              <details className="group">
                <summary className="flex cursor-pointer items-center gap-2">
                  <span className="text-xl" aria-hidden>
                    {c.icon}
                  </span>
                  <span className="flex-1 font-medium">
                    {c.name}
                    {c.isFixed && (
                      <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-normal text-ink-3">
                        cố định
                      </span>
                    )}
                  </span>
                  <span className="text-[13px] text-ink-3 group-open:hidden">Sửa</span>
                  <span className="hidden text-[13px] text-ink-3 group-open:inline">Đóng</span>
                </summary>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <form action={updateCategoryAction} className="flex min-w-0 flex-1 items-end gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <div className="w-16">
                      <label className="label" htmlFor={`icon-${c.id}`}>
                        Biểu tượng
                      </label>
                      <input id={`icon-${c.id}`} name="icon" defaultValue={c.icon} className="field text-center" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="label" htmlFor={`name-${c.id}`}>
                        Tên
                      </label>
                      <input id={`name-${c.id}`} name="name" defaultValue={c.name} required className="field" />
                    </div>
                    <button className="btn-primary">Lưu</button>
                  </form>
                  {type === "expense" && (
                    <form action={toggleCategoryFixedAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="isFixed" value={c.isFixed ? "0" : "1"} />
                      <button className="btn-ghost text-sm" title="Khoản cố định hằng tháng như tiền nhà, hóa đơn">
                        {c.isFixed ? "Bỏ cố định" : "Đặt là cố định"}
                      </button>
                    </form>
                  )}
                  <form action={deleteCategoryAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <ConfirmButton
                      message={`Xóa danh mục “${c.name}”? Các giao dịch cũ sẽ thành “Chưa phân loại”.`}
                      className="btn-ghost text-expense"
                    >
                      Xóa
                    </ConfirmButton>
                  </form>
                </div>
              </details>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {own.map((k) => (
                  <form key={k.id} action={deleteKeywordAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <button
                      className="inline-flex min-h-8 items-center gap-1 rounded-full bg-surface-2 py-1 pr-1.5 pl-2.5 text-[13px] text-ink-2 transition active:scale-95"
                      aria-label={`Xóa từ khóa ${k.keyword}`}
                    >
                      {k.keyword}
                      <X size={13} className="text-ink-3" />
                    </button>
                  </form>
                ))}
                <form action={addKeywordAction} className="flex items-center gap-1">
                  <input type="hidden" name="categoryId" value={c.id} />
                  <input
                    name="keyword"
                    required
                    maxLength={60}
                    placeholder="+ từ khóa"
                    aria-label={`Thêm từ khóa cho ${c.name}`}
                    autoCapitalize="none"
                    enterKeyHint="done"
                    className="h-8 w-28 rounded-full border border-dashed border-line bg-transparent px-3 text-base outline-none placeholder:text-ink-3 focus:border-accent md:text-[13px]"
                  />
                </form>
              </div>
            </li>
          );
        })}
      </ul>

      <details className="card">
        <summary className="flex min-h-14 cursor-pointer items-center gap-2 px-4 font-medium text-accent">
          <Plus size={18} /> Thêm danh mục {type === "expense" ? "chi" : "thu"}
        </summary>
        <form action={createCategoryAction} className="flex items-end gap-2 border-t border-line p-4">
          <input type="hidden" name="type" value={type} />
          <div className="w-16">
            <label className="label" htmlFor="new-icon">
              Biểu tượng
            </label>
            <input id="new-icon" name="icon" defaultValue="📦" className="field text-center" />
          </div>
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="new-name">
              Tên
            </label>
            <input id="new-name" name="name" required maxLength={50} className="field" />
          </div>
          <button className="btn-primary">Thêm</button>
        </form>
      </details>
    </div>
  );
}
