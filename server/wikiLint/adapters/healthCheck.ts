import type { Context } from "koa";
import { toError } from "@shared/utils/error";
import Logger from "@server/logging/Logger";
import type { PolicyReadiness } from "./policyConfig";
import { applyPolicyReadiness } from "./policyConfig";

interface HealthHandlerOptions {
  /** The worker's startup policy readiness. */
  readiness: PolicyReadiness;
  /** Rejects when the database is unreachable. */
  checkDatabase: () => Promise<unknown>;
  /** Rejects when Redis is unreachable. */
  checkRedis: () => Promise<unknown>;
}

/**
 * Creates the `/_health` handler. A worker that is not policy-ready answers
 * 503 before any dependency check (AD-19); otherwise the baseline database
 * and Redis checks decide between `OK` and 500.
 *
 * @param options - the readiness and dependency checks.
 * @returns the Koa handler.
 */
export function createHealthHandler({
  readiness,
  checkDatabase,
  checkRedis,
}: HealthHandlerOptions) {
  return async (ctx: Context) => {
    if (!applyPolicyReadiness(ctx, readiness)) {
      return;
    }

    try {
      await checkDatabase();
    } catch (err) {
      Logger.error("Database connection failed", toError(err));
      ctx.status = 500;
      return;
    }

    try {
      await checkRedis();
    } catch (err) {
      Logger.error("Redis ping failed", toError(err));
      ctx.status = 500;
      return;
    }

    ctx.body = "OK";
  };
}
