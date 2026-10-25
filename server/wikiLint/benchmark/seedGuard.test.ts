import { Team } from "@server/models";
import { buildTeam } from "@server/test/factories";
import { ALLOW_SEED, seedRefusal } from "./seedGuard";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seedRefusal", () => {
  it.each([undefined, "", "true", "YES"])(
    "refuses, naming the variable, without the opt-in (%s) and before reading the database",
    async (value) => {
      const count = vi.spyOn(Team, "count");
      const refusal = await seedRefusal({ [ALLOW_SEED]: value });
      expect(refusal).toContain(`${ALLOW_SEED}=yes`);
      expect(count).not.toHaveBeenCalled();
    }
  );

  it("refuses, naming the teams, when the database already holds one", async () => {
    const team = await buildTeam();
    expect(await seedRefusal({ [ALLOW_SEED]: "yes" })).toMatch(
      /^Refusing to seed: the database already holds \d+ team\(s\): "/
    );

    vi.spyOn(Team, "count").mockResolvedValue(1);
    vi.spyOn(Team, "findAll").mockResolvedValue([team]);
    expect(await seedRefusal({ [ALLOW_SEED]: "yes" })).toBe(
      `Refusing to seed: the database already holds 1 team(s): "${team.name}" (${team.id}); use a fresh benchmark database`
    );
  });

  it("lets an opted-in run seed a database with no team, deleted teams counted", async () => {
    const count = vi.spyOn(Team, "count").mockResolvedValue(0);
    expect(await seedRefusal({ [ALLOW_SEED]: "yes" })).toBeNull();
    expect(count).toHaveBeenCalledWith({ paranoid: false });
  });
});
