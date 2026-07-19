"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { reviewTitle } from "./actions";

export function ReviewControls({ titleId }: { titleId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: "approve" | "reject") {
    if (decision === "reject" && !reason.trim()) {
      setError("A reason is required to reject.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await reviewTitle(titleId, decision, reason);
    if (res?.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Rejection reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required to reject)"
        />
        <Button onClick={() => decide("approve")} disabled={busy} className="shrink-0">
          Approve
        </Button>
        <Button
          onClick={() => decide("reject")}
          disabled={busy}
          variant="secondary"
          className="shrink-0"
        >
          Reject
        </Button>
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
