import fs from "fs";
import path from "path";


export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(filePath, obj) {
  console.log(`📝 Writing JSON to: ${filePath}`);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true }); // napravi folder(e) ako ne postoje
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}
