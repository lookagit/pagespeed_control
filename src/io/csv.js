import fs from "fs";
import { parse } from "csv-parse/sync";

export function readCsv(filePath) {
  const csv = fs.readFileSync(filePath, "utf8");
  return parse(csv, { columns: true, skip_empty_lines: true, trim: true });
}