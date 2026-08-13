import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXEC_TIMEOUT_MS = 55 * 1000;

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code, sdk, config } = req.body;

  if (!code || !sdk) {
    return res.status(400).json({ error: "Missing code or sdk" });
  }

  const ext = sdk === "network-core-sdk" ? ".cjs" : ".mjs";
  const tmpFile = path.join(__dirname, "..", "tmp", `zktls_${crypto.randomUUID()}${ext}`);
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });

  if (sdk === "network-core-sdk") {
    if (config.chainId) process.env.CHAIN_ID = config.chainId;
    if (config.rpcUrl) process.env.RPC_URL = config.rpcUrl;
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(JSON.stringify(obj) + "\n");
    if (typeof res.flush === "function") res.flush();
  };

  send({ type: "status", data: "Running..." });

  process.chdir(path.join(__dirname, ".."));
  fs.writeFileSync(tmpFile, code);

  const child = spawn("node", [tmpFile], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, FORCE_COLOR: "0" },
    timeout: EXEC_TIMEOUT_MS,
  });

  child.stdout.on("data", (data) => send({ type: "stdout", data: data.toString() }));
  child.stderr.on("data", (data) => send({ type: "stderr", data: data.toString() }));

  child.on("close", (exitCode) => {
    send({ type: "done", exitCode });
    fs.unlink(tmpFile, () => {});
    res.end();
  });

  child.on("error", (err) => {
    send({ type: "stderr", data: err.message + "\n" });
    send({ type: "done", exitCode: 1 });
    fs.unlink(tmpFile, () => {});
    res.end();
  });
}
