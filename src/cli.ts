#!/usr/bin/env node
import { runCli } from "./commands.js";

await runCli(process.argv.slice(2));
