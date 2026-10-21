interface StorybookViteConfig {
  readonly define?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

const config = {
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  stories: [
    "../*.stories.@(ts|tsx)",
    "../../../apps/web/src/features/editor/*.stories.@(ts|tsx)",
  ],
  viteFinal(viteConfig: StorybookViteConfig) {
    return {
      ...viteConfig,
      define: {
        ...viteConfig.define,
        "import.meta.env.VITE_CLOUDMARKUP_VISUAL_FIXTURES":
          JSON.stringify("true"),
      },
    };
  },
};

export default config;
