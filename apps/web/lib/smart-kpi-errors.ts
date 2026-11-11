/** Fixed, credential-free explanations shared by HTTP admission and the UI.
 * Never display a provider's free-form error or rejected request body. */
export const SMART_KPI_FAILURE_REASONS: Readonly<Record<string, string>> = {
  INCOMPLETE_OUTPUT: "The model used its generation budget before completing the answer. Choose a lower supported reasoning level or another model, then Retry.",
  INVALID_PROVIDER_OUTPUT: "The model did not return the requested complete JSON response. Retry or choose another model.",
  PROVIDER_REFUSAL: "The provider declined this request. Review the KPI description or choose another model.",
  PROVIDER_AUTH: "The provider rejected this API key or its permissions. Check the selected connection in Settings.",
  PROVIDER_QUOTA: "The provider reports exhausted API credits or quota. Check the selected API account before retrying.",
  PROVIDER_RATE_LIMIT: "The provider rate limit was reached. Wait before choosing Retry.",
  PROVIDER_MODEL_UNAVAILABLE: "The selected model is unavailable to this API connection. Choose an accessible model in Settings.",
  PROVIDER_REQUEST_REJECTED: "The provider rejected the structured request. Check that this model supports structured outputs.",
  INVALID_PROPOSAL: "The model's alternatives or required factors did not match the response contract. Retry to prepare a complete factor group.",
  INCOHERENT_GROUP: "The suggested formula did not match its complete group of required factors. Retry to prepare a coherent alternative.",
  UNOBSERVED_REFERENCE: "The model did not match an eligible existing KPI and its unit. Retry to prepare independent components.",
  UNSAFE_FORMULA: "The model returned an unsupported formula. Retry to prepare a valid calculation.",
  UNSUPPORTED_UNIT: "The model returned an unsupported unit expression. Units must use / for per and match the target's scale. Retry to prepare a valid answer.",
  UNIT_MISMATCH: "The suggested formula's units do not match the target. Retry to prepare compatible factors.",
  UNVERIFIED_FORMULA: "The model claimed a catalog recipe but changed its formula. Retry to prepare an exact recipe or a custom formula.",
  DUPLICATE_CONCEPT: "The model repeated a factor or concept. Retry to prepare distinct components.",
  MODEL_COEFFICIENT: "The model introduced a numeric coefficient or repeated factor. Retry to prepare measured inputs.",
  INEFFECTIVE_FACTOR: "The model's formula cancels or ignores a factor. Retry to prepare effective components."
};
