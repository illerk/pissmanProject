import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "manticore.log");

try {
  fs.ensureDirSync(LOG_DIR);
} catch (e) {
  // ignore
}

function _format(level, msg) {
  const ts = new Date().toISOString();
  let text;
  if (msg instanceof Error) text = msg.stack || msg.message;
  else if (typeof msg === "object") {
    try { text = JSON.stringify(msg); } catch (e) { text = String(msg); }
  } else text = String(msg);
  return `${ts} [${level}] ${text}\n`;
}

async function _write(level, msg) {
  const line = _format(level, msg);
  try {
    await fs.appendFile(LOG_FILE, line, { encoding: "utf8" });
  } catch (e) {
    // best-effort: if logging to file fails, fallback to console
    // do not throw from logger
  }
  if (level === "ERROR") console.error(line.trim());
  else console.log(line.trim());
}

export default {
  info: (msg) => _write("INFO", msg),
  warn: (msg) => _write("WARN", msg),
  error: (msg) => _write("ERROR", msg),
  debug: (msg) => _write("DEBUG", msg),
  log: (level, msg) => _write(level, msg)
};
