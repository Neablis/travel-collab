import { faker } from "@faker-js/faker";

// A test that uses generated data must be reproducible, not argued about
// after the fact — seed once per process from a recorded default, override
// via env var to replay a specific failure.
export const FACTORY_SEED = Number(process.env.FACTORY_SEED ?? 20260823);
faker.seed(FACTORY_SEED);

export { faker };
