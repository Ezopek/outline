import { ScanAdmission, lintWikiAdmission } from "./admission";

describe("ScanAdmission", () => {
  it("refuses a second lease while one holds the slot", () => {
    const admission = new ScanAdmission();
    const first = admission.lease();
    const second = admission.lease();

    expect(first.acquire()).toBe(true);
    expect(second.acquire()).toBe(false);

    first.release();
    expect(second.acquire()).toBe(true);
    second.release();
  });

  it("releases idempotently", () => {
    const admission = new ScanAdmission();
    const first = admission.lease();
    first.acquire();
    first.release();
    const second = admission.lease();
    expect(second.acquire()).toBe(true);

    first.release();

    expect(admission.lease().acquire()).toBe(false);
    second.release();
  });

  it("does not free another lease's slot when releasing an unacquired lease", () => {
    const admission = new ScanAdmission();
    const holder = admission.lease();
    const refused = admission.lease();
    const idle = admission.lease();
    holder.acquire();
    refused.acquire();

    refused.release();
    idle.release();

    expect(admission.lease().acquire()).toBe(false);
    holder.release();
    expect(admission.lease().acquire()).toBe(true);
  });

  it("keeps acquire usable as a detached function", () => {
    const admission = new ScanAdmission();
    const { acquire, release } = admission.lease();

    expect(acquire()).toBe(true);
    expect(acquire()).toBe(true);
    release();
    expect(admission.lease().acquire()).toBe(true);
  });

  it("exports one process singleton", () => {
    expect(lintWikiAdmission).toBeInstanceOf(ScanAdmission);
  });
});
