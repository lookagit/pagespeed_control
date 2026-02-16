import fs from 'fs';
import path from 'path';

export function writeFileSafe(filePath, data) {
  // Izvuci direktorijum iz putanje
  const dir = path.dirname(filePath);
  
  // Kreiraj direktorijum ako ne postoji (rekurzivno)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Sada upiši fajl
  fs.writeFileSync(filePath, data, 'utf8');
}