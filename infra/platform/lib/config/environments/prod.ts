import {
  baseEnvironmentConfig,
  defineEnvironmentConfig,
  type EnvironmentConfig,
  type EnvironmentTarget,
} from "../environment-config.js";

export function createProdEnvironmentConfig(
  target: EnvironmentTarget,
): EnvironmentConfig {
  return defineEnvironmentConfig(baseEnvironmentConfig("prod", target));
}
