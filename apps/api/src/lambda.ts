import { handle } from "hono/aws-lambda";

import { app } from "./app.js";
import { createEdgeProtectedLambdaHandler } from "./lambda-edge-handler.js";

const defaultAppHandler = handle(app);

export const handler = createEdgeProtectedLambdaHandler(
  () => defaultAppHandler,
);
