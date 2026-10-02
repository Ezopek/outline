/** A claim on the scan slot that may acquire it once and release it. */
export interface ScanLease {
  /**
   * Acquires the slot unless another lease holds it. There is no queue.
   *
   * @returns whether this lease holds the slot.
   */
  acquire: () => boolean;
  /** Releases the slot if this lease holds it; otherwise does nothing. */
  release: () => void;
}

/** Admits at most one scan at a time on this process. */
export class ScanAdmission {
  private busy = false;

  /**
   * Creates a lease on the slot.
   *
   * @returns the lease, which holds nothing until it acquires.
   */
  lease(): ScanLease {
    let held = false;
    return {
      acquire: () => {
        if (!held && !this.busy) {
          this.busy = true;
          held = true;
        }
        return held;
      },
      release: () => {
        if (held) {
          held = false;
          this.busy = false;
        }
      },
    };
  }
}

/** The per-process `lint_wiki` admission slot (AD-16). */
export const lintWikiAdmission = new ScanAdmission();
