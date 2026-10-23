import { Client } from "pg";
import { sequelize } from "@server/storage/database";

/**
 * The key of the session-level advisory lock that serializes the server test
 * files sharing the test database against a test section that holds a
 * table-level lock on a shared table. Every test file holds it in shared mode
 * for its whole run (see `setup.ts`); `withExclusiveDatabase` holds it in
 * exclusive mode. Nothing else may use this key on the test database.
 */
export const DatabaseTestMutexKey = 470047;

/** This file's dedicated mutex client, while it is open. */
let client: Client | undefined;

/** The backend process ID of this file's mutex client. */
let clientPid: number | undefined;

/** Whether this file's mutex client holds the lock in shared mode. */
let sharedHeld = false;

/** Whether a `withExclusiveDatabase` section of this file is active. */
let sectionActive = false;

/**
 * Opens a client to the test database outside the Sequelize pool, with the
 * connection settings the Sequelize instance resolved.
 *
 * @returns the connected client.
 */
export async function connectDatabaseClient(): Promise<Client> {
  const { host, port, database, username, password } = sequelize.config;
  const connected = new Client({
    host,
    port: port ? Number(port) : undefined,
    database,
    user: username,
    password: password ?? undefined,
  });
  await connected.connect();
  return connected;
}

/**
 * Opens this file's mutex client and takes the lock in shared mode, waiting
 * behind any active or waiting exclusive section of another file.
 */
export async function holdDatabaseShared(): Promise<void> {
  client = await connectDatabaseClient();
  const { rows } = await client.query<{ pid: number }>(
    "SELECT pg_backend_pid() AS pid"
  );
  clientPid = rows[0].pid;
  await client.query("SELECT pg_advisory_lock_shared($1)", [
    DatabaseTestMutexKey,
  ]);
  sharedHeld = true;
}

/**
 * Releases this file's shared hold and closes its mutex client. Closing the
 * session releases the lock even when the explicit release fails or a section
 * is still waiting for it.
 */
export async function releaseDatabaseHold(): Promise<void> {
  const holder = client;
  client = undefined;
  if (!holder) {
    return;
  }
  try {
    if (sharedHeld && !sectionActive) {
      await holder.query("SELECT pg_advisory_unlock_shared($1)", [
        DatabaseTestMutexKey,
      ]);
    }
  } finally {
    sharedHeld = false;
    await holder.end();
  }
}

/**
 * The backend process ID of this file's mutex client, to inspect its locks.
 *
 * @returns the process ID.
 * @throws when this file has no mutex client.
 */
export function databaseMutexPid(): number {
  if (clientPid === undefined) {
    throw new Error("This test file has no database mutex client");
  }
  return clientPid;
}

/**
 * Runs a section with no other test file running against the test database.
 * It trades this file's shared hold for the exclusive lock, which waits until
 * every other file holding the lock has ended, and makes their next files wait
 * at their setup until the section ends. The shared hold is restored
 * afterwards, also when the section or the exclusive acquisition fails. Not
 * supported in `test.concurrent` tests.
 *
 * @param section - the work to run exclusively.
 * @returns the section's result.
 * @throws when this file does not hold the lock in shared mode, when another
 * section of this file is active, when the shared hold cannot be restored, or
 * the section's or the lock statements' error.
 */
export async function withExclusiveDatabase<T>(
  section: () => Promise<T>
): Promise<T> {
  if (sectionActive) {
    throw new Error(
      "withExclusiveDatabase is already running a section in this test file; nested or concurrent sections are not supported"
    );
  }
  const holder = client;
  if (!holder || !sharedHeld) {
    throw new Error(
      "withExclusiveDatabase requires this test file's shared hold on the database test mutex, which it does not hold"
    );
  }
  sectionActive = true;
  try {
    await holder.query("SELECT pg_advisory_unlock_shared($1)", [
      DatabaseTestMutexKey,
    ]);
    sharedHeld = false;
    await holder.query("SELECT pg_advisory_lock($1)", [DatabaseTestMutexKey]);
    try {
      return await section();
    } finally {
      await holder.query("SELECT pg_advisory_unlock($1)", [
        DatabaseTestMutexKey,
      ]);
    }
  } finally {
    sectionActive = false;
    if (!sharedHeld) {
      await restoreSharedHold(holder);
    }
  }
}

/**
 * Takes this file's shared hold again after an exclusive section.
 *
 * @param holder - this file's mutex client.
 * @throws when the shared hold cannot be restored.
 */
async function restoreSharedHold(holder: Client): Promise<void> {
  try {
    await holder.query("SELECT pg_advisory_lock_shared($1)", [
      DatabaseTestMutexKey,
    ]);
    sharedHeld = true;
  } catch (error) {
    throw new Error(
      `withExclusiveDatabase could not restore this test file's shared hold on the database test mutex: ${String(error)}`
    );
  }
}
