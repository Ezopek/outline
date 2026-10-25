import { Team } from "@server/models";

/**
 * The operator opt-in to seeding: `run.ts` seeds fixture teams and users only
 * when this variable is exactly `yes`.
 */
export const ALLOW_SEED = "WIKILINT_BENCH_ALLOW_SEED";

/** How many existing teams a refusal names. */
const NAMED_TEAMS = 5;

/**
 * Decides whether the benchmark CLI may seed its database: only with the
 * operator opt-in, and only into a database that holds no team, deleted
 * teams included.
 *
 * @param env - the process environment.
 * @returns why seeding is refused, or null when it may proceed.
 */
export async function seedRefusal(
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  if (env[ALLOW_SEED] !== "yes") {
    return `Refusing to seed: the benchmark seeds fixture teams and users into DATABASE_URL; set ${ALLOW_SEED}=yes to confirm it is a fresh benchmark database`;
  }
  const count = await Team.count({ paranoid: false });
  if (count === 0) {
    return null;
  }
  const teams = await Team.findAll({
    attributes: ["id", "name"],
    paranoid: false,
    order: [["createdAt", "ASC"]],
    limit: NAMED_TEAMS,
  });
  const names = teams.map((team) => `"${team.name}" (${team.id})`).join(", ");
  return `Refusing to seed: the database already holds ${count} team(s): ${names}${count > teams.length ? ", …" : ""}; use a fresh benchmark database`;
}
