import express from "express";
import handler from "./api/run.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 4567;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/run", (req, res) => {
  handler(req, res);
});

app.listen(PORT, () => {
  console.log(`\n  zkTLS Playground running at http://localhost:${PORT}\n`);
});

