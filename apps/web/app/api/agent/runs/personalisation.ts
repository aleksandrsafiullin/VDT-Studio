import { userOnlyPersonalisation } from "@vdt-studio/vdt-core";

/** Only the user's saved instructions are active. Legacy project metadata is
 * deliberately not read or promoted into the personalisation prompt. */
export const bindUserInstructions = userOnlyPersonalisation;
