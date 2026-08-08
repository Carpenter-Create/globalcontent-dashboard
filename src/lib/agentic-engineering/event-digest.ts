import { createHash } from "node:crypto";

import { canonicalJsonBytes, omitKeys } from "./canonical-json";
import { sha256DigestSchema } from "./contract-schema";
import {
  parseControlEvent,
  parseControlEventPreimage,
  type ControlEvent,
  type ControlEventPreimage,
} from "./event-schema";

/**
 * event_digest = sha256(canonical event bytes excluding event_digest)
 * Existing `event_digest` on the input is ignored for recomputation.
 */
export function computeEventDigest(
  event: ControlEventPreimage | ControlEvent | Omit<ControlEvent, "event_digest">,
): string {
  const withoutDigest = omitKeys(event as Record<string, unknown>, [
    "event_digest",
  ]);
  const preimage = parseControlEventPreimage(withoutDigest);
  const bytes = canonicalJsonBytes(preimage);
  const hex = createHash("sha256").update(bytes).digest("hex");
  return sha256DigestSchema.parse(`sha256:${hex}`);
}

export function withEventDigest(event: ControlEventPreimage): ControlEvent {
  const preimage = parseControlEventPreimage(event);
  return parseControlEvent({
    ...preimage,
    event_digest: computeEventDigest(preimage),
  });
}

export function eventDigestMatches(event: ControlEvent): boolean {
  return computeEventDigest(event) === event.event_digest;
}
