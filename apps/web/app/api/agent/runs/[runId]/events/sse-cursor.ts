export function sequenceFromLastEventId(
  lastEventId: string | null,
  events: ReadonlyArray<{ id: string; seq: number }>
): number {
  if (!lastEventId) return 0;
  const exact = events.find((event) => event.id === lastEventId);
  if (exact && Number.isSafeInteger(exact.seq) && exact.seq > 0) return exact.seq;
  if (/^\d+$/.test(lastEventId)) {
    const parsed = Number(lastEventId);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
    if (parsed === 0) return 0;
    // A header-only sequence is trusted only when the already verified durable
    // replay contains its anchor. This makes an ahead-of-head or missing cursor
    // fail safe by replaying from sequence zero instead of suppressing all data.
    return events.some((event) => event.seq === parsed) ? parsed : 0;
  }
  return 0;
}
