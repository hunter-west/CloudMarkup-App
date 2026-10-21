declare module "*.css";

declare module "*.css?inline" {
  const stylesheet: string;
  export default stylesheet;
}

declare module "*.css?raw" {
  const stylesheet: string;
  export default stylesheet;
}
