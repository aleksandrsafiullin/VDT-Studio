/** Shared admission limits and model instructions for user-supplied values. */
export const USER_VALUE_QUOTE_LIMITS = { minCharacters: 4, maxCharacters: 300 } as const;
export interface LiteralUserQuantity { value: number; quote: string; unit?: string | undefined }

const CARDINALS = new Map([
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty",
  "ноль|нуль один|одна|одно два|две три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать семнадцать восемнадцать девятнадцать двадцать"
].flatMap((language) => language.split(" ").flatMap((forms, value) => forms.split("|").map((word) => [word, value] as const))));
const NUMBER_WORD = [...CARDINALS.keys(), ...(
  "thirty forty fifty sixty seventy eighty ninety hundred thousand million billion тридцать сорок пятьдесят шестьдесят семьдесят восемьдесят девяносто сто двести триста четыреста пятьсот шестьсот семьсот восемьсот девятьсот тысяча тысячи тысяч миллион миллиона миллионов миллиард миллиарда миллиардов"
).split(" ")].join("|");
const WORD = String.raw`(?:${NUMBER_WORD})(?![\p{L}\p{N}])`;
const CARDINAL = String.raw`(?<![\p{L}\p{N}-])(?:(?:minus|negative|минус)[ \t]+)?${WORD}(?:[ \t-]+(?:(?:and|point|и|целая|целых)[ \t]+)?${WORD})*(?:[ \t]+(?:and a half|с половиной)(?!\p{L}))?(?!-)`;
const LITERAL_NUMBER = new RegExp(String.raw`([-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?)|${CARDINAL}`, "giu");
const COUNT_WORD = String.raw`items?|units?|products?|pieces?|records?|recordings?|manuscripts?|documents?|товар(?:а|ов)?|единиц(?:а|у|ы)?|штук(?:а|у|и)?|запис(?:ь|и|ей)|рукопис(?:ь|и|ей)|документ(?:а|ов)?`;
const SOURCE_COUNT = new RegExp(String.raw`^\s*(?:${COUNT_WORD})(?![\p{L}\p{N}]|\s*(?:\/|per\b|за\s))`, "iu");
const COUNT_ALIAS = new RegExp(String.raw`(^|\/)\s*(?:${COUNT_WORD})\s*(?=\/|$)`, "giu");
const TIME_UNITS = [
  ["min", String.raw`min(?:utes?)?|мин(?:ут(?:а|у|ы)?)?`],
  ["h", String.raw`h(?:ours?)?|hrs?|ч(?:ас(?:а|ов)?)?`],
  ["s", String.raw`s(?:ec(?:onds?)?)?|с(?:ек(?:унд(?:а|у|ы)?)?)?`],
  ["day", String.raw`days?|день|дня|дней|сут(?:ки|ок)`]
] as const;
const TIME_UNIT = new RegExp(String.raw`^\s*(${TIME_UNITS.map(([, pattern]) => `(?:${pattern})`).join("|")})(?![\p{L}\p{N}])`, "iu");
const TIME_ALIAS = TIME_UNITS.map(([unit, pattern]) => [unit, new RegExp(`^(?:${pattern})$`, "iu")] as const);
const PERIOD_ALIASES = ([
  ["day", String.raw`days?|день|дня|сут(?:ки|ок)`],
  ["week", String.raw`weeks?|недел(?:я|ю|и|ь)`],
  ["month", String.raw`months?|месяц(?:а|ев)?`],
  ["year", String.raw`years?|год(?:а)?|лет`],
  ["shift", String.raw`shifts?|смен(?:а|у|ы)`]
] as const).map(([unit, pattern]) => [unit, new RegExp(`^(?:${pattern})$`, "iu")] as const);
const RATE_SUFFIX = /^\s*(?:\/|per\b)\s*/iu;
const PER_ITEM_AFTER = new RegExp(String.raw`^\s*(?:(?:\/\s*|(?:per|for each|each|на|за)\s+)(?:(?:one|each|одну?|один|каждую|каждый)\s+)?(?:${COUNT_WORD})(?!\p{L})|each\s*$)`, "iu");
const PER_ITEM_BEFORE = new RegExp(String.raw`(?:\beach\s+(?:(?:${COUNT_WORD})\s+)?(?:takes?|requires?|lasts?)\s+(?:about\s+|an average of\s+)?|(?:^|[^\p{L}])на\s+одн[уо]\s+(?:[\p{L}-]+\s+){1,3}(?:уходит|требуется|приходится)\s+(?:в среднем\s+)?)$`, "iu");
const CYCLE_WORD = String.raw`cycles?|lifts?|(?:рабоч\p{L}*\s+)?цикл(?:а|ов|у)?`;
const CYCLE_AFTER_NUMBER = new RegExp(String.raw`^\s*(${CYCLE_WORD})(?!\p{L})`, "iu");
const PER_CYCLE = new RegExp(String.raw`^\s*(?:\/\s*|(?:per|each|за|на)\s+)(${CYCLE_WORD})(?!\p{L})`, "iu");
const TONNES_AFTER_NUMBER = /^\s*(?:t|tonnes?|тонн(?:а|ы|у)?|т)(?!\p{L})/iu;
const PER_HOUR = /^\s*(?:\/\s*|(?:per|each|an?|за|в)\s+)(?:h|hours?|hrs?|час)(?!\p{L})/iu;
const IN_ONE_HOUR = /\b(?:in|per) (?:a|one) (?:working )?hour\b|(?:^|[^\p{L}])за\s+(?:чистый\s+|рабочий\s+)?час(?!\p{L})/iu;
const PER_CYCLE_BEFORE = /(?:^|[^\p{L}])за\s+(?:один\s+)?цикл(?!\p{L})/iu;

function cycleName(value: string): "lift" | "cycle" {
  return /^lift/iu.test(value) ? "lift" : "cycle";
}

function explicitCycleRateUnit(before: string, after: string): string | undefined {
  const cycle = CYCLE_AFTER_NUMBER.exec(after);
  if (cycle && (PER_HOUR.test(after.slice(cycle[0].length)) || IN_ONE_HOUR.test(before))) return `${cycleName(cycle[1]!)}/h`;
  const tonnes = TONNES_AFTER_NUMBER.exec(after);
  if (!tonnes) return undefined;
  const perCycle = PER_CYCLE.exec(after.slice(tonnes[0].length));
  if (perCycle) return `t/${cycleName(perCycle[1]!)}`;
  return PER_CYCLE_BEFORE.test(before) ? "t/cycle" : undefined;
}

/** Keep unsupported compound number words as one span so an excerpt cannot
 * silently ground a component of a different quantity. */
export function literalUserNumberSpans(text: string): Array<{ start: number; end: number; value: number | undefined }> {
  return [...text.matchAll(LITERAL_NUMBER)].map((match) => {
    const token = match[0];
    const value = match[1] ? Number(token.replace(",", ".")) : CARDINALS.get(token.toLowerCase());
    return { start: match.index!, end: match.index! + token.length, value };
  });
}

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
    const matches = literalUserNumberSpans(text);
    for (const [index, { value, start, end }] of matches.entries()) {
      const previousEnd = matches[index - 1]?.end ?? 0;
      const leftText = text.slice(previousEnd, start);
      const separator = Math.max(...[",", ";", ".", "!", "?", "\n"].map((char) => leftText.lastIndexOf(char)));
      const left = Math.max(previousEnd + separator + 1, start - 60);
      const next = Math.min(matches[index + 1]?.start ?? text.length, end + 90);
      const right = text.slice(end, next).split(/[,;.!?\n]/u)[0]!;
      const quote = text.slice(left, end + right.length).trim();
      if (value === undefined || !Number.isFinite(value) || quote.length < USER_VALUE_QUOTE_LIMITS.minCharacters
        || quote.length > 160 || !/\p{L}/u.test(quote)) {
        complete = false;
        continue;
      }
      if (quantities.some((item) => item.value === value && item.quote === quote)) continue;
      if (quantities.length === 30) return { quantities, truncated: true, complete: false };
      // An adjacent time basis can precede a separately quoted numeral, as
      // in "In one hour the machine makes 25 cycles". Keep the quote itself exact.
      const clausePrefix = text.slice(Math.max(0, start - 120), start).split(/[.;!?\n]/u).at(-1) ?? "";
      const unit = explicitQuotedInputUnit(quote, currencyContext, true) ?? explicitCycleRateUnit(clausePrefix, right);
      quantities.push({ value, quote, ...(unit ? { unit } : {}) });
    }
  }
  return { quantities, truncated: false, complete };
}

/** Retain an explicit percentage, duration or per-item rate without changing its value.
 * A generic "dollar" only inherits USD from the selected brief. */
export function explicitQuotedInputUnit(quote: string, currencyContext?: string, includeSimpleUnits = false): string | undefined {
  if (/\d+(?:[.,]\d+)?\s*(?:%|percent(?:age)?|процент(?:а|ов)?)(?![\p{L}\p{N}]|\s*(?:\/|per\b|за\s))/iu.test(quote)) return "%";
  const match = quote.match(/\d+(?:[.,]\d+)?\s*(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF|US dollars?|dollars?|доллар(?:а|ов)?(?:\s+США)?|евро|тенге|рубл(?:ь|я|ей))(?:\s*\/\s*|\s+(?:per|за|for each)\s+)(?:(?:one|each|один|одну|каждый|каждую)\s+)?(?:items?|units?|products?|pieces?|товар(?:а|ов)?|единиц(?:а|у|ы)?|штук(?:а|у|и)?)(?=$|[\s,.!?;])/iu)
    ?? quote.match(/\b(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF)\s*\d+(?:[.,]\d+)?(?:\s*\/\s*|\s+(?:per|за|for each)\s+)(?:(?:one|each|один|одну|каждый|каждую)\s+)?(?:items?|units?|products?|pieces?|товар(?:а|ов)?|единиц(?:а|у|ы)?|штук(?:а|у|и)?)(?=$|[\s,.!?;])/iu);
  if (match) {
    const currency = explicitCurrency(match[1]!, currencyContext);
    return currency ? `${currency}/item` : undefined;
  }
  const quantities = literalUserNumberSpans(quote);
  if (quantities.length === 1) {
    const { start, end } = quantities[0]!;
    const suffix = quote.slice(end);
    const time = TIME_UNIT.exec(suffix);
    if (time) {
      const unit = TIME_ALIAS.find(([, pattern]) => pattern.test(time[1]!))![0];
      const tail = suffix.slice(time[0].length);
      const rate = RATE_SUFFIX.exec(tail);
      if (PER_ITEM_AFTER.test(tail) || (!rate && PER_ITEM_BEFORE.test(quote.slice(0, start)))) return `${unit}/item`;
      if (rate) {
        const basis = tail.slice(rate[0].length).match(/^\p{L}+/u)?.[0] ?? "";
        const period = [...TIME_ALIAS, ...PERIOD_ALIASES].find(([, pattern]) => pattern.test(basis));
        return period ? `${unit}/${period[0]}` : undefined;
      }
      // "с" is also the Russian preposition "with" before an ordinary word.
      if (/^с$/iu.test(time[1]!) && /^\s+\p{L}/u.test(tail)) return undefined;
      return unit;
    }
    if (includeSimpleUnits && SOURCE_COUNT.test(suffix)) return "items";
  }
  if (!includeSimpleUnits) return undefined;
  const money = quote.match(/\d+(?:[.,]\d+)?\s*(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF|US dollars?|dollars?|доллар(?:а|ов)?(?:\s+США)?|евро|тенге|рубл(?:ь|я|ей))(?![\p{L}\p{N}]|\s*(?:\/|per\b|за\s))/iu)
    ?? quote.match(/\b(USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF)\s*\d+(?:[.,]\d+)?(?!\d|[.,]\d|\s*(?:\/|per\b|за\s|for each\b))/iu);
  if (money) return explicitCurrency(money[1]!, currencyContext);
  return undefined;
}

/** Normalize source aliases before comparing an input to its grounded quote. */
export function normalizeQuotedInputUnit(unit: string): string {
  const counts = unit.replace(/\s+per\s+/giu, "/").replace(COUNT_ALIAS, (match, prefix: string) =>
    /^(?:items?|units?)$/i.test(match.slice(prefix.length).trim()) ? match : `${prefix}items`);
  return counts.split("/").map((part, index) => {
    const time = TIME_ALIAS.find(([, pattern]) => pattern.test(part.trim()));
    const period = index > 0 && PERIOD_ALIASES.find(([, pattern]) => pattern.test(part.trim()));
    const cycle = CYCLE_AFTER_NUMBER.exec(part);
    return time?.[0] ?? (period ? period[0] : cycle && cycle[0].trim() === part.trim() ? cycleName(cycle[1]!) : part);
  }).join("/");
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
