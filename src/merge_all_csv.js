import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

function mergeCsvs(folderPath, outputPath = 'merged.csv') {
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.csv'));

  if (!files.length) throw new Error(`Nema CSV fajlova u: ${folderPath}`);

  let headers = null;
  const seen = new Set();
  const rows = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(folderPath, file), 'utf-8');
    const records = parse(content, { 
      columns: true, 
      skip_empty_lines: true,
      relax_column_count: true
    });

    if (!headers) headers = Object.keys(records[0]);

    let added = 0;
    for (const record of records) {
      const key = record['Website'] || record['Email'] || record['Phone'];
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      rows.push(record);
      added++;
    }

    console.log(`✓ ${file} — ${added}/${records.length} redova (${records.length - added} duplikata)`);
  }

  const chunkSize = 200;
  const baseName  = outputPath.replace(/\.csv$/i, '');
  let   fileCount = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk    = rows.slice(i, i + chunkSize);
    const filePath = `${baseName}_${String(++fileCount).padStart(3, '0')}.csv`;
    const output   = stringify(chunk, { header: true, columns: headers });
    fs.writeFileSync(filePath, output);
    console.log(`✓ ${filePath} — ${chunk.length} redova`);
  }

  console.log(`\nUkupno: ${rows.length} redova u ${fileCount} fajlova`);
}

mergeCsvs('./out/report', './out/merged.csv');