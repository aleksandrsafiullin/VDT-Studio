const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

function findBalancedObject(value: string): string | undefined {
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return value.slice(start, index + 1);
    }
  }
  return undefined;
}

export function extractBoundedJson(raw: string, maxBytes: number): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  if (byteLength(raw) > maxBytes) throw new Error(`Model output exceeds ${maxBytes} bytes.`);

  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const object = findBalancedObject(candidate);
    if (!object) throw new Error("Model output did not contain one complete JSON object.");
    try {
      return JSON.parse(object) as unknown;
    } catch {
      throw new Error("Model output contained malformed JSON.");
    }
  }
}
