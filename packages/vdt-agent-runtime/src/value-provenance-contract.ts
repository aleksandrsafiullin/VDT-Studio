/** Shared admission limits and model instructions for user-supplied values. */
export const USER_VALUE_QUOTE_LIMITS = { minCharacters: 4, maxCharacters: 300 } as const;
export interface LiteralUserQuantity { value: number; quote: string; unit?: string | undefined }

/** Bound verbatim observations from user text. This does not bind a quote to
 * a node, classify it as a measurement, convert units, or write any value. */
export function collectLiteralUserQuantities(sources: readonly unknown[], currencyContext?: string): {
  quantities: LiteralUserQuantity[];
  truncated: boolean;
  complete: boolean;
} {
  const quantities: LiteralUserQuantity[] = [];
  let complete = true;
  const texts = new Set(sources.filter((text): text is string => typeof text === "string"));
  for (const text of texts) {
    const matches = [...text.matchAll(/[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?/g)];
    for (const [index, match] of matches.entries()) {
      const value = Number(match[0].replace(",", "."));
      const start = match.index!;
      const end = start + match[0].length;
      const previousEnd = index ? matches[index - 1]!.index! + matches[index - 1]![0].length : 0;
      const leftText = text.slice(previousEnd, start);
      const separator = Math.max(...[",", ";", ".", "!", "?", "\n"].map((char) => leftText.lastIndexOf(char)));
      const left = Math.max(previousEnd + separator + 1, start - 60);
      const next = Math.min(matches[index + 1]?.index ?? text.length, end + 90);
      const right = text.slice(end, next).split(/[,;.!?\n]/u)[0]!;
      const quote = text.slice(left, end + right.length).trim();
      if (!Number.isFinite(value) || quote.length < USER_VALUE_QUOTE_LIMITS.minCharacters
        || quote.length > 160 || !/\p{L}/u.test(quote)) {
        complete = false;
        continue;
      }
      if (quantities.some((item) => item.value === value && item.quote === quote)) continue;
      if (quantities.length === 30) return { quantities, truncated: true, complete: false };
      const unit = explicitQuotedInputUnit(quote, currencyContext, true);
      quantities.push({ value, quote, ...(unit ? { unit } : {}) });
    }
  }
  return { quantities, truncated: false, complete };
}

/** Retain an explicit percentage or per-item rate without changing its value.
 * A generic "dollar" only inherits USD from the selected brief. */
export function explicitQuotedInputUnit(quote: string, currencyContext?: string, includeSimpleUnits = false): string | undefined {
  if (/\d+(?:[.,]\d+)?\s*(?:%|percent(?:age)?|процент(?:а|ов)?)(?![\p{L}\p{N}]|\s*(?:\/|per\b|за\s))/iu.test(quote)) return "%";
  const match = quote.match(/\d+(?:[.,]\d+)?\s*(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF|US dollars?|dollars?|доллар(?:а|ов)?(?:\s+США)?|евро|тенге|рубл(?:ь|я|ей))(?:\s*\/\s*|\s+(?:per|за|for each)\s+)(?:(?:one|each|один|одну|каждый|каждую)\s+)?(?:items?|units?|products?|pieces?|товар(?:а|ов)?|единиц(?:а|у|ы)?|штук(?:а|у|и)?)(?=$|[\s,.!?;])/iu)
    ?? quote.match(/\b(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF)\s*\d+(?:[.,]\d+)?(?:\s*\/\s*|\s+(?:per|за|for each)\s+)(?:(?:one|each|один|одну|каждый|каждую)\s+)?(?:items?|units?|products?|pieces?|товар(?:а|ов)?|единиц(?:а|у|ы)?|штук(?:а|у|и)?)(?=$|[\s,.!?;])/iu);
  if (match) {
    const currency = explicitCurrency(match[1]!, currencyContext);
    return currency ? `${currency}/item` : undefined;
  }
  if (!includeSimpleUnits) return undefined;
  const money = quote.match(/\d+(?:[.,]\d+)?\s*(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF|US dollars?|dollars?|доллар(?:а|ов)?(?:\s+США)?|евро|тенге|рубл(?:ь|я|ей))(?![\p{L}\p{N}]|\s*(?:\/|per\b|за\s))/iu)
    ?? quote.match(/\b(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF)\s*\d+(?:[.,]\d+)?(?!\d|[.,]\d|\s*(?:\/|per\b|за\s|for each\b))/iu);
  if (money) return explicitCurrency(money[1]!, currencyContext);
  if (/\d+(?:[.,]\d+)?\s*(?:items?|units?|products?|pieces?|товар(?:а|ов)?|единиц(?:а|у|ы)?|штук(?:а|у|и)?)(?![\p{L}\p{N}]|\s*(?:\/|per\b|за\s))/iu.test(quote)) return "items";
  return undefined;
}

/** Normalize explicit item-count labels that the graph's unit algebra does
 * not already recognize as count. */
export function normalizeQuotedCountUnit(unit: string): string {
  return unit.replace(/(^|\/)\s*(?:products?|pieces?|товар(?:а|ов)?|единиц(?:а|у|ы)?|штук(?:а|у|и)?)\s*(?=\/|$)/giu, "$1items");
}

function explicitCurrency(value: string, currencyContext?: string): string | undefined {
  const currency = value.toUpperCase();
  if (/^(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF)$/.test(currency)) return currency;
  if (currency === "ЕВРО") return "EUR";
  if (currency === "ТЕНГЕ") return "KZT";
  if (currency.startsWith("РУБЛ")) return "RUB";
  if (currency.startsWith("US DOLLAR") || currency.endsWith(" США")
    || currencyContext?.split("/")[0]?.trim().toUpperCase() === "USD") return "USD";
  return undefined;
}

export const USER_VALUE_PROVENANCE_PROMPT_RULE =
  `For user_provided_value, the host requires either an answer keyed by that exact nodeId (including a question field with that id), or a VERBATIM single-quantity excerpt from this run's user text in valueSource.note (values[].note for vdt.fill_input_values_batch; source.note for excavation.write_input_value). The quote must be ${USER_VALUE_QUOTE_LIMITS.minCharacters}-${USER_VALUE_QUOTE_LIMITS.maxCharacters} characters, include words and the exact numeric value, and contain no different number. Do not paraphrase or prefix an unquoted explanation. A converted/computed value is not the original literal: preserve the source input and its unit and calculate any conversion explicitly. For example, a quoted 10% is input value 10 with unit %, and a formula divides that input by 100 when a decimal fraction is needed; do not write 0.1 as a literal user fact quoted from 10%. Never relabel a known user fact as default_assumption to bypass grounding. When asking for existing numeric inputs, use exact node IDs as question IDs or field IDs and specify their units. Use default_assumption only for actual authorized estimates with an explicit assumption note.`;
