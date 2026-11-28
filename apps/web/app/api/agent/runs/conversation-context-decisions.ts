import { normalizeTopic, safeContextText, safeDecisionValue, safeTopic } from "@vdt-studio/vdt-agent-runtime";

export {
  CONFIRM_DECISION_OPTION, confirmConversationDecisionProposal, isConversationDecisionConfirmation,
  normalizeTopic, safeContextText, safeDecisionValue
} from "@vdt-studio/vdt-agent-runtime";

const DEFINITION_PATTERNS = [
  /^(?:decision\s*:\s*)?(?<topic>[\p{L}\p{N}][\p{L}\p{N} _/-]{0,63})\s*=\s*(?<value>[^\n?]{1,400})$/iu,
  /^(?:define|treat)\s+(?<topic>.{1,64}?)\s+as\s+(?<value>[^\n?]{1,400})$/iu,
  /^(?<topic>.{1,64}?)\s+(?:means|is defined as)\s+(?<value>[^\n?]{1,400})$/iu,
  /^(?:теперь\s+)?под\s+(?<topic>.{1,64}?)\s+понима(?:ем|ть)\s+(?<value>[^\n?]{1,400})$/iu,
  /^(?<topic>.{1,64}?)\s+(?:означает|считаем как)\s+(?<value>[^\n?]{1,400})$/iu,
  /^(?:(?:actually|instead),\s*)?use\s+(?<value>[^\n?]{1,400}?)\s+as\s+(?<topic>.{1,64})$/iu
];

// Require a declarative definition, explicit keyed decision, or an actual
// submitted answer. Investigation and assistant proposals do not confirm facts.
export const INSTRUCTION_DECISION_VERSION = "conversation_instruction_decision.v1";
interface InstructionDecision {
  version: typeof INSTRUCTION_DECISION_VERSION;
  topic: string;
  value: string;
}

function isExplicitDefinitionValue(value: string): boolean {
  return !/(?:[.!]\s|;)/u.test(value)
    && !/\b(?:maybe|perhaps|probably|possibly|tentatively)\b/iu.test(value)
    && !/(?:^|\s)(?:возможно|вероятно|наверное|скорее|предположительно)(?=$|[\s,.!])/iu.test(value)
    && !/^(?:which|what|whether|ask|check|estimate|calculate|guess)\b/iu.test(value);
}

export function instructionDecision(content: string): InstructionDecision | undefined {
  if (!safeContextText(content, 2_000)) return;
  const text = content.trim().replace(/^(?:correction|update)\s*:\s*/i, "")
    .replace(/^for (?:this|the) (?:tree|model),\s*/i, "");
  // A tree-scoped instruction to count a stated tonnage defines its output basis.
  if (/^for (?:this|the) (?:tree|model),/iu.test(content.trim())) {
    const value = /^(?:now |instead,? )?count\s+((?:only|all)\s+[\p{L} -]+\btonnes)[.!]?$/iu.exec(text)?.[1];
    if (value && isExplicitDefinitionValue(value)) return { version: INSTRUCTION_DECISION_VERSION, topic: "output", value };
  }
  for (const pattern of DEFINITION_PATTERNS) {
    const fields = text.match(pattern)?.groups;
    if (!fields) continue;
    const topic = normalizeTopic(fields.topic ?? "");
    if (/^(?:i |we |maybe |perhaps |would |could |does |should |(?:the )?(?:assistant|file|sheet|workbook|spreadsheet)\b|возможно |кажется |в файле |в книге |ассистент )/iu.test(topic)) continue;
    const value = safeDecisionValue(fields.value?.trim().replace(/[.!]$/, ""));
    if (!value || !safeTopic(topic) || !isExplicitDefinitionValue(value)) continue;
    return { version: INSTRUCTION_DECISION_VERSION, topic, value };
  }
}

export function readInstructionDecision(content: string, metadata: Record<string, unknown>): InstructionDecision | undefined {
  if (metadata.version !== INSTRUCTION_DECISION_VERSION) return instructionDecision(content);
  const topic = safeContextText(metadata.topic, 64);
  const value = safeDecisionValue(metadata.value);
  if (topic && safeTopic(topic) && value && safeContextText(content, 2_000)?.includes(value)) {
    return { version: INSTRUCTION_DECISION_VERSION, topic, value };
  }
}
