import type { z } from "zod";

import { modelRepositoryInterpretationResponseV1Schema } from "@cloudmarkup/schemas";

export type ModelRepositoryInterpretationResponseV1 = z.output<
  typeof modelRepositoryInterpretationResponseV1Schema
>;
