import type { AgentProposalExpectation, AgentQuestionExpectation } from "@vdt-studio/vdt-agent-runtime";

export type ObservedQuestion = Omit<AgentQuestionExpectation, "captureSessionId" | "turnId" | "recognitionProof">;

export function questionMatches(expected: ObservedQuestion, current: ObservedQuestion | undefined): boolean {
  return Boolean(current && expected.runId === current.runId && expected.projectId === current.projectId && expected.vdtId === current.vdtId
    && expected.questionSetId === current.questionSetId && expected.questionEventId === current.questionEventId
    && expected.questionId === current.questionId);
}

export function proposalMatches(expected: AgentProposalExpectation, current: AgentProposalExpectation | undefined): boolean {
  return Boolean(current && expected.runId === current.runId && expected.projectId === current.projectId && expected.vdtId === current.vdtId
    && expected.proposalId === current.proposalId && expected.baseRevisionId === current.baseRevisionId
    && expected.baseRevision === current.baseRevision);
}

const englishQuantity = /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|dozens?|hundreds?|thousands?|millions?|billions?|trillions?|half|halves|quarters?)$/iu;
const russianSmallQuantity = /^(?:н[оу]л(?:ь|я|ю|ем|ём|е)|од(?:ин|на|но|ни|ного|ной|ному|ним|ною|ном|ну|них|ними)|дв(?:а|е|ух|ум|умя)|тр(?:и|[её]х|[её]м|емя)|четыр(?:е|[её]х|[её]м|ьмя)|(?:пят|шест|сем|девят|десят)(?:ь|и|ью)|восем(?:ь|ью)|восьм(?:и|ью)|(?:один|две|три|четыр|пят|шест|сем|восем|девят)надцат(?:ь|и|ью))$/iu;
const russianTens = /^(?:(?:двад|трид)цат(?:ь|и|ью)|сорока?|девяност[оа]|(?:пят|шест|сем|восем|восьм)(?:ь|и|ью)десят(?:и|ью)?)$/iu;
const russianHundreds = /^(?:сто|ста|сот(?:ня|ни|не|ней|ню|ен|нями|нях)|(?:дв(?:е|ух|ум|умя)|тр(?:и|[её]х|[её]м|емя)|четыр(?:е|[её]х|[её]м|ьмя)|(?:пят|шест|сем|восем|восьм|девят)(?:ь|и|ью))(?:сти|ста|сот|стам|стами|стах))$/iu;
const russianMagnitude = /^(?:десят(?:ок|ка|ку|ком|ке|ки|ков|кам|ками|ках)|тысяч(?:а|и|е|у|ей|ею|ам|ами|ах)?|(?:миллион|миллиард|триллион)(?:а|ов|у|ом|е|ы|ам|ами|ах)?)$/iu;
const russianCollective = /^(?:дво|тро|четвер|пятер|шестер|семер|восьмер|девятер|десятер)(?:е|о|ых|ым|ыми|их|им|ими)$/iu;
const russianFraction = /^(?:половин(?:а|ы|е|у|ой|ою|ам|ами|ах)|четверт(?:ь|и|ью|ей|ям|ями|ях)|полтор[аы]|полутора|полусот(?:ня|ни|не|ней|ню|ен|нями|нях)|пол(?:сотни|часа|минуты|секунды|дня|суток|недели|месяца|года|тонны|грамма|килограмма|метра|километра|литра|процента))$/iu;
const russianUnitAdjective = /^([\p{L}]+)(?:секундн|минутн|часов|дневн|суточн|недельн|месячн|летн|тонн|граммов|метров|литров|процентн)(?:ый|ая|ое|ого|ой|ому|ым|ую|ые|ых|ыми|ом|ей)$/iu;
const quantityWords = [englishQuantity, russianSmallQuantity, russianTens, russianHundreds, russianMagnitude, russianCollective, russianFraction];

export function requiresNumericReadback(text: string): boolean {
  return /\p{N}/u.test(text) || (text.match(/\p{L}+/gu) ?? []).some(word => {
    const withUnit = russianUnitAdjective.exec(word)?.[1];
    return withUnit?.toLowerCase() === "полу" || quantityWords.some(pattern => pattern.test(withUnit ?? word));
  });
}

export function spokenReviewIntent(text: string): "review" | "decline" | undefined {
  const normalized = text.trim().toLowerCase().replace(/[.!?。]+$/u, "").trim();
  if (["review", "show review", "show changes", "yes", "да", "покажи изменения", "покажи предложение"].includes(normalized)) return "review";
  if (["no", "decline", "reject", "нет", "отклонить", "отмена"].includes(normalized)) return "decline";
  return undefined;
}
