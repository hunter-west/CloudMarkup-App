const dismissTransientOverlaysEvent =
  "cloudmarkup:ui:dismiss-transient-overlays";
const modalOverlayOpenedEvent = "cloudmarkup:ui:modal-overlay-opened";

interface DismissTransientOverlaysDetail {
  readonly exceptId?: string;
  readonly claimReturnFocusTarget: ClaimOverlayReturnFocusTarget;
}

export type ClaimOverlayReturnFocusTarget = (target: HTMLElement) => void;

interface ModalOverlayOpeningDetail {
  readonly claimReturnFocusTarget: ClaimOverlayReturnFocusTarget;
  readonly owner: HTMLElement | null;
}

export function dismissTransientOverlays(
  ownerDocument: Document,
  exceptId?: string,
): HTMLElement | null {
  let claimedTarget: HTMLElement | null = null;
  const claimReturnFocusTarget: ClaimOverlayReturnFocusTarget = (target) => {
    if (claimedTarget === null && target.isConnected) {
      claimedTarget = target;
    }
  };
  ownerDocument.dispatchEvent(
    new CustomEvent<DismissTransientOverlaysDetail>(
      dismissTransientOverlaysEvent,
      {
        detail:
          exceptId === undefined
            ? { claimReturnFocusTarget }
            : { claimReturnFocusTarget, exceptId },
      },
    ),
  );
  return claimedTarget;
}

export function observeTransientOverlayDismissal(
  ownerDocument: Document,
  listener: (
    exceptId: string | undefined,
    claimReturnFocusTarget: ClaimOverlayReturnFocusTarget,
  ) => void,
): () => void {
  const handleDismissal = (event: Event) => {
    const detail = (
      event as CustomEvent<DismissTransientOverlaysDetail | undefined>
    ).detail;
    if (typeof detail?.claimReturnFocusTarget === "function") {
      listener(detail.exceptId, detail.claimReturnFocusTarget);
    }
  };
  ownerDocument.addEventListener(
    dismissTransientOverlaysEvent,
    handleDismissal,
  );
  return () => {
    ownerDocument.removeEventListener(
      dismissTransientOverlaysEvent,
      handleDismissal,
    );
  };
}

export function announceModalOverlayOpening(
  ownerDocument: Document,
  owner: HTMLElement | null,
): HTMLElement | null {
  let claimedTarget: HTMLElement | null = null;
  const detail: ModalOverlayOpeningDetail = {
    claimReturnFocusTarget(target) {
      if (claimedTarget === null && target.isConnected) {
        claimedTarget = target;
      }
    },
    owner,
  };
  ownerDocument.dispatchEvent(
    new CustomEvent<ModalOverlayOpeningDetail>(modalOverlayOpenedEvent, {
      detail,
    }),
  );
  return claimedTarget;
}

export function observeModalOverlayOpening(
  ownerDocument: Document,
  listener: (
    owner: HTMLElement | null,
    claimReturnFocusTarget: ClaimOverlayReturnFocusTarget,
  ) => void,
): () => void {
  const handleOpening = (event: Event) => {
    const detail = (event as CustomEvent<ModalOverlayOpeningDetail | undefined>)
      .detail;
    if (typeof detail?.claimReturnFocusTarget === "function") {
      listener(detail.owner, detail.claimReturnFocusTarget);
    }
  };
  ownerDocument.addEventListener(modalOverlayOpenedEvent, handleOpening);
  return () => {
    ownerDocument.removeEventListener(modalOverlayOpenedEvent, handleOpening);
  };
}
