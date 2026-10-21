import type { CustomerCiActionPinV1 } from "./contracts.js";

export const CUSTOMER_CI_ACTION_PINS_V1 = Object.freeze([
  {
    action: "actions/checkout",
    commit: "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
    version: "v6.0.2",
  },
  {
    action: "actions/download-artifact",
    commit: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    version: "v8.0.1",
  },
  {
    action: "actions/setup-node",
    commit: "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    version: "v6.4.0",
  },
  {
    action: "actions/upload-artifact",
    commit: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    version: "v7.0.1",
  },
  {
    action: "aws-actions/configure-aws-credentials",
    commit: "e6de054238d6b7531b4efff3b6587d9aade6a06c",
    version: "v6.2.3",
  },
  {
    action: "hashicorp/setup-terraform",
    commit: "dfe3c3f87815947d99a8997f908cb6525fc44e9e",
    version: "v4.0.1",
  },
] as const satisfies readonly CustomerCiActionPinV1[]);

export function pinnedAction(action: CustomerCiActionPinV1["action"]): string {
  const pin = CUSTOMER_CI_ACTION_PINS_V1.find((item) => item.action === action);
  if (pin === undefined) {
    throw new Error(`Action ${action} is not in the reviewed v1 registry.`);
  }
  return `${pin.action}@${pin.commit}`;
}
