import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

const files = glob.sync('packages/ink/src/**/*.{ts,tsx}');

for (const file of files) {
  let content = readFileSync(file, 'utf8');
  let changed = false;
  
  const newContent3 = content.replace(/[ \t]*\/\/\s*@ts-expect-error.*(?:\r?\n)?/g, '');
  if (newContent3 !== content) {
    content = newContent3;
    changed = true;
  }

  if (changed) {
    writeFileSync(file, content, 'utf8');
    console.log(`Fixed types in ${file}`);
  }
}
