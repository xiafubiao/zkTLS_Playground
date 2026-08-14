import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import "dotenv/config";
import "@primuslabs/zktls-core-sdk";
import "ethers";
import "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXEC_TIMEOUT_MS = 55 * 1000;

// Temp code files live in the OS tmp dir (only /tmp is writable on Vercel).
// ESM/CJS module resolution walks up from the temp file location and cannot
// see the project's node_modules, so we rewrite import/require statements in
// the generated code to point at the project's node_modules via absolute paths.
function resolveModuleToAbs(sdk) {
  if (sdk === "zktls-core-sdk") {
    return path.join(__dirname, "..", "node_modules", "@primuslabs", "zktls-core-sdk", "dist", "index.js");
  }
  return path.join(__dirname, "..", "node_modules", "@primuslabs", "network-core-sdk");
}

function rewriteCodePaths(code, sdk) {
  if (sdk === "zktls-core-sdk") {
    const abs = resolveModuleToAbs(sdk);
    code = code.replace(
      /from\s+["']@primuslabs\/zktls-core-sdk["']/g,
      'from "' + abs + '"'
    );
  } else {
    const abs = resolveModuleToAbs(sdk);
    code = code.replace(
      /require\(["']@primuslabs\/network-core-sdk["']\)/g,
      "require('" + abs + "')"
    );
    // ethers + dotenv live in the same project node_modules
    code = code.replace(
      /require\(["']ethers["']\)/g,
      "require('" + path.join(__dirname, "..", "node_modules", "ethers") + "')"
    );
    code = code.replace(
      /require\(["']dotenv["']\)/g,
      "require('" + path.join(__dirname, "..", "node_modules", "dotenv") + "')"
    );
  }
  return code;
}

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
  const tmpFile = path.join(os.tmpdir(), `zktls_${crypto.randomUUID()}${ext}`);

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
  fs.writeFileSync(tmpFile, rewriteCodePaths(code, sdk));

  const child = spawn("node", [tmpFile], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, FORCE_COLOR: "0" },
    timeout: EXEC_TIMEOUT_MS,
  });

  child.stdout.on("data", (data) => {
    const text = data.toString();
    if (/Native addon failed|Use WASM Mode|WASM module initialized/i.test(text)) return;
    send({ type: "stdout", data: text });
  });
  child.stderr.on("data", (data) => {
    const text = data.toString();
    if (/Native addon failed|Use WASM Mode|WASM module initialized/i.test(text)) return;
    send({ type: "stderr", data: text });
  });

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
