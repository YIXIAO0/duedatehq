"use client";

import type { SmartView } from "./dashboard-sidebar";

/**
 * 3 gradient KPI cards — Today / This week / All open. Carries the
 * urgency signal so the buckets below can stay calm. Cards are
 * clickable — each maps to the matching SmartView.
 */
export function KPICards({
  counts,
  view,
  onApplyView,
}: {
  counts: { today: number; thisWeek: number; overdue: number; all: number };
  view: SmartView;
  onApplyView: (v: SmartView) => void;
}) {
  // "All open" = total open across the loaded window. Not a true
  // calendar-month count — the dashboard windows 60 days ahead — but
  // it's the right approximation for "how full is the queue overall".
  const monthCount = counts.all;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KPICard
        label="Today"
        value={counts.today}
        sub={
          counts.overdue > 0
            ? `${counts.overdue} overdue · clear first`
            : counts.today === 0
              ? "All clear"
              : "Two estimated · one surcharge"
        }
        gradient="linear-gradient(135deg, #FFD0D0 0%, #FFE3D0 100%)"
        textColor="#8A2B2B"
        active={view === "today"}
        onClick={() => onApplyView("today")}
      />
      <KPICard
        label="This week"
        value={counts.thisWeek}
        sub={`${counts.thisWeek} through Sunday`}
        gradient="linear-gradient(135deg, #FFEFC9 0%, #FFE3D0 100%)"
        textColor="#8A6420"
        active={view === "thisWeek"}
        onClick={() => onApplyView("thisWeek")}
      />
      <KPICard
        label="All open"
        value={monthCount}
        sub={`${monthCount} total in your book`}
        gradient="linear-gradient(135deg, #D7E5F8 0%, #E0DAF6 100%)"
        textColor="#3F4F87"
        active={view === "all"}
        onClick={() => onApplyView("all")}
      />
    </div>
  );
}

function KPICard({
  label,
  value,
  sub,
  gradient,
  textColor,
  active,
  onClick,
}: {
  label: string;
  value: number;
  sub: string;
  gradient: string;
  textColor: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-2xl p-5 text-left transition-transform hover:scale-[1.01]",
        active ? "ring-2 ring-foreground/20 shadow-card" : "",
      ].join(" ")}
      style={{ background: gradient, color: textColor }}
    >
      <div
        className="text-[12px] uppercase tracking-wider"
        style={{ fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        className="text-[44px] leading-none mt-3"
        style={{ fontWeight: 700 }}
      >
        {value}
      </div>
      <div className="text-[12px] mt-2 opacity-75">{sub}</div>
    </button>
  );
}
