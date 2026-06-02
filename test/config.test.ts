import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseDotEnv, resolveToken } from "../src/config.js";
import { runCli } from "../src/commands.js";
import { tempWorkspace } from "./helpers.js";

describe("config", () => {
  it("parses NOTION_TOKEN from a simple .env file", () => {
    expect(parseDotEnv("NOTION_TOKEN='secret_test'\nOTHER=value").NOTION_TOKEN).toBe(
      "secret_test"
    );
  });

  it("prefers the environment token over .env", () => {
    const cwd = tempWorkspace();
    expect(resolveToken(cwd, { NOTION_TOKEN: "from-env" })).toBe("from-env");
  });

  it("initializes notionctl.yaml with a configured database resource", async () => {
    const cwd = tempWorkspace();
    const output: string[] = [];
    let exitCode = 0;

    await runCli(["init", "--database", "db1", "--name", "tasks"], {
      cwd,
      stdout: (text) => output.push(text),
      stderr: (text) => output.push(text),
      setExitCode: (code) => {
        exitCode = code;
      }
    });

    const config = loadConfig(cwd);

    expect(exitCode).toBe(0);
    expect(config.resources).toEqual([
      {
        key: "tasks",
        databaseId: "db1",
        manifest: "databases/tasks.yaml"
      }
    ]);
    expect(existsSync(path.join(cwd, "notion", "databases"))).toBe(true);
    expect(readFileSync(path.join(cwd, "notionctl.yaml"), "utf8")).toContain(
      "notionVersion: 2026-03-11"
    );
  });
});
