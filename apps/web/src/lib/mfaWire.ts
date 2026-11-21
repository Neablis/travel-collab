// What `/api/account/mfa/*` and `/api/mfa/verify` say to the Security tab and the
// verify screen (M62). Plain JSON shapes, not contract schemas: no other consumer
// reads them, and a schema in `packages/contracts` would need a changelog entry
// for a surface that is this app talking to itself.

export type MfaFactorKind = "passkey" | "totp";

export interface MfaFactorView {
  id: string;
  name: string;
  kind: MfaFactorKind;
  createdAt: string;
  lastUsedAt: string | null;
}

/** `GET /api/account/mfa/factors`. */
export interface MfaStatusResponse {
  enabled: boolean;
  factors: MfaFactorView[];
  /** Unspent recovery codes, out of ten; zero while two-step sign-in is off. */
  recoveryCodesLeft: number;
}

/**
 * What a route returns once it has checked a factor. The browser gives it to
 * NextAuth's `update`, which is the only way the token learns it passed
 * (`server/mfa/state.ts`, `mintSecondFactorProof`).
 */
export interface SecondFactorProofBody {
  method: "webauthn" | "otp" | "recovery" | "epoch";
  epoch: number;
  expiresAt: number;
  proof: string;
}
