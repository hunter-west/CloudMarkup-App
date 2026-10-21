import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  acquireProjectEditingLeaseV1Schema,
  mutateProjectEditingLeaseV1Schema,
  projectEditingLeaseIdV1Schema,
  projectEditingLeaseProofV1Schema,
  projectEditingLeaseResponseV1Schema,
  projectEditingLeaseStateV1Schema,
  projectEditingLeaseTokenV1Schema,
} from "./project-editing-leases.js";
import { applyDraftCommandV1Schema, saveDraftV1Schema } from "./resources.js";

const token = Buffer.alloc(32, 0xab).toString("base64url");
const proof = {
  leaseId: "projectlease_12345678-1234-4234-8234-123456789abc",
  token,
};
const available = {
  contractVersion: 1,
  projectId: "project_test",
  state: "available",
};
const held = {
  ...available,
  state: "held",
  expiresAt: "2026-09-06T13:00:00.000Z",
};
const owned = { ...held, state: "owned", leaseId: proof.leaseId };

describe("project editing lease wire contracts", () => {
  it("requires the exact database-compatible lowercase lease UUID shape", () => {
    expect(projectEditingLeaseIdV1Schema.parse(proof.leaseId)).toBe(
      proof.leaseId,
    );
    for (const leaseId of [
      "projectlease_fixture",
      proof.leaseId.toUpperCase(),
      proof.leaseId + "x",
      proof.leaseId.replace("9abc", "9abg"),
    ]) {
      expect(projectEditingLeaseIdV1Schema.safeParse(leaseId).success).toBe(
        false,
      );
      expect(
        projectEditingLeaseProofV1Schema.safeParse({ ...proof, leaseId })
          .success,
      ).toBe(false);
      expect(
        projectEditingLeaseStateV1Schema.safeParse({ ...owned, leaseId })
          .success,
      ).toBe(false);
    }
  });
  it("accepts canonical unpadded encodings of exactly32 bytes", () => {
    for (let byte = 0; byte < 256; byte += 1) {
      const canonical = Buffer.alloc(32, byte).toString("base64url");
      expect(canonical).toHaveLength(43);
      expect(projectEditingLeaseTokenV1Schema.parse(canonical)).toBe(canonical);
      expect(Buffer.from(canonical, "base64url")).toHaveLength(32);
    }
  });

  it("rejects every noncanonical final sextet even when permissive decoding yields32 bytes", () => {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let index = 0; index < alphabet.length; index += 1) {
      const candidate = token.slice(0, 42) + alphabet.charAt(index);
      expect(Buffer.from(candidate, "base64url")).toHaveLength(32);
      expect(
        projectEditingLeaseTokenV1Schema.safeParse(candidate).success,
      ).toBe(index % 4 === 0);
    }
  });

  it.each([
    "",
    "A".repeat(42),
    "A".repeat(44),
    token + "=",
    token + "\n",
    " " + token,
    "+" + token.slice(1),
    "/" + token.slice(1),
  ])("rejects noncanonical token %j", (candidate) => {
    expect(projectEditingLeaseTokenV1Schema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it("requires exact versioned acquisition and mutation shapes, without supplied tenant or expiry authority", () => {
    expect(
      acquireProjectEditingLeaseV1Schema.parse({ contractVersion: 1, token }),
    ).toEqual({ contractVersion: 1, token });
    expect(projectEditingLeaseProofV1Schema.parse(proof)).toEqual(proof);
    expect(
      mutateProjectEditingLeaseV1Schema.parse({ contractVersion: 1, ...proof }),
    ).toEqual({ contractVersion: 1, ...proof });
    for (const extra of [
      { organizationId: "org_other" },
      { principalId: "principal_other" },
      { expiresAt: held.expiresAt },
      { force: true },
    ]) {
      expect(
        acquireProjectEditingLeaseV1Schema.safeParse({
          contractVersion: 1,
          token,
          ...extra,
        }).success,
      ).toBe(false);
      expect(
        mutateProjectEditingLeaseV1Schema.safeParse({
          contractVersion: 1,
          ...proof,
          ...extra,
        }).success,
      ).toBe(false);
      expect(
        projectEditingLeaseProofV1Schema.safeParse({ ...proof, ...extra })
          .success,
      ).toBe(false);
    }
    expect(
      acquireProjectEditingLeaseV1Schema.safeParse({ token }).success,
    ).toBe(false);
    expect(
      mutateProjectEditingLeaseV1Schema.safeParse({
        contractVersion: 2,
        ...proof,
      }).success,
    ).toBe(false);
    expect(
      mutateProjectEditingLeaseV1Schema.safeParse({ contractVersion: 1, token })
        .success,
    ).toBe(false);
    expect(
      projectEditingLeaseProofV1Schema.safeParse({
        ...proof,
        leaseId: "project_wrong-prefix",
      }).success,
    ).toBe(false);
  });

  it("exposes only availability or the caller's opaque owned lease, never a token or holder identity", () => {
    for (const state of [available, held, owned]) {
      expect(
        projectEditingLeaseResponseV1Schema.parse({
          apiVersion: "v1",
          data: state,
        }).data,
      ).toEqual(state);
      for (const extra of [
        { token },
        { holderId: "principal_other" },
        { principalId: "principal_other" },
        { holderEmail: "synthetic@example.test" },
        { organizationId: "org_other" },
      ]) {
        expect(
          projectEditingLeaseStateV1Schema.safeParse({ ...state, ...extra })
            .success,
        ).toBe(false);
      }
    }
    expect(
      projectEditingLeaseStateV1Schema.safeParse({
        ...held,
        leaseId: proof.leaseId,
      }).success,
    ).toBe(false);
    expect(
      projectEditingLeaseStateV1Schema.safeParse({
        ...available,
        expiresAt: held.expiresAt,
      }).success,
    ).toBe(false);
    expect(
      projectEditingLeaseStateV1Schema.safeParse({
        ...owned,
        expiresAt: "tomorrow",
      }).success,
    ).toBe(false);
    expect(
      projectEditingLeaseResponseV1Schema.safeParse({
        apiVersion: "v1",
        data: available,
        token,
      }).success,
    ).toBe(false);
  });

  it("keeps the save envelope backward-compatible while strictly validating an optional editing proof", () => {
    // This wire envelope intentionally delegates document validation to the
    // application; this synthetic value is not a valid architecture fixture.
    const save = { contractVersion: 1, architectureDocument: {} };
    expect(saveDraftV1Schema.parse(save)).toEqual(save);
    expect(
      saveDraftV1Schema.parse({ ...save, editingLease: proof }).editingLease,
    ).toEqual(proof);
    for (const editingLease of [
      null,
      {},
      { ...proof, token: token.slice(0, 42) + "B" },
      { ...proof, holderId: "principal_other" },
    ]) {
      expect(
        saveDraftV1Schema.safeParse({ ...save, editingLease }).success,
      ).toBe(false);
    }
  });

  it("preserves graph-command compatibility and validates the same optional proof", () => {
    const input = {
      contractVersion: 1,
      command: {
        schemaVersion: 1,
        commandId: "operation_synthetic_move",
        inverseCommandId: "operation_synthetic_inverse",
        origin: "user",
        target: {
          documentId: "document_synthetic",
          architectureId: "architecture_synthetic",
          revisionId: "revision_synthetic",
        },
        kind: "move-node",
        nodeId: "node_synthetic",
        expectedPosition: { x: 0, y: 0 },
        position: { x: 10, y: 20 },
      },
    };
    expect(applyDraftCommandV1Schema.parse(input)).toEqual(input);
    const contentBinding = {
      expectedContentDigest: "sha256:" + "1".repeat(64),
      resultingContentDigest: "sha256:" + "2".repeat(64),
    };
    expect(
      applyDraftCommandV1Schema.parse({ ...input, contentBinding })
        .contentBinding,
    ).toEqual(contentBinding);
    for (const invalid of [
      {},
      { ...contentBinding, expectedContentDigest: "unbound" },
      { ...contentBinding, trusted: true },
    ])
      expect(
        applyDraftCommandV1Schema.safeParse({
          ...input,
          contentBinding: invalid,
        }).success,
      ).toBe(false);
    expect(
      applyDraftCommandV1Schema.parse({ ...input, editingLease: proof })
        .editingLease,
    ).toEqual(proof);
    expect(
      applyDraftCommandV1Schema.safeParse({
        ...input,
        editingLease: { ...proof, token: token + "=" },
      }).success,
    ).toBe(false);
  });
});
