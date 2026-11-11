export type ResultLocale = "ru" | "en";

function explicitResultLanguage(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const russianInstruction = text.match(/(?:ответь|ответ|пиши|напиши|итог|резюме)[^.!?\n]{0,45}?(?:на\s+(\p{L}+ском)(?!\p{L})|по-(\p{L}+ски)(?!\p{L})|на\s+(\p{L}+)\s+языке)/iu);
  const language = text.match(/\b(?:reply|respond|answer|write|summari[sz]e|report)\b[^.!?\n]{0,45}?\bin\s+(\p{L}+)/iu)?.[1]
    ?? russianInstruction?.[1] ?? russianInstruction?.[2] ?? russianInstruction?.[3];
  return language?.toLowerCase();
}

/** Pin the language when the request or saved guidance identifies it clearly.
 * Other languages use the original instruction in the presentation prompt. */
export function resultLocale(request: string, savedInstructions?: string): ResultLocale | undefined {
  const explicit = explicitResultLanguage(request) ?? explicitResultLanguage(savedInstructions);
  if (explicit) {
    if (/^(?:russian|русском|русски)$/u.test(explicit)) return "ru";
    if (/^(?:english|английском|английски)$/u.test(explicit)) return "en";
    return undefined;
  }
  if (scriptShare(request, /[А-Яа-яЁё]/gu) >= 0.75
    && !/[іїєґўәғқңөұүһ]/iu.test(request)
    && /(?:помоги|постро|выручк|рассч|посчита|вычисл|продал|возврат|покажи|поменя|измени|добавь|нужно|сделай|пожалуйста)/iu.test(request)) return "ru";
  if (scriptShare(request, /[A-Za-z]/gu) >= 0.85
    && /\b(?:the|with|build|calculate|show|update|change|rename|compute)\b/i.test(request)) return "en";
  return undefined;
}

function scriptShare(text: string, letters: RegExp): number {
  const prose = text.replace(/`[^`]*`|«[^»]*»/g, " ");
  return (prose.match(letters)?.length ?? 0) / Math.max(1, prose.match(/\p{L}/gu)?.length ?? 0);
}

export function resultLanguageInstruction(locale: ResultLocale | undefined): string {
  if (locale === "ru") return "Напиши итог на русском языке. Используй естественный русский текст и сохрани числовой результат и единицу измерения из подтверждённого расчёта.";
  if (locale === "en") return "Write the result in English. Keep the verified number and unit unchanged.";
  return "Write the result in the language explicitly requested by the user, or in the language of the latest request. Keep the verified number and unit unchanged.";
}

/** The model has already emitted a final action for a verified receipt. If its
 * prose is in the wrong script, present the verified result in the known locale. */
export function presentVerifiedResult(text: string, locale: ResultLocale, result: { name?: string; value: number; unit?: string }): string {
  const alphabet = locale === "ru" ? /[А-Яа-яЁё]/gu : /[A-Za-z]/gu;
  if (scriptShare(text, alphabet) >= 0.55) return text;
  const amount = new Intl.NumberFormat(locale, { maximumSignificantDigits: 15 }).format(result.value);
  const value = result.unit ? `${amount} ${result.unit}` : amount;
  if (locale === "ru") return result.name ? `Итог расчёта «${result.name}» — ${value}.` : `Результат расчёта — ${value}.`;
  return result.name ? `The calculated result for “${result.name}” is ${value}.` : `The calculated result is ${value}.`;
}
