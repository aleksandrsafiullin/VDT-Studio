/** Synthetic haulage facts only, for the opt-in live acceptance harness.
 * Field groups must receive every requested number in the requested unit. */
function quantity(question) {
  const text = `${question.id ?? ""} ${question.label ?? question.question ?? ""}`.toLowerCase().replace(/[_-]+/g, " ");
  const unit = String(question.unit ?? "").toLowerCase();
  if (/payload.*(factor|ratio)|fill factor/.test(text)) return 1;
  if (/scheduled.*hour/.test(text)) return 6000;
  if (/downtime.*hour/.test(text)) return 2000;
  if (/(operating|working|productive|usable|net).*hour/.test(text)) return 4000;
  if (/calendar|annual.*hour|hour.*year/.test(text)) return 8760;
  if (/loading|load time/.test(text)) return unit.startsWith("h") ? 4 / 60 : unit.startsWith("s") && !unit.startsWith("shift") ? 240 : 4;
  if (/dump|unload|tipping/.test(text)) return unit.startsWith("h") ? 2 / 60 : unit.startsWith("s") && !unit.startsWith("shift") ? 120 : 2;
  if (/queue|spotting|wait|delay/.test(text)) return unit.startsWith("h") ? 3 / 60 : unit.startsWith("s") && !unit.startsWith("shift") ? 180 : 3;
  if (/availability|available/.test(text)) return unit === "%" ? 85 : 0.85;
  if (/empty.*speed|return.*speed/.test(text)) return 11;
  if (/loaded.*speed|load speed/.test(text)) return 7;
  if (/distance/.test(text)) return 2.7;
  if (/payload|tonnes per trip|tons per trip|truck load|load per truck/.test(text)) return 40;
  if (/truck.*count|fleet.*size|number.*truck/.test(text)) return 5;
  return undefined;
}

export function answerLiveHaulageQuestion(question) {
  if (question.fields?.length) return question.fields.map(field => {
    const value = quantity(field);
    if (value === undefined) throw new Error(`The synthetic haulage fixture has no numeric answer for field ${field.id}.`);
    return `${field.id}: ${value}`;
  }).join("; ");
  const text = `${question.id ?? ""} ${question.question ?? ""}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/calendar/.test(text)) return "8760 calendar hours per year";
  if (/availability|available/.test(text)) return "85% mechanical availability";
  if (/cycle.*(service|times)|service.*time/.test(text)) return "4 minutes average loading time; 2 minutes average dumping time; 3 minutes average queue and spotting time per cycle";
  if (/(scheduled|working|productive|operating|annual).*hour|hour.*year/.test(text)) return "6000 scheduled hours and 2000 downtime hours per truck per year; 4000 productive hours per truck per year";
  const value = quantity(question);
  if (value !== undefined) return value;
  if (/allocation|ore|waste|dedicated/.test(text)) return "All 5 trucks are dedicated to ore haulage in this VDT";
  if (/mine type|open pit|underground|operation type/.test(text)) return "Open-pit mine haulage";
  if (/truck|fleet|count|number/.test(text)) return "5 haul trucks";
  return "Use a reasonable mining haulage assumption, include it as an assumption, and continue building the VDT.";
}
