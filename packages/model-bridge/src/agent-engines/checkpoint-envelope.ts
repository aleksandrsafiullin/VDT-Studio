export interface CheckpointEnvelopeError extends Error {
  readonly code: string;
}

export interface CheckpointEnvelopeCandidate {
  readonly start: number;
  readonly end: number;
  readonly payload: string;
}

function envelopeError(code: string, message: string): CheckpointEnvelopeError {
  return Object.assign(new Error(message), { code });
}

interface TextSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface FenceSpan extends TextSpan {
  readonly innerStart: number;
}

const CLOSED_FENCE = /```[^\n`]*\r?\n([\s\S]*?)```/g;

/**
 * Bounded transport unwrap. Does not rewrite JSON contents.
 *
 * A candidate is either one closed markdown fence or one balanced top-level
 * `{...}` object outside any fence. More than one candidate is ambiguous.
 * A payload that is already a single object spanning the trimmed text is
 * taken as-is so fences inside string values cannot be mistaken for envelopes.
 */
export function unwrapCheckpointEnvelope(raw: string, errorPrefix: string): string {
  const candidates = collectCheckpointEnvelopeCandidates(raw);
  if (candidates.length > 1) {
    throw envelopeError(
      `${errorPrefix}_PROTOCOL_AMBIGUOUS`,
      `Checkpoint result is ambiguous: found ${candidates.length} candidate JSON objects.`
    );
  }
  if (candidates.length === 1) return candidates[0]!.payload;
  throw envelopeError(
    `${errorPrefix}_PROTOCOL_INVALID`,
    "Checkpoint result must be exactly one JSON object without prose or fences."
  );
}

/** All fence payloads and top-level `{...}` objects the unwrap already finds. */
export function collectCheckpointEnvelopeCandidates(raw: string): CheckpointEnvelopeCandidate[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return collectFromText(trimmed);
}

function collectFromText(text: string): CheckpointEnvelopeCandidate[] {
  const candidates: CheckpointEnvelopeCandidate[] = [];
  if (text.startsWith("{")) {
    const end = scanBalancedObject(text, 0);
    if (end !== -1) {
      candidates.push({ start: 0, end, payload: text.slice(0, end) });
      appendLeftoverCandidates(candidates, text.slice(end), end);
      return candidates;
    }
  }

  const fences = findClosedFences(text);
  for (const fence of fences) appendFenceCandidates(candidates, fence);
  for (const object of findTopLevelObjects(text, fences)) {
    candidates.push({ start: object.start, end: object.end, payload: object.text });
  }
  return candidates;
}

function appendLeftoverCandidates(
  candidates: CheckpointEnvelopeCandidate[],
  leftover: string,
  offset: number
): void {
  const fences = findClosedFences(leftover);
  for (const fence of fences) {
    appendFenceCandidates(candidates, {
      start: offset + fence.start,
      end: offset + fence.end,
      innerStart: offset + fence.innerStart,
      text: fence.text
    });
  }
  for (const object of findTopLevelObjects(leftover, fences)) {
    candidates.push({
      start: offset + object.start,
      end: offset + object.end,
      payload: object.text
    });
  }
}

function appendFenceCandidates(candidates: CheckpointEnvelopeCandidate[], fence: FenceSpan): void {
  const inner = fence.text;
  const trimmedInner = inner.trim();
  const innerCandidates = collectFromText(trimmedInner);
  if (innerCandidates.length === 0) return;
  if (innerCandidates.length === 1) {
    candidates.push({
      start: fence.start,
      end: fence.end,
      payload: innerCandidates[0]!.payload
    });
    return;
  }
  const innerAbsStart = fence.innerStart + leadingWhitespaceLength(inner);
  for (const candidate of innerCandidates) {
    candidates.push({
      start: innerAbsStart + candidate.start,
      end: innerAbsStart + candidate.end,
      payload: candidate.payload
    });
  }
}

function leadingWhitespaceLength(value: string): number {
  return value.length - value.trimStart().length;
}

function findClosedFences(text: string): FenceSpan[] {
  const fences: FenceSpan[] = [];
  const matcher = new RegExp(CLOSED_FENCE.source, CLOSED_FENCE.flags);
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const full = match[0];
    const inner = match[1] ?? "";
    fences.push({
      start: match.index,
      end: match.index + full.length,
      innerStart: match.index + full.length - inner.length - 3,
      text: inner
    });
  }
  return fences;
}

function findTopLevelObjects(text: string, excluded: readonly TextSpan[]): TextSpan[] {
  const objects: TextSpan[] = [];
  let index = 0;
  while (index < text.length) {
    if (excluded.some((span) => index >= span.start && index < span.end)) {
      index += 1;
      continue;
    }
    if (text[index] === "{") {
      const end = scanBalancedObject(text, index);
      if (end === -1) break;
      objects.push({ start: index, end, text: text.slice(index, end) });
      index = end;
      continue;
    }
    index += 1;
  }
  return objects;
}

function scanBalancedObject(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}
