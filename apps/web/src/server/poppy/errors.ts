// **The three errors a Personal Agent reads by shape** (Poppy 5.3, 3.4): HTTP
// 400 and `{ "error": … }`, outside v1's `{ error: { code, message } }`
// envelope, because the agent keys on the string. 400 and not 401 so an OAuth
// library does not discard an access token that was fine (spec 5.3).

export type PoppyErrorCode = "invalid_session" | "session_ended" | "version_unsupported";

/** The 400 for `code`; `description` is for the developer and never says which key or token. */
export function poppyError(code: PoppyErrorCode, description?: string): Response {
  return Response.json(
    description === undefined ? { error: code } : { error: code, error_description: description },
    { status: 400 },
  );
}
