import {
  parseBearerToken,
  type Principal,
  type PrincipalResolver,
} from "../../application/identity.js";

const TOKEN_PREFIX = "local-development:";

export interface LocalDevelopmentIdentityOptions {
  readonly enabled: boolean;
  readonly principalsByToken: Readonly<
    Record<
      string,
      Omit<Principal, "authenticationSource"> & {
        readonly authenticationSource?: "local-development";
      }
    >
  >;
  readonly runtimeEnvironment: string;
}

/**
 * LOCAL DEVELOPMENT ONLY. Construction fails closed unless local identity is
 * explicitly enabled in a non-production process.
 */
export class LocalDevelopmentPrincipalResolver implements PrincipalResolver {
  readonly #principals: ReadonlyMap<string, Principal>;

  constructor(options: LocalDevelopmentIdentityOptions) {
    if (
      !options.enabled ||
      options.runtimeEnvironment !== "local" ||
      process.env["NODE_ENV"] === "production"
    ) {
      throw new Error(
        "The local-development identity adapter cannot run in this environment.",
      );
    }

    this.#principals = new Map(
      Object.entries(options.principalsByToken).map(([token, principal]) => [
        token,
        {
          ...principal,
          authenticationSource: "local-development" as const,
        },
      ]),
    );
  }

  resolve(authorization: string | undefined): Promise<Principal | null> {
    const bearerToken = parseBearerToken(authorization);
    if (bearerToken?.startsWith(TOKEN_PREFIX) !== true) {
      return Promise.resolve(null);
    }

    const token = bearerToken.slice(TOKEN_PREFIX.length);
    const principal = this.#principals.get(token);
    return Promise.resolve(
      principal === undefined ? null : structuredClone(principal),
    );
  }
}
