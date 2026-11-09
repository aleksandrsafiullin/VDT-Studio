import type { VdtProject } from "@vdt-studio/vdt-core";

/** Browser-safe contract shared by authoring, review and explicit persistence. */
export interface SkillUpdateTarget {
  id: string;
  version: number;
  contentHash: string;
  fileHash: string;
  baseVersion: number;
  baseContentHash: string;
  selectionRevision: number;
}

export interface SkillUpdateChange {
  id: string;
  title: string;
  reason: string;
  nodeIds: string[];
  before: string;
  after: string;
  kind: "add" | "replace" | "remove" | "topology";
}

export interface SkillUpdateProposal {
  summary: string;
  raw: string;
  warnings: string[];
  changes: SkillUpdateChange[];
  target: SkillUpdateTarget;
}

const maximumSkillBytes = 128 * 1024;
// Protect alternative indentation/fence spellings too, even though the runtime
// executes only its stricter canonical vdt-topology fence format.
const topologyPattern = /^[\t ]*(?:`{3,}|~{3,})[\t ]*vdt-topology\b[^\r\n]*\r?\n[\s\S]*?(?:^[\t ]*(?:`{3,}|~{3,})[\t ]*(?=\r?$)|(?![\s\S]))/gim;

function boundedText(value: string | undefined, limit: number, label: string) {
  if (value !== undefined && value.length > limit) throw new Error(`${label} is too long for Skill Author.`);
  return value;
}

/** Descriptive context supplies meaning, without copying embedded local paths or
 * numerical site observations into reusable methodology. Formula constants and
 * unit names remain exact and are treated separately from narrative context. */
function narrative(value: string | undefined, limit: number, label: string) {
  return boundedText(value, limit, label)
    ?.replace(/file:\/\/[^\s<>]+|\/(?:Users|Volumes|private|tmp|home|var)\/[^\s<>]+|[A-Za-z]:\\[^\s<>]+/g, "[source path omitted]")
    .replace(/(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)*%?(?![\p{L}\p{N}_])/gu, "[site value omitted]");
}

export function skillAuthorSource(project: VdtProject) {
  if (project.graph.nodes.length < 2 || project.graph.nodes.length > 80) throw new Error("Choose a VDT with 2–80 nodes to create a skill.");
  if (project.graph.edges.length > 320) throw new Error("This VDT has too many relationships for Skill Author.");
  const root = project.graph.nodes.find(node => node.id === project.rootNodeId);
  if (!root?.formula) throw new Error("The VDT needs a root formula before it can become a reusable skill.");
  const source = {
    rootNodeId: project.rootNodeId,
    rootKpi: boundedText(root.name, 160, "Root KPI"),
    industry: narrative(project.industry, 160, "Industry"),
    unit: boundedText(root.unit, 80, "Unit"),
    nodes: project.graph.nodes.map(node => {
      if ((node.assumptions?.length ?? 0) > 12) throw new Error("A node has too many assumptions for Skill Author.");
      return {
        id: boundedText(node.id, 160, "Node ID"), name: boundedText(node.name, 160, "Node name"),
        unit: boundedText(node.unit, 80, "Unit"), formula: boundedText(node.formula, 4000, "Formula"), type: node.type,
        ...(node.description ? { description: narrative(node.description, 2400, "Description") } : {}),
        ...(node.assumptions?.length ? { assumptions: node.assumptions.map(value => narrative(value, 800, "Assumption")) } : {})
      };
    }),
    edges: project.graph.edges.map(edge => ({ parentId: edge.sourceNodeId, childId: edge.targetNodeId, relation: edge.relation }))
  };
  if (new TextEncoder().encode(JSON.stringify(source)).length > 200 * 1024) throw new Error("This VDT's modelling context is too large for Skill Author.");
  return source;
}

/** Browser-only semantic snapshot, not a security hash or provider input. Keep
 * exact narrative values here: a changed period or threshold changes meaning
 * even when the provider projection redacts both numbers identically. Layout
 * and numerical baseline/scenario edits do not invalidate methodology drafts. */
export function skillWorkflowSourceKey(project: VdtProject): string {
  return JSON.stringify({
    source: skillAuthorSource(project),
    narrative: {
      industry: project.industry ?? "",
      nodes: project.graph.nodes.map(node => ({ id: node.id, description: node.description ?? "", assumptions: node.assumptions ?? [] }))
    }
  });
}

export function skillTopologyBlocks(raw: string): { text: string; start: number; end: number }[] {
  return [...raw.matchAll(new RegExp(topologyPattern.source, "gim"))].map(match => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }));
}

function frontmatterEnd(raw: string): number {
  const header = raw.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!header) throw new Error("The skill needs valid YAML frontmatter before its instructions can be updated.");
  return header[0].length;
}

/** Apply only reviewed changes to exact working bytes. Replacements are anchored
 * in the original document so selecting/reordering another change cannot change
 * the meaning of an anchor. Unchanged content is retained byte for byte. */
export function applySkillChanges(raw: string, changes: readonly SkillUpdateChange[]): string {
  if (new TextEncoder().encode(raw).length > maximumSkillBytes || changes.length > 30) throw new Error("The skill update is too large.");
  const bodyStart = frontmatterEnd(raw), topology = skillTopologyBlocks(raw), identities = new Set<string>();
  const edits: { start: number; end: number; after: string; topology: boolean }[] = [], additions: { after: string; topology: boolean }[] = [];
  let hostTopology: SkillUpdateChange | undefined;
  for (const change of changes) {
    if (!change.id || identities.has(change.id)) throw new Error("Each skill change needs a unique ID.");
    identities.add(change.id);
    if (!["add", "replace", "remove", "topology"].includes(change.kind)) throw new Error("Unknown skill change kind.");
    if (change.before.length > 28_000 || change.after.length > 28_000 || change.before === change.after) throw new Error("A skill change is empty or too large.");
    if (change.kind === "add" && change.before || change.kind === "remove" && (!change.before || change.after)
      || change.kind === "replace" && (!change.before || !change.after)) throw new Error("The skill change does not match its declared kind.");
    if (!change.before && !change.after.trim()) throw new Error("An added instruction cannot be empty.");
    if (change.kind === "topology") {
      if (change.id !== "host.topology" || topology.length > 1 || (topology[0]?.text ?? "") !== change.before
        || skillTopologyBlocks(change.after).length !== 1 || skillTopologyBlocks(change.after)[0]!.text !== change.after) {
        throw new Error("Executable topology changes must use the original host-prepared block.");
      }
      hostTopology = change;
    } else if (/(?:`{3,}|~{3,})[\t ]*vdt-topology\b/i.test(change.after)) throw new Error("Executable topology is prepared by the host, separately from guidance changes.");
    if (!change.before) { additions.push({ after: change.after, topology: change.kind === "topology" }); continue; }
    const start = raw.indexOf(change.before, bodyStart);
    if (start < 0 || raw.indexOf(change.before, start + 1) >= 0) throw new Error("A skill change no longer has one unique matching passage. Prepare it again.");
    const end = start + change.before.length;
    if (start < bodyStart || change.kind !== "topology" && topology.some(block => start < block.end && end > block.start)) {
      throw new Error("Guidance changes cannot replace skill metadata or executable topology.");
    }
    if (edits.some(edit => start < edit.end && end > edit.start)) throw new Error("Proposed skill changes overlap. Prepare separate changes.");
    edits.push({ start, end, after: change.after, topology: change.kind === "topology" });
  }
  const assemble = (includeTopology: boolean) => {
    let result = raw;
    for (const edit of edits.filter(edit => includeTopology || !edit.topology).sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.after + result.slice(edit.end);
    for (const addition of additions.filter(addition => includeTopology || !addition.topology)) result += `${result.endsWith("\n") ? "\n" : "\n\n"}${addition.after}`;
    return result;
  };
  const topologySignature = (value: string) => JSON.stringify(skillTopologyBlocks(value).map(block => block.text));
  // Validate assembled bytes, not only individual replacement strings: changing
  // a JSON fence label or joining split marker fragments can create executable
  // topology without including a complete marker in any one change.after.
  // This check runs for every invocation, including every user-selected subset,
  // and remains separate so a host block cannot mask a promoted guidance block.
  const guidance = assemble(false);
  if (topologySignature(guidance) !== JSON.stringify(topology.map(block => block.text))) {
    throw new Error("Guidance changes cannot introduce, remove or promote executable topology. Prepare it separately through the host.");
  }
  const result = hostTopology ? assemble(true) : guidance;
  const expectedTopology = hostTopology ? [hostTopology.after] : topology.map(block => block.text);
  if (topologySignature(result) !== JSON.stringify(expectedTopology)) {
    throw new Error("Only the separately prepared host change may alter executable topology.");
  }
  if (new TextEncoder().encode(result).length > maximumSkillBytes) throw new Error("The updated skill must be at most 128 KiB.");
  return result;
}
