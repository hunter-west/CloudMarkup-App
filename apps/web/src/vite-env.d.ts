/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDMARKUP_AUTH_MODE?: string;
  readonly VITE_CLOUDMARKUP_VISUAL_FIXTURES?: string;
}

declare module "*.svg?no-inline" {
  const assetUrl: string;
  export default assetUrl;
}
