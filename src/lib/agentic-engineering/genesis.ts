/** Genesis prev_event_digest for sequence 1 (spec §4.5.4). Not a content hash. */
export function genesisPrevEventDigest(taskId: string): string {
  return `sha256:genesis:ae-control:${taskId}`;
}
