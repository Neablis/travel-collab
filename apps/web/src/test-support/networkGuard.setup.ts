// The integration lane's setup file (`vitest.config.ts`). The unit lane calls
// `installNetworkGuard()` from `vitest.setup.ts` instead, alongside its DOM
// shims, which the integration lane has no use for.
import { installNetworkGuard } from "./networkGuard";

installNetworkGuard();
