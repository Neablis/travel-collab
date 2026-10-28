import { AsyncLocalStorage } from "node:async_hooks";

// **Where an OAuth access token may be spent** (ADR-083 §7). A `tco_` token's
// audience is the MCP endpoint (RFC 8707), but MCP tools dispatch through v1's
// own handlers, so without a marker `resolveActor` could not tell a tool call
// from someone pasting the token into a direct `/api/v1` call. The MCP route
// runs each dispatch inside this context, and `resolveActor` accepts a `tco_`
// token only when it finds it.
//
// `AsyncLocalStorage` rather than a flag on the request: the synthetic
// `Request` a tool builds is just headers and a body, and a header could be
// sent by anyone.

const dispatch = new AsyncLocalStorage<true>();

/** Run one MCP tool dispatch; everything it awaits sees `inMcpDispatch()`. */
export function runInMcpDispatch<T>(fn: () => T): T {
  return dispatch.run(true, fn);
}

/** Is this code running inside an MCP tool dispatch? */
export function inMcpDispatch(): boolean {
  return dispatch.getStore() === true;
}
