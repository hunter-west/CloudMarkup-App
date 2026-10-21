import { handle } from "hono/aws-lambda";

import {
  createEdgeProtectedLambdaHandler,
  type AppLambdaHandler,
} from "./lambda-edge-handler.js";
import { createProductionApp } from "./production-composition.js";

let productionAppHandler: AppLambdaHandler | undefined;

export const handler = createEdgeProtectedLambdaHandler(() => {
  productionAppHandler ??= handle(createProductionApp());
  return productionAppHandler;
});
