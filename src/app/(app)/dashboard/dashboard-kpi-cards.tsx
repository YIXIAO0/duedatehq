"use client";

import type { SmartView } from "./dashboard-sidebar";

/**
 * 3 gradient KPI cards — Today / This week / Next 60 days. All three
 * are time-window counts, naming kept parallel so the third card
 * doesn't sound like a lifetime metric (the dashboard query only
 * loads 60 days ahead). Cards are clickable — each maps to a
 * matching SmartView.
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
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KPICard
        label="Today"
        value={counts.today}
        gradient="linear-gradient(135deg, #FFD0D0 0%, #FFE3D0 100%)"
        textColor="#8A2B2B"
        active={view === "today"}
        onClick={() => onApplyView("today")}
      />
      <KPICard
        label="This week"
        value={counts.thisWeek}
        gradient="linear-gradient(135deg, #FFEFC9 0%, #FFE3D0 100%)"
        textColor="#8A6420"
        active={view === "thisWeek"}
        onClick={() => onApplyView("thisWeek")}
      />
      <KPICard
        label="Next 60 days"
        value={counts.all}
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
  gradient,
  textColor,
  active,
  onClick,
}: {
  label: string;
  value: number;
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
    </button>
  );
}
