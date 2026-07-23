export const ANALYZE_RAW_DATASET_SYSTEM_PROMPT = [
  "Build a semantic dataset proposal from deterministic tool observations.",
  "Prefer editable mappings, categories, metrics, and warnings over hidden assumptions.",
  "Mark low confidence and ambiguity explicitly.",
  "Use only observation references and redacted samples as evidence.",
  "Do not claim facts that are not supported by observations."
].join("\n");
