// @tc/pages — pure macro registry, resolvers, and template seeds.
// Depends on @tc/contracts only. No I/O, no clock, no randomness (Invariant 4).
export const PACKAGE = "@tc/pages" as const;

export * from "./result";
export * from "./registry-types";
export * from "./registry";
