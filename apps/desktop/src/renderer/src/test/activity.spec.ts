import { describe, expect, it } from "vitest";
import { HARNESS_SESSION_TOOL } from "@coordy/protocol";
import { chatTimeline, describeActivity, parseToolPayload } from "../lib/coordy/activity";
import { formatActivity } from "../lib/coordy/labels";

describe("describeActivity", () => {
  it("parses kernel tool payloads", () => {
    expect(parseToolPayload('ApplyPatch in={"path":"src/a.ts"} out=pending exit=None')).toEqual({
      name: "ApplyPatch",
      input: '{"path":"src/a.ts"}',
      output: "pending",
      exit: "None",
    });
  });

  it("maps patch and file edits to a quiet 编辑了文件 marker", () => {
    expect(describeActivity({ kind: "patch", payload: "diff --git a/src/a.ts" })).toMatchObject({
      tone: "marker",
      icon: "pencil",
      title: "编辑了文件",
      pending: false,
    });
    expect(
      describeActivity({
        kind: "tool",
        payload: 'Edited src/a.ts in={"path":"src/a.ts"} out="completed" exit=None',
      }),
    ).toMatchObject({
      tone: "marker",
      icon: "pencil",
      title: "编辑了文件",
    });
  });

  it("maps compaction to 上下文已自动压缩", () => {
    expect(describeActivity({ kind: "compaction", payload: "dropped old turns" })).toEqual({
      tone: "marker",
      icon: "fold",
      title: "上下文已自动压缩",
      detail: "dropped old turns",
      pending: false,
    });
  });

  it("keeps messages as chat lines and session tools quiet", () => {
    expect(describeActivity({ kind: "message", payload: "user: 你好" })).toEqual({
      tone: "message",
      role: "user",
      label: "你",
      body: "你好",
    });
    expect(
      describeActivity({
        kind: "tool",
        payload: `${HARNESS_SESSION_TOOL} in=claude-acp out=end_turn exit=Some(0)`,
      }),
    ).toMatchObject({
      tone: "marker",
      icon: "check",
      title: "这一轮结束了",
      pending: false,
    });
    expect(formatActivity({ kind: "tool", payload: `${HARNESS_SESSION_TOOL} in=x out=y exit=Some(0)` })).toEqual({
      label: "这一轮结束了",
      body: "",
    });
  });

  it("marks in-progress tools without dumping the raw payload", () => {
    const described = describeActivity({
      kind: "tool",
      payload: 'read_file in={"path":"README.md"} out=pending exit=None',
    });
    expect(described).toMatchObject({
      tone: "marker",
      icon: "file",
      title: "读取了文件",
      pending: true,
      detail: "README.md",
    });
  });

  it("interleaves tool markers with chat messages", () => {
    const lines = chatTimeline(
      [{ id: "m1", role: "user", body: "修一下" }],
      [
        { seq: 1, kind: "message", payload: "user: 修一下" },
        { seq: 2, kind: "tool", payload: "edit in={} out=pending exit=None" },
        { seq: 3, kind: "compaction", payload: "" },
        { seq: 4, kind: "message", payload: "assistant: 好" },
      ],
      "run_1",
    );
    expect(lines.map((item) => item.type)).toEqual(["message", "marker", "marker", "message"]);
    expect(lines[1]).toMatchObject({ type: "marker" });
    expect(lines[3]).toMatchObject({ type: "message", body: "好" });
  });
});
