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
 * Lists the advisory locks on a key held or awaited by a backend.
 *
 * @param observer - the client that queries `pg_locks`.
 * @param key - the advisory lock key.
 * @param pid - the backend process ID.
 * @returns the backend's lock modes with whether each is granted.
 */
async function locks(observer: Client, key: number, pid: number) {
  const { rows } = await observer.query<{ mode: string; granted: boolean }>(
    `SELECT mode, granted FROM pg_locks
     WHERE locktype = 'advisory'
       AND classid = ($1::bigint >> 32)::oid
       AND objid = ($1::bigint & 4294967295)::oid
       AND objsubid = 1
       AND pid = $2
     ORDER BY mode`,
    [key, pid]
  );
  return rows;
}

/**
 * Lists the database test mutex locks held or awaited by a backend.
 *
 * @param observer - the client that queries `pg_locks`.
 * @param pid - the backend process ID.
 * @returns the backend's lock modes with whether each is granted.
 */
function mutexLocks(observer: Client, pid: number) {
  return locks(observer, DatabaseTestMutexKey, pid);
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

/**
 * A private advisory lock key for the queue test. It must differ from
 * `DatabaseTestMutexKey`: a test that waits on the mutex key while its own file
 * holds it in shared mode deadlocks with another file's waiting exclusive
 * section.
 */
const QueueProbeKey = DatabaseTestMutexKey + 1;

describe("advisory lock queue", () => {
  it(
    "queues a later shared request behind a waiting exclusive request until it ends",
    async () => {
      const sharer = await connectDatabaseClient();
      const exclusive = await connectDatabaseClient();
      const latecomer = await connectDatabaseClient();
      try {
        const exclusivePid = await backendPid(exclusive);
        const latecomerPid = await backendPid(latecomer);
        await sharer.query("SELECT pg_advisory_lock_shared($1)", [
          QueueProbeKey,
        ]);

        let exclusiveGranted = false;
        const exclusiveLock = exclusive
          .query("SELECT pg_advisory_lock($1)", [QueueProbeKey])
          .then(() => {
            exclusiveGranted = true;
          });
        await vi.waitFor(
          async () =>
            expect(await locks(sharer, QueueProbeKey, exclusivePid)).toEqual([
              { mode: "ExclusiveLock", granted: false },
            ]),
          waitOptions
        );

        let latecomerGranted = false;
        const latecomerShared = latecomer
          .query("SELECT pg_advisory_lock_shared($1)", [QueueProbeKey])
          .then(() => {
            latecomerGranted = true;
          });
        await vi.waitFor(
          async () =>
            expect(await locks(sharer, QueueProbeKey, latecomerPid)).toEqual([
              { mode: "ShareLock", granted: false },
            ]),
          waitOptions
        );

        await sharer.query("SELECT pg_advisory_unlock_shared($1)", [
          QueueProbeKey,
        ]);
        await exclusiveLock;
        expect(exclusiveGranted).toBe(true);
        expect(await locks(sharer, QueueProbeKey, latecomerPid)).toEqual([
          { mode: "ShareLock", granted: false },
        ]);
        expect(latecomerGranted).toBe(false);

        await exclusive.query("SELECT pg_advisory_unlock($1)", [QueueProbeKey]);
        await latecomerShared;
        expect(await locks(sharer, QueueProbeKey, latecomerPid)).toEqual([
          { mode: "ShareLock", granted: true },
        ]);
      } finally {
        await latecomer.end();
        await exclusive.end();
        await sharer.end();
      }
    },
    ExclusiveTimeoutMs
  );
});

describe("withExclusiveDatabase", () => {
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
