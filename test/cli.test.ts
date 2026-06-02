import { describe, expect, it } from "vitest";
import { runCli } from "../src/commands.js";
import {
  desiredTasksManifest,
  FakeNotionProvider,
  tempWorkspace,
  writeConfig,
  writeDatabaseManifest
} from "./helpers.js";

describe("cli", () => {
  it("reports a missing token before calling Notion", async () => {
    const cwd = tempWorkspace();
    writeConfig(cwd);
    const stderr: string[] = [];
    let exitCode = 0;

    await runCli(["pull"], {
      cwd,
      env: {},
      stderr: (text) => stderr.push(text),
      stdout: () => undefined,
      setExitCode: (code) => {
        exitCode = code;
      }
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Missing NOTION_TOKEN");
  });

  it("returns exit code 2 when diff finds changes", async () => {
    const cwd = tempWorkspace();
    const provider = new FakeNotionProvider();
    writeConfig(cwd);
    writeDatabaseManifest(cwd, desiredTasksManifest());
    const stdout: string[] = [];
    let exitCode = 0;

    await runCli(["diff"], {
      cwd,
      env: { NOTION_TOKEN: "secret" },
      stdout: (text) => stdout.push(text),
      stderr: (text) => stdout.push(text),
      providerFactory: () => provider,
      setExitCode: (code) => {
        exitCode = code;
      }
    });

    expect(exitCode).toBe(2);
    expect(stdout.join("")).toContain("Add property tasks/tasks.Status");
  });

  it("prints a plan but refuses apply without --yes", async () => {
    const cwd = tempWorkspace();
    const provider = new FakeNotionProvider();
    writeConfig(cwd);
    writeDatabaseManifest(cwd, desiredTasksManifest());
    const output: string[] = [];
    let exitCode = 0;

    await runCli(["apply"], {
      cwd,
      env: { NOTION_TOKEN: "secret" },
      stdout: (text) => output.push(text),
      stderr: (text) => output.push(text),
      providerFactory: () => provider,
      setExitCode: (code) => {
        exitCode = code;
      }
    });

    expect(exitCode).toBe(1);
    expect(output.join("")).toContain("Plan:");
    expect(output.join("")).toContain("Apply requires --yes");
    expect(provider.updates).toHaveLength(0);
  });
});
