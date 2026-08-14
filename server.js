import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4567;
const EXEC_TIMEOUT_MS = 5 * 60 * 1000;

// Temp code files live in the OS tmp dir (only /tmp is writable on Vercel).
// ESM/CJS module resolution walks up from the temp file location and cannot
// see the project's node_modules, so we rewrite import/require statements in
// the generated code to point at the project's node_modules via absolute paths.
function resolveModuleToAbs(sdk) {
  if (sdk === "zktls-core-sdk") {
    return path.join(__dirname, "node_modules", "@primuslabs", "zktls-core-sdk", "dist", "index.js");
  }
  return path.join(__dirname, "node_modules", "@primuslabs", "network-core-sdk");
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
      "require('" + path.join(__dirname, "node_modules", "ethers") + "')"
    );
    code = code.replace(
      /require\(["']dotenv["']\)/g,
      "require('" + path.join(__dirname, "node_modules", "dotenv") + "')"
    );
  }
  return code;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// HTTP POST /api/run — reuse the Vercel serverless handler so local dev
// behavior matches the deployed version (NDJSON streaming response).
app.post("/api/run", async (req, res) => {
  try {
    const mod = await import("./api/run.js");
    const handler = mod.default;
    await handler(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  zkTLS Playground running at http://localhost:${PORT}\n`);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", data: "Invalid JSON" }));
      return;
    }

    if (msg.type !== "run") return;

    const { code, sdk, config } = msg;

    if (!code || !sdk) {
      ws.send(JSON.stringify({ type: "error", data: "Missing code or sdk" }));
      return;
    }

    const ext = sdk === "network-core-sdk" ? ".cjs" : ".mjs";
    const tmpFile = path.join(os.tmpdir(), `zktls_${crypto.randomUUID()}${ext}`);

    let finalCode = code;
    if (sdk === "zktls-core-sdk") {
      finalCode = code
        .replace("__APP_ID__", config.appId || "")
        .replace("__APP_SECRET__", config.appSecret || "");
    } else {
      finalCode = code
        .replace("__PRIVATE_KEY__", config.privateKey || "")
        .replace("__ADDRESS__", config.address || "")
        .replace("__CHAIN_ID__", config.chainId || "84532")
        .replace("__RPC_URL__", config.rpcUrl || "https://sepolia.base.org");
    }

    fs.writeFileSync(tmpFile, rewriteCodePaths(finalCode, sdk));

    ws.send(JSON.stringify({ type: "status", data: "Running..." }));

    const child = spawn("node", [tmpFile], {
      cwd: __dirname,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
      timeout: EXEC_TIMEOUT_MS,
    });

    child.stdout.on("data", (data) => {
      ws.send(JSON.stringify({ type: "stdout", data: data.toString() }));
    });

    child.stderr.on("data", (data) => {
      ws.send(JSON.stringify({ type: "stderr", data: data.toString() }));
    });

    child.on("close", (code) => {
      fs.unlink(tmpFile, () => {});
      ws.send(JSON.stringify({ type: "done", exitCode: code }));
    });

    child.on("error", (err) => {
      fs.unlink(tmpFile, () => {});
      ws.send(JSON.stringify({ type: "error", data: err.message }));
    });
  });

  ws.send(JSON.stringify({ type: "connected", data: "Playground connected" }));
});
