import { describe, expect, it } from "vitest";
import type { PullRequestView } from "@coordy/protocol";
import {
  deriveChecksStatus,
  deriveMergeStatus,
  checksStatusLabel,
  shouldShowPullRequestStats,
} from "../lib/coordy/pull-request";

function pr(partial: Partial<PullRequestView> & Pick<PullRequestView, "number">): PullRequestView {
  return partial;
}

describe("pull request CI and mergeability", () => {
  it("treats a missing snapshot as unavailable, never as passed", () => {
    expect(deriveChecksStatus(pr({ number: 1 }))).toEqual({ kind: "unavailable" });
    expect(checksStatusLabel({ kind: "unavailable" })).toBeNull();
  });

  it("surfaces failing checks by name and does not treat empty checks as passing", () => {
    expect(
      deriveChecksStatus(
        pr({
          number: 2,
          snapshot_available: true,
          checks_rollup: "failure",
          checks_total: 4,
          checks_failed: 1,
          failed_check_names: ["rust"],
        }),
      ),
    ).toEqual({ kind: "failed", failed: 1, total: 4, names: ["rust"] });
    expect(
      deriveChecksStatus(pr({ number: 3, snapshot_available: true, checks_rollup: "" })),
    ).toEqual({ kind: "none" });
  });

  it("asserts ready only from a clean merge state", () => {
    expect(
      deriveMergeStatus(pr({ number: 4, snapshot_available: true, mergeable: "mergeable", merge_state: "blocked" })),
    ).toEqual({ kind: "blocked" });
    expect(
      deriveMergeStatus(pr({ number: 5, snapshot_available: true, merge_state: "clean" })),
    ).toEqual({ kind: "ready" });
    expect(shouldShowPullRequestStats(pr({ number: 6, additions: 0, deletions: 0, changed_files: 0 }))).toBe(false);
    expect(shouldShowPullRequestStats(pr({ number: 7, additions: 3 }))).toBe(true);
  });
});
