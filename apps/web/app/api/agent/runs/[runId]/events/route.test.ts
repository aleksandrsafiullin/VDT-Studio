import { describe, expect, it } from "vitest";
import { sequenceFromLastEventId } from "./route";

const HASH_1 = `sha256:${"1".repeat(64)}`;
const HASH_2 = `sha256:${"2".repeat(64)}`;

const verifiedReplay = [
  { id: "run-1:1", seq: 1, hash: HASH_1, previousHash: null },
  { id: "run-1:2", seq: 2, hash: HASH_2, previousHash: HASH_1 }
] as const;

describe("agent run SSE replay cursor", () => {
  it("resumes after an exact event ID or an existing sequence anchor", () => {
    const cursor = sequenceFromLastEventId("run-1:1", verifiedReplay);
    expect(cursor).toBe(1);
    expect(sequenceFromLastEventId("1", verifiedReplay)).toBe(1);
    expect(verifiedReplay.filter((event) => event.seq > cursor)).toEqual([
      expect.objectContaining({ seq: 2, hash: HASH_2, previousHash: HASH_1 })
    ]);
  });

  it.each(["3", "9007199254740992", "missing-event-id", "-1"])(
    "replays from zero for an ahead, unsafe, or missing cursor %s",
    (lastEventId) => {
      const cursor = sequenceFromLastEventId(lastEventId, verifiedReplay);
      expect(cursor).toBe(0);
      expect(verifiedReplay.filter((event) => event.seq > cursor)).toEqual(verifiedReplay);
    }
  );

  it("does not trust a positive cursor when the durable replay is empty", () => {
    expect(sequenceFromLastEventId("1", [])).toBe(0);
  });
});
