import { z } from "zod";

/** Cognito subjects are opaque provider identifiers, not RFC UUIDs. */
export const cognitoSubjectSchema = z.string().min(1).max(255);
