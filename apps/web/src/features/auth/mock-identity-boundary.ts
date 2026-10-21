/** Local synthetic identity is a development fixture, never a deployable fallback. */
export function mayRenderLocalMockIdentity(development: boolean): boolean {
  return development;
}
