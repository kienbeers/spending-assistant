import { Flag, Plus, TrendingDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { createPlanAction, deletePlanAction, setPlanStatusAction, updatePlanAction } from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { PlanAi } from "@/components/plan-ai";
import { getAi } from "@/lib/ai";
import { buildDebtStrategy } from "@/lib/debt-plan";
import { formatVND, todayVN } from "@/lib/format";
import { buildPlanFrame, getPlans, type Plan } from "@/lib/planning";
import { getWallets } from "@/lib/repo";

export const metadata: Metadata = { title: "Mục tiêu" };

const monthVN = (m: string) => `${Number(m.slice(5, 7))}/${m.slice(0, 4)}`;

const KIND_LABEL = {
  "interest-only": "vay lãi ngoài",
  installment: "trả góp",
  card: "thẻ tín dụng",
  free: "không lãi",
} as const;

export default async function GoalsPage() {
  await connection();
  const today = todayVN();
  const plans = getPlans();
  const active = plans.filter((p) => p.status === "active");
  const done = plans.filter((p) => p.status !== "active");

  const frame = buildPlanFrame(today.slice(0, 7));
  const base = buildDebtStrategy(0);
  const leftAfterRequired = frame.expectedIncome - base.requiredMonthly;
  const cash = getWallets()
    .filter((w) => w.kind !== "credit")
    .reduce((s, w) => s + w.balance, 0);

  // So sánh vài mức dồn tiền để thấy khác biệt
  const options = [0, 1_000_000, 2_000_000, 3_000_000, 5_000_000].map((extra) => ({
    extra,
    result: buildDebtStrategy(extra),
  }));

  const ai = getAi();
  const aiStatus = await ai.check();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Mục tiêu & định hướng</h1>
        <p className="text-[13px] text-ink-3">
          Số liệu do app tính, AI chỉ diễn giải và nhắc việc. Mọi con số dưới đây lấy từ nợ, thu nhập và chi tiêu thật
          của bạn.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <TrendingDown size={18} className="text-accent" /> Tình hình hiện tại
        </h2>
        <dl className="space-y-1.5 text-[14px] tabular-nums">
          <Row label="Thu nhập mỗi tháng" value={frame.expectedIncome} />
          <Row label="Phải trả bắt buộc" value={-base.requiredMonthly} />
          <Row label="Trong đó tiền lãi mất trắng" value={-base.interestMonthly} muted />
          <div className="flex items-baseline justify-between border-t border-line pt-2 font-semibold">
            <dt>Còn lại để sống và trả nợ</dt>
            <dd className={leftAfterRequired < 0 ? "text-expense" : ""}>
              {leftAfterRequired < 0 && "−"}
              {formatVND(Math.abs(leftAfterRequired))}
            </dd>
          </div>
          <Row label="Tổng đang nợ" value={-base.totalOutstanding} />
          <Row label="Tiền đang có" value={cash} />
        </dl>
      </section>

      <section className="card overflow-hidden">
        <div className="p-4 pb-2">
          <h2 className="font-semibold">Nên trả khoản nào trước</h2>
          <p className="text-[13px] text-ink-3">Xếp theo lãi quy đổi mỗi năm, cao nhất lên đầu</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-md text-[13px] whitespace-nowrap tabular-nums">
            <thead className="text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Khoản
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Còn nợ
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Bắt buộc/tháng
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Lãi/năm
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {base.debts.map((d, i) => (
                <tr key={d.key}>
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    {d.canPrepay && i < 3 && <span className="mr-1 text-accent">#{i + 1}</span>}
                    {d.name}
                    <span className="block text-[11px] font-normal text-ink-3">{KIND_LABEL[d.kind]}</span>
                  </th>
                  <td className="px-2 py-2 text-right">{formatVND(d.outstanding)}</td>
                  <td className="px-2 py-2 text-right">{d.required ? formatVND(d.required) : "—"}</td>
                  <td
                    className={`px-4 py-2 text-right font-medium ${(d.yearlyRate ?? 0) >= 30 ? "text-expense" : "text-ink-3"}`}
                  >
                    {d.yearlyRate ? `${d.yearlyRate}%` : "0%"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[13px] text-ink-2">
          Thứ tự dồn tiền: <b>{base.priority.map((d) => d.name).join(" → ") || "—"}</b>. Trả trước khoản lãi cao giúp
          giảm ngay tiền lãi hằng tháng.
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="p-4 pb-2">
          <h2 className="font-semibold">Dồn thêm mỗi tháng thì bao giờ hết nợ</h2>
          <p className="text-[13px] text-ink-3">Tính theo cách trả khoản lãi cao trước</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-md text-[13px] whitespace-nowrap tabular-nums">
            <thead className="text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Dồn thêm
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Hết nợ sau
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Khoảng tháng
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Tổng lãi phải trả
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {options.map(({ extra, result }) => (
                <tr key={extra}>
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    {extra === 0 ? "Không dồn" : formatVND(extra)}
                  </th>
                  <td className="px-2 py-2 text-right">
                    {result.monthsToDebtFree === null ? "hơn 10 năm" : `${result.monthsToDebtFree} tháng`}
                  </td>
                  <td className="px-2 py-2 text-right text-ink-3">
                    {result.debtFreeMonth ? monthVN(result.debtFreeMonth) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{formatVND(result.totalInterest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 font-semibold">Mục tiêu của bạn</h2>
        {active.length === 0 ? (
          <p className="card px-4 py-5 text-center text-sm text-ink-3">
            Chưa có mục tiêu nào. Ví dụ: “Hết nợ lãi ngoài trong 6 tháng”, “Để dành 20 triệu trước Tết”.
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((p) => (
              <li key={p.id}>
                <PlanCard plan={p} aiReady={aiStatus.ok} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="card">
        <summary className="flex min-h-14 cursor-pointer items-center gap-2 px-4 font-medium text-accent">
          <Plus size={18} /> Thêm mục tiêu
        </summary>
        <form action={createPlanAction} className="space-y-3 border-t border-line p-4">
          <PlanFields />
          <button className="btn-primary w-full">Thêm mục tiêu</button>
        </form>
      </details>

      {done.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer text-sm font-medium text-ink-3">
            Mục tiêu đã xong / đã bỏ ({done.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {done.map((p) => (
              <li key={p.id}>
                <PlanCard plan={p} aiReady={aiStatus.ok} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="px-1 text-[13px] text-ink-3">
        Xem thêm:{" "}
        <Link href="/ke-hoach" className="text-accent">
          Ngân sách tháng
        </Link>{" "}
        ·{" "}
        <Link href="/no" className="text-accent">
          Sổ nợ
        </Link>
      </p>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={muted ? "text-[13px] text-ink-3" : "text-ink-3"}>{label}</dt>
      <dd className={muted ? "text-[13px] text-ink-3" : ""}>
        {value < 0 && "−"}
        {formatVND(Math.abs(value))}
      </dd>
    </div>
  );
}

function PlanCard({ plan: p, aiReady }: { plan: Plan; aiReady: boolean }) {
  const strategy = buildDebtStrategy(p.extraPerMonth);
  return (
    <div className="card p-4">
      <div className="flex items-baseline gap-2">
        <Flag size={16} className="shrink-0 self-center text-accent" />
        <h3 className="min-w-0 flex-1 font-medium">{p.title}</h3>
        {p.status !== "active" && (
          <span className="text-[12px] text-ink-3">{p.status === "done" ? "đã xong" : "đã bỏ"}</span>
        )}
      </div>
      {p.goalText && <p className="mt-1 text-[13px] text-ink-2">{p.goalText}</p>}
      <p className="mt-1 flex flex-wrap gap-x-2 text-[12px] text-ink-3 tabular-nums">
        {p.targetAmount ? <span>cần {formatVND(p.targetAmount)}</span> : null}
        {p.targetDate ? (
          <span>
            · hạn {p.targetDate.slice(8, 10)}/{p.targetDate.slice(5, 7)}/{p.targetDate.slice(0, 4)}
          </span>
        ) : null}
        <span>· dồn thêm {formatVND(p.extraPerMonth)}/tháng</span>
        <span>
          ·{" "}
          {strategy.monthsToDebtFree === null
            ? "hơn 10 năm mới hết nợ"
            : `hết nợ sau ${strategy.monthsToDebtFree} tháng (${monthVN(strategy.debtFreeMonth!)})`}
        </span>
      </p>

      {p.status === "active" && (
        <PlanAi planId={p.id} aiReady={aiReady} saved={p.aiContent ? { content: p.aiContent, at: p.aiAt } : null} />
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] text-ink-3">Sửa mục tiêu</summary>
        <form action={updatePlanAction} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={p.id} />
          <PlanFields plan={p} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary flex-1 text-sm">Lưu</button>
            <ConfirmButton
              message={`Xóa mục tiêu “${p.title}”?`}
              formAction={deletePlanAction}
              className="btn-ghost text-sm text-expense"
            >
              Xóa
            </ConfirmButton>
          </div>
        </form>
        <form action={setPlanStatusAction} className="mt-2">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="status" value={p.status === "active" ? "done" : "active"} />
          <button className="text-[12px] text-ink-3 underline-offset-2 hover:underline">
            {p.status === "active" ? "Đánh dấu đã xong" : "Mở lại mục tiêu"}
          </button>
        </form>
      </details>
    </div>
  );
}

function PlanFields({ plan }: { plan?: Plan }) {
  const k = plan?.id ?? "new";
  return (
    <>
      <div>
        <label className="label" htmlFor={`p-title-${k}`}>
          Mục tiêu
        </label>
        <input
          id={`p-title-${k}`}
          name="title"
          required
          maxLength={120}
          defaultValue={plan?.title}
          placeholder="vd: Hết nợ lãi ngoài trong 6 tháng"
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor={`p-text-${k}`}>
          Mô tả thêm <span className="font-normal">(không bắt buộc)</span>
        </label>
        <input
          id={`p-text-${k}`}
          name="goalText"
          maxLength={1000}
          defaultValue={plan?.goalText}
          placeholder="vd: ưu tiên trả anh Tuân và em Nguyên trước"
          className="field"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`p-amount-${k}`}>
            Số tiền cần <span className="font-normal">(nếu có)</span>
          </label>
          <input
            id={`p-amount-${k}`}
            name="targetAmount"
            inputMode="numeric"
            defaultValue={plan?.targetAmount ?? ""}
            className="field tabular-nums"
          />
        </div>
        <div>
          <label className="label" htmlFor={`p-date-${k}`}>
            Hạn <span className="font-normal">(nếu có)</span>
          </label>
          <input
            id={`p-date-${k}`}
            type="date"
            name="targetDate"
            defaultValue={plan?.targetDate ?? ""}
            className="field"
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`p-extra-${k}`}>
          Mỗi tháng dồn thêm để trả nợ
        </label>
        <input
          id={`p-extra-${k}`}
          name="extraPerMonth"
          inputMode="numeric"
          defaultValue={plan?.extraPerMonth ?? ""}
          placeholder="vd: 2000000"
          className="field tabular-nums"
        />
      </div>
    </>
  );
}
