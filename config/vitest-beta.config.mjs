import { configDefaults } from "vitest/config";
import configuration from "../vitest.config.ts";
import { runtimeFiles } from "../scripts/run-beta-tests.mjs";

// Inline projects do not inherit CLI exclusions in the pinned Vitest version.
// Reuse the authoritative configuration and change only the API file inventory.
export default {
  ...configuration,
  test: {
    ...configuration.test,
    projects: configuration.test.projects.map((project) =>
      project.test.name === "api"
        ? {
            ...project,
            test: {
              ...project.test,
              exclude: [
                ...configDefaults.exclude,
                ...runtimeFiles.map((path) => `**/${path.split("/").at(-1)}`),
              ],
            },
          }
        : project,
    ),
  },
};
