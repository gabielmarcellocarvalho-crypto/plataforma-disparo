"use client";

import { useTransition } from "react";
import { deleteAccess } from "@/app/actions/access";

export function AccessRowActions({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const [pending, startTransition] = useTransition();

  if (isSelf) return <span className="text-xs text-text-muted">você</span>;

  return (
    <button
      type="button"
      onClick={() => startTransition(async () => void (await deleteAccess(userId)))}
      disabled={pending}
      className="text-xs font-semibold text-danger hover:underline disabled:opacity-60 cursor-pointer"
    >
      remover
    </button>
  );
}
