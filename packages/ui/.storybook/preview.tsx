import type { ComponentType } from "react";

import "../src/styles.css";

interface PreviewContext {
  readonly globals: Readonly<Record<string, unknown>>;
  readonly parameters: Readonly<Record<string, unknown>>;
}

const preview = {
  decorators: [
    (Story: ComponentType, context: PreviewContext) => {
      const fullscreen = context.parameters["layout"] === "fullscreen";

      return (
        <div
          data-cm-density={
            context.globals["density"] === "comfortable"
              ? "comfortable"
              : "compact"
          }
          style={{
            background: "var(--cm-color-app)",
            color: "var(--cm-color-text)",
            fontFamily: "var(--cm-font-sans)",
            minHeight: "100vh",
            padding: fullscreen ? 0 : "var(--cm-space-6)",
          }}
        >
          <Story />
        </div>
      );
    },
  ],
  globalTypes: {
    density: {
      defaultValue: "compact",
      description: "CloudMarkup presentation density",
      toolbar: {
        icon: "mirror",
        items: [
          { title: "Compact", value: "compact" },
          { title: "Comfortable", value: "comfortable" },
        ],
      },
    },
  },
  parameters: {
    a11y: {
      test: "error",
    },
    backgrounds: {
      default: "light",
      values: [{ name: "light", value: "#f7f9fc" }],
    },
    controls: {
      expanded: true,
    },
  },
};

export default preview;
