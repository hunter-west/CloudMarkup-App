export class DeferredRouteModuleError extends Error {
  public constructor() {
    super("This view could not be loaded.");
    this.name = "DeferredRouteModuleError";
  }
}

/** Only module loading is classified here; rendering errors keep their existing boundary. */
export async function loadDeferredRouteModule<T>(
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch {
    throw new DeferredRouteModuleError();
  }
}
