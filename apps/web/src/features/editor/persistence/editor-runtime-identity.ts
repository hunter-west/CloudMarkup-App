const SESSION_TOKEN_PATTERN = /^[a-z2-7]{8}$/;
const COMMAND_ID_PREFIX_PATTERN = /^operation_editor_[a-z2-7]{8}$/;
const MAX_COMMAND_SEQUENCE = 999_999;
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

let fallbackSequence = 0;

export interface EditorRuntimeIdentity {
  readonly commandIdPrefix: string;
  readonly sessionToken: string;
  readonly writerId: string;
}

function encodeFiveBytes(bytes: Uint8Array): string {
  if (bytes.byteLength !== 5) {
    throw new RangeError("Editor runtime entropy must contain five bytes.");
  }
  const at = (index: number) => bytes[index] ?? 0;
  const indexes = [
    at(0) >> 3,
    ((at(0) & 0x07) << 2) | (at(1) >> 6),
    (at(1) >> 1) & 0x1f,
    ((at(1) & 0x01) << 4) | (at(2) >> 4),
    ((at(2) & 0x0f) << 1) | (at(3) >> 7),
    (at(3) >> 2) & 0x1f,
    ((at(3) & 0x03) << 3) | (at(4) >> 5),
    at(4) & 0x1f,
  ];
  return indexes.map((index) => BASE32_ALPHABET[index] ?? "a").join("");
}
function randomSessionToken(): string {
  try {
    const runtimeGlobal = globalThis as unknown as {
      readonly crypto?: Pick<Crypto, "getRandomValues">;
    };
    if (runtimeGlobal.crypto !== undefined) {
      return encodeFiveBytes(
        runtimeGlobal.crypto.getRandomValues(new Uint8Array(5)),
      );
    }
  } catch {
    // A bounded time/random/counter token remains an opaque uniqueness
    // fallback when the browser crypto surface is unavailable.
  }

  fallbackSequence += 1;
  const random = Math.floor(Math.random() * 0x1_0000_0000);
  const now = Date.now();
  return encodeFiveBytes(
    Uint8Array.from([
      (random >>> 24) & 0xff,
      (random >>> 16) & 0xff,
      (random >>> 8) & 0xff,
      random & 0xff,
      (now ^ fallbackSequence) & 0xff,
    ]),
  );
}

export function createEditorRuntimeIdentity(
  injectedSessionToken?: string,
): EditorRuntimeIdentity {
  const sessionToken = injectedSessionToken ?? randomSessionToken();
  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
    throw new TypeError(
      "Editor runtime session tokens must be eight lowercase base32 characters.",
    );
  }
  return {
    commandIdPrefix: `operation_editor_${sessionToken}`,
    sessionToken,
    writerId: `writer_editor_${sessionToken}`,
  };
}

export function createEditorCommandIdFactory(
  commandIdPrefix: string,
  initialSequence = 0,
): () => string {
  if (!COMMAND_ID_PREFIX_PATTERN.test(commandIdPrefix)) {
    throw new TypeError(
      "Editor command ID prefixes must contain an eight-character lowercase base32 session token.",
    );
  }
  if (
    !Number.isSafeInteger(initialSequence) ||
    initialSequence < 0 ||
    initialSequence > MAX_COMMAND_SEQUENCE
  ) {
    throw new RangeError(
      `Editor command sequence must be between 0 and ${String(MAX_COMMAND_SEQUENCE)}.`,
    );
  }

  let sequence = initialSequence;
  return () => {
    if (sequence >= MAX_COMMAND_SEQUENCE) {
      throw new RangeError(
        "This editor runtime exhausted its bounded command ID sequence.",
      );
    }
    sequence += 1;
    const commandId = `${commandIdPrefix}_${String(sequence).padStart(6, "0")}`;
    if (commandId.length > 32) {
      throw new RangeError("Editor command IDs must not exceed 32 characters.");
    }
    return commandId;
  };
}
