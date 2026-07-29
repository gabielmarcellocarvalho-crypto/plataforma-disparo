"use client";

import { useState } from "react";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type Cell = { key: string; day: number; inMonth: boolean };

function buildMonthGrid(viewYear: number, viewMonth: number): Cell[] {
  const firstWeekday = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();

  const cells: Cell[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const d = new Date(Date.UTC(viewYear, viewMonth - 1, day));
    cells.push({ key: d.toISOString().slice(0, 10), day, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(viewYear, viewMonth, day));
    cells.push({ key: d.toISOString().slice(0, 10), day, inMonth: true });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    const d = new Date(Date.UTC(viewYear, viewMonth + 1, nextDay));
    cells.push({ key: d.toISOString().slice(0, 10), day: nextDay, inMonth: false });
    nextDay++;
  }
  return cells;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

export function GlassCalendar({
  start,
  end,
  onChange,
}: {
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
}) {
  const initial = start ? new Date(`${start}T00:00:00Z`) : new Date();
  const [viewYear, setViewYear] = useState(initial.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getUTCMonth());
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const cells = buildMonthGrid(viewYear, viewMonth);
  const today = todayKey();
  const previewEnd = start && !end && hoverKey && hoverKey >= start ? hoverKey : null;
  const effectiveEnd = end || previewEnd;

  function changeMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  }

  function handlePick(key: string) {
    if (!start || (start && end)) {
      onChange(key, null);
    } else if (key >= start) {
      onChange(start, key);
    } else {
      onChange(key, null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-0.5">
        <button
          type="button"
          onClick={() => changeMonth(-1)}
          aria-label="Mês anterior"
          className="grid place-items-center w-7 h-7 rounded-full text-text-muted hover:bg-white/60 hover:text-primary-strong cursor-pointer transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="text-sm font-bold text-text">
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={() => changeMonth(1)}
          aria-label="Próximo mês"
          className="grid place-items-center w-7 h-7 rounded-full text-text-muted hover:bg-white/60 hover:text-primary-strong cursor-pointer transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="h-7 grid place-items-center text-[10px] font-bold text-text-muted">
            {w}
          </span>
        ))}
        {cells.map((c) => {
          const isStart = c.key === start;
          const isEnd = c.key === effectiveEnd;
          const inRange = Boolean(start && effectiveEnd && c.key > start && c.key < effectiveEnd);
          const isEndpoint = isStart || isEnd;
          const isToday = c.key === today;

          let bandClass = "";
          if (isStart && isEnd) bandClass = "";
          else if (isStart) bandClass = effectiveEnd ? "bg-primary/15 rounded-l-full" : "";
          else if (isEnd) bandClass = "bg-primary/15 rounded-r-full";
          else if (inRange) bandClass = "bg-primary/15";

          return (
            <div key={c.key} className={`h-9 flex items-center justify-center ${bandClass}`}>
              <button
                type="button"
                disabled={!c.inMonth}
                onClick={() => handlePick(c.key)}
                onMouseEnter={() => setHoverKey(c.key)}
                className={`w-7 h-7 grid place-items-center rounded-full text-xs font-semibold transition-colors ${
                  !c.inMonth
                    ? "text-text-muted/30 cursor-default"
                    : isEndpoint
                    ? "bg-primary-strong text-white shadow-sm cursor-pointer"
                    : isToday
                    ? "text-primary-strong ring-1 ring-primary/50 cursor-pointer hover:bg-white/70"
                    : "text-text cursor-pointer hover:bg-white/70"
                }`}
              >
                {c.day}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
