"use client";

import { useTransition } from "react";
import { updateAccessType } from "@/app/actions/access";
import { ACCESS_TYPES, type AccessType } from "@/lib/access-types";

export function AccessTypeEditor({ userId, current }: { userId: string; current: AccessType | null }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={current ?? ""}
      disabled={pending}
      onChange={(e) => startTransition(async () => void (await updateAccessType(userId, e.target.value)))}
      className="border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary bg-surface disabled:opacity-60"
    >
      <option value="" disabled>
        não classificado
      </option>
      {ACCESS_TYPES.map((t) => (
        <option key={t.key} value={t.key}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
