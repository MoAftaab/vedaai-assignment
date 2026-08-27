"use client";
import Image from "next/image";
import {
  ClipboardList,
  FileText,
  LayoutGrid,
  MonitorPlay,
  PanelLeft,
  PieChart,
  Settings,
  Sparkles,
  ChevronsRight,
} from "lucide-react";
import { useStore } from "@/lib/store";

type NavItem = { icon: typeof LayoutGrid; label: string; active?: boolean };

const NAV: NavItem[] = [
  { icon: LayoutGrid, label: "Home" },
  { icon: MonitorPlay, label: "My Classroom" },
  { icon: FileText, label: "Assignments" },
  { icon: ClipboardList, label: "Exams", active: true },
  { icon: PieChart, label: "My Library" },
];

export default function Sidebar({ mobileOpen, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggle = useStore((s) => s.toggleSidebar);

  const responsive = mobileOpen
    ? "fixed inset-y-0 left-0 z-40 flex w-[280px]"
    : "hidden lg:flex";

  if (collapsed && !mobileOpen) {
    return (
      <aside className={`${responsive} shrink-0 flex-col items-center gap-1 rounded-r-[26px] bg-surface py-5 shadow-[6px_0_24px_rgba(0,0,0,0.04)]`}>
        <Image src="/veda-logo.png" alt="VedaAI" width={34} height={34} className="mb-3 rounded-[9px]" />
        <button
          type="button"
          className="mb-2 grid size-11 place-items-center rounded-full bg-brand text-white shadow-[0_4px_12px_rgba(252,72,24,0.35)]"
          title="AI Teacher's Toolkit"
        >
          <Sparkles className="size-5" />
        </button>
        {NAV.map((item) => (
          <button
            key={item.label}
            type="button"
            title={item.label}
            className={`grid size-11 place-items-center rounded-xl transition-colors ${
              item.active
                ? "bg-canvas text-ink"
                : "text-ink-45 hover:bg-canvas hover:text-ink-70"
            }`}
          >
            <item.icon className="size-[22px]" strokeWidth={1.8} />
          </button>
        ))}
        <div className="mt-auto flex flex-col items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-canvas text-[10px] font-bold text-emerald-700 ring-1 ring-line">
            DPS
          </div>
          <button
            type="button"
            onClick={toggle}
            title="Expand sidebar"
            className="grid size-9 place-items-center rounded-full text-ink-45 hover:bg-canvas hover:text-ink"
          >
            <ChevronsRight className="size-5" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <>
      {mobileOpen && <button type="button" aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-black/25 lg:hidden" />}
      <aside className={`${responsive} flex-col rounded-r-[26px] bg-surface px-5 py-6 shadow-[6px_0_24px_rgba(0,0,0,0.04)]`}>
      {/* Brand */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Image src="/veda-logo.png" alt="VedaAI" width={30} height={30} className="rounded-[8px]" />
          <span className="text-[20px] font-extrabold tracking-tight text-ink">VedaAI</span>
        </div>
        <button
          type="button"
          onClick={toggle}
          title="Collapse sidebar"
          className="grid size-8 place-items-center rounded-lg text-ink-45 hover:bg-canvas hover:text-ink"
        >
          <PanelLeft className="size-[18px]" />
        </button>
      </div>

      {/* AI Teacher's Toolkit */}
      <button
        type="button"
        className="mt-7 flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#3b3b3b] to-[#171717] py-3.5 text-[15px] font-semibold text-white shadow-[0_0_0_2px_rgba(252,72,24,0.4),0_6px_16px_rgba(0,0,0,0.18)]"
      >
        <Sparkles className="size-[18px] text-brand-300" />
        AI Teacher&apos;s Toolkit
      </button>

      {/* Nav */}
      <nav className="mt-8 flex flex-col gap-1.5">
        {NAV.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-[15px] font-medium transition-colors ${
              item.active
                ? "bg-canvas text-ink"
                : "text-ink-70 hover:bg-canvas/70 hover:text-ink"
            }`}
          >
            <item.icon className="size-[21px]" strokeWidth={1.9} />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Bottom */}
      <div className="mt-auto flex flex-col gap-4">
        <button
          type="button"
          className="flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-[15px] font-medium text-ink-70 transition-colors hover:bg-canvas/70 hover:text-ink"
        >
          <Settings className="size-[21px]" strokeWidth={1.9} />
          Settings
        </button>
        <div className="flex items-center gap-3 rounded-2xl bg-canvas/70 p-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[11px] font-bold text-emerald-700 ring-1 ring-line">
            DPS
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-ink">Delhi Public School</p>
            <p className="truncate text-[12px] text-ink-45">Bokaro Steel City</p>
          </div>
        </div>
      </div>
      </aside>
    </>
  );
}
