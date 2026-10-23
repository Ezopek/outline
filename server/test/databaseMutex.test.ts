import type { Client } from "pg";
import {
  DatabaseTestMutexKey,
  connectDatabaseClient,
  databaseMutexPid,
  withExclusiveDatabase,
} from "./databaseMutex";

/** Long enough to wait for another worker's current test file to end. */
const ExclusiveTimeoutMs = 300_000;

/** How long `vi.waitFor` polls for a lock state. */
const waitOptions = { timeout: ExclusiveTimeoutMs, interval: 20 };

/**
 * Lists the database test mutex locks held or awaited by a backend.
 *
 * @param observer - the client that queries `pg_locks`.
 * @param pid - the backend process ID.
 * @returns the backend's lock modes with whether each is granted.
 */
async function mutexLocks(observer: Client, pid: number) {
  const { rows } = await observer.query<{ mode: string; granted: boolean }>(
    `SELECT mode, granted FROM pg_locks
     WHERE locktype = 'advisory'
       AND classid = ($1::bigint >> 32)::oid
       AND objid = ($1::bigint & 4294967295)::oid
       AND objsubid = 1
       AND pid = $2
     ORDER BY mode`,
    [DatabaseTestMutexKey, pid]
  );
  return rows;
}

/**
 * Returns the backend process ID of a client.
 *
 * @param connected - the client.
 * @returns the process ID.
 */
async function backendPid(connected: Client) {
  const { rows } = await connected.query<{ pid: number }>(
    "SELECT pg_backend_pid() AS pid"
  );
  return rows[0].pid;
}

describe("withExclusiveDatabase", () => {
  it(
    "queues a later shared request behind a waiting exclusive section until it ends",
    async () => {
      const sharer = await connectDatabaseClient();
      const latecomer = await connectDatabaseClient();
      try {
        const filePid = databaseMutexPid();
        const latecomerPid = await backendPid(latecomer);
        await sharer.query("SELECT pg_advisory_lock_shared($1)", [
          DatabaseTestMutexKey,
        ]);

        let entered = false;
        let leave = () => {};
        const left = new Promise<void>((resolve) => {
          leave = resolve;
        });
        const exclusive = withExclusiveDatabase(async () => {
          entered = true;
          await left;
          return "section result";
        });
        await vi.waitFor(
          async () =>
            expect(await mutexLocks(sharer, filePid)).toEqual([
              { mode: "ExclusiveLock", granted: false },
            ]),
          waitOptions
        );

        let latecomerGranted = false;
        const latecomerShared = latecomer
          .query("SELECT pg_advisory_lock_shared($1)", [DatabaseTestMutexKey])
          .then(() => {
            latecomerGranted = true;
          });
        await vi.waitFor(
          async () =>
            expect(await mutexLocks(sharer, latecomerPid)).toEqual([
              { mode: "ShareLock", granted: false },
            ]),
          waitOptions
        );
        expect(entered).toBe(false);

        await sharer.query("SELECT pg_advisory_unlock_shared($1)", [
          DatabaseTestMutexKey,
        ]);
        await vi.waitFor(() => expect(entered).toBe(true), waitOptions);
        expect(await mutexLocks(sharer, latecomerPid)).toEqual([
          { mode: "ShareLock", granted: false },
        ]);
        expect(latecomerGranted).toBe(false);

        leave();
        await expect(exclusive).resolves.toBe("section result");
        await latecomerShared;
        expect(await mutexLocks(sharer, latecomerPid)).toEqual([
          { mode: "ShareLock", granted: true },
        ]);
        expect(await mutexLocks(sharer, filePid)).toEqual([
          { mode: "ShareLock", granted: true },
        ]);
      } finally {
        await latecomer.end();
        await sharer.end();
      }
    },
    ExclusiveTimeoutMs
  );

  it(
    "releases the exclusive lock and restores the shared hold when the section throws",
    async () => {
      const observer = await connectDatabaseClient();
      try {
        const failure = new Error("section failed");
        await expect(
          withExclusiveDatabase(async () => {
            expect(await mutexLocks(observer, databaseMutexPid())).toEqual([
              { mode: "ExclusiveLock", granted: true },
            ]);
            throw failure;
          })
        ).rejects.toBe(failure);
        expect(await mutexLocks(observer, databaseMutexPid())).toEqual([
          { mode: "ShareLock", granted: true },
        ]);
      } finally {
        await observer.end();
      }
    },
    ExclusiveTimeoutMs
  );

  it(
    "refuses a section while another section of the file is active",
    async () => {
      await withExclusiveDatabase(async () => {
        await expect(withExclusiveDatabase(async () => {})).rejects.toThrow(
          "withExclusiveDatabase is already running a section in this test file"
        );
      });
    },
    ExclusiveTimeoutMs
  );
});
