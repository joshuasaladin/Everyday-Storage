// Deletes the demo database and its uploads; it is rebuilt from the seed on next start.
// Never touches the live database.
import fs from "node:fs";
import path from "node:path";
const dir = path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data"), "demo");
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. Restart the app to rebuild the demo workspace.`);
