import {
  baseEnvironmentConfig,
  defineEnvironmentConfig,
  type EnvironmentConfig,
  type EnvironmentTarget,
} from "../environment-config.js";

export const CLOUDMARKUP_DEV_TARGET: EnvironmentTarget = Object.freeze({
  account: "000000000000",
  region: "us-east-1",
});

export function createDevEnvironmentConfig(
  target: EnvironmentTarget = CLOUDMARKUP_DEV_TARGET,
): EnvironmentConfig {
  return defineEnvironmentConfig(baseEnvironmentConfig("dev", target));
}
