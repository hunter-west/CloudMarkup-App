export const REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP =
  "remove-unused-root-xlink-namespace-v1";

export const BASE_PROVIDER_ICON_TRANSFORMATION_STEPS = Object.freeze([
  "validate-svg-v2",
  "normalize-svg-text-v1",
  "verify-selected-source-v1",
]);

export const PROVIDER_ICON_TRANSFORMATION_STEPS = Object.freeze([
  REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP,
  ...BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
]);
