export const DANGEROUS_CLI_FLAG_PATTERNS = Object.freeze([
  /^--?force(?:=|$)/i,
  /^--?trust(?:[-=]|$)/i,
  /^--?yolo(?:=|$)/i,
  /^--?allow-all(?:-tools)?(?:=|$)/i,
  /^--?bypass[_-]?permissions(?:=|$)/i,
  /^--?dangerously(?:-auto-approve|-autoapprove|AutoApprove)?(?:=|$)/i,
  /^--dangerouslyAutoApprove(?:=|$)/i,
  /^--?dangerous(?:ly)?(?:-auto-approve|-autoapprove)?(?:=|$)/i,
  /^--?workspace[_-]?trust(?:=|$)/i,
  /^--?allow[_-]?all[_-]?tools(?:=|$)/i,
  /^bypass[_-]?permissions$/i,
  /^dangerously(?:autoapprove|auto[_-]?approve)?$/i,
  /^allow[_-]?all(?:[_-]?tools)?$/i,
  /^yolo$/i
] as const satisfies readonly RegExp[]);

export function assertArgsSafe(args: readonly string[], options: { allowScopedTrust?: boolean } = {}): void {
  for (const arg of args) {
    if (arg.includes("\0")) {
      throw Object.assign(new Error("Forbidden CLI argument contains a NUL byte."), {
        code: "UNSAFE_CLI_ARGS",
        arg,
        pattern: "NUL"
      });
    }
    if (arg.split(/[\\/]+/).includes("..")) {
      throw Object.assign(new Error(`Forbidden CLI argument contains path traversal: ${arg}`), {
        code: "UNSAFE_CLI_ARGS",
        arg,
        pattern: "path-traversal"
      });
    }
    for (const pattern of DANGEROUS_CLI_FLAG_PATTERNS) {
      if (options.allowScopedTrust === true && arg === "--trust" && pattern.test(arg)) continue;
      if (pattern.test(arg)) {
        throw Object.assign(new Error(`Forbidden CLI argument: ${arg}`), {
          code: "UNSAFE_CLI_ARGS",
          arg,
          pattern: pattern.source
        });
      }
    }
  }
}
