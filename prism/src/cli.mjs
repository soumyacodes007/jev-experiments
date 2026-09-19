#!/usr/bin/env node
import { stdin } from "node:process";
import { createRuntime } from "./runtime.mjs";
import { createPrismServer } from "./service.mjs";

const [command = "help", ...args] = process.argv.slice(2);

try {
  if (command === "mask") {
    await runMask(args);
  } else if (command === "serve") {
    await runServer(args);
  } else {
    printHelp();
    if (command !== "help" && command !== "--help" && command !== "-h") {
      process.exitCode = 2;
    }
  }
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}

async function runMask(args) {
  const profile = option(args, "--profile") ?? "economy";
  const inline = option(args, "--text");
  const text = inline ?? (await readStdin());
  if (!text) throw new Error("Provide --text or pipe text on stdin.");
  const { detector } = await createRuntime({ profile });
  const result = await detector.detect(text);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runServer(args) {
  const profile = option(args, "--profile") ?? "economy";
  const host = option(args, "--host") ?? process.env.HOST ?? "127.0.0.1";
  const port = Number.parseInt(
    option(args, "--port") ?? process.env.PORT ?? "8787",
    10,
  );
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("port must be between 0 and 65535");
  }
  const { detector } = await createRuntime({ profile });
  const service = createPrismServer({ detector, host, port });
  const address = await service.listen();
  process.stdout.write(
    `${JSON.stringify({ status: "listening", address, profile })}\n`,
  );

  const shutdown = async () => {
    await service.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (index + 1 >= args.length) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

async function readStdin() {
  if (stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function printHelp() {
  process.stdout.write(`PRISM backend\n\n`);
  process.stdout.write(`  node src/cli.mjs mask --text "Contact Jane at jane@example.com"\n`);
  process.stdout.write(`  node src/cli.mjs serve --port 8787 --profile economy\n`);
  process.stdout.write(`\nProfiles: economy | latency\n`);
}

