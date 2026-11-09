import { z } from "zod";

/** Describe model-authored JSON before runtime defaults and validation. */
export function toProviderJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    target: "draft-07",
    io: "input",
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema instanceof z.ZodObject && jsonSchema.additionalProperties === undefined) {
        jsonSchema.additionalProperties = false;
      }
      // Existing provider projections use anyOf for branches whose tags
      // already make them mutually exclusive.
      if (zodSchema instanceof z.ZodDiscriminatedUnion && jsonSchema.oneOf) {
        jsonSchema.anyOf = jsonSchema.oneOf;
        delete jsonSchema.oneOf;
      }
    }
  });
}
