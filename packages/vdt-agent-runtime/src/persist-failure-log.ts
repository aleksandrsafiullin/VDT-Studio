export function persistFailureFields(error: unknown): {
  name: string;
  message: string;
  code?: string;
  causeName?: string;
  causeMessage?: string;
} {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  const cause = error instanceof Error ? error.cause : undefined;
  const causeName = cause instanceof Error ? cause.name : undefined;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : cause !== undefined
        ? String(cause)
        : undefined;
  return {
    name,
    message,
    ...(code ? { code } : {}),
    ...(causeName ? { causeName } : {}),
    ...(causeMessage ? { causeMessage } : {})
  };
}
