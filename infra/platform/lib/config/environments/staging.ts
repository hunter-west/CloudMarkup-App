import {
  baseEnvironmentConfig,
  defineEnvironmentConfig,
  type EnvironmentConfig,
  type EnvironmentTarget,
} from "../environment-config.js";

export function createStagingEnvironmentConfig(
  target: EnvironmentTarget,
): EnvironmentConfig {
  return defineEnvironmentConfig(baseEnvironmentConfig("staging", target));
}
