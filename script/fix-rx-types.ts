import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

const files = glob.sync('packages/ink/src/**/*.{ts,tsx}');

for (const file of files) {
  let content = readFileSync(file, 'utf8');
  let changed = false;
  
  const newContent = content.replace(/\b(r\d+)\s*=>/g, '($1: any) =>');
  if (newContent !== content) {
    content = newContent;
    changed = true;
  }
  
  const newContent2 = content.replace(/removeNode\s*=>/g, '(removeNode: any) =>');
  if (newContent2 !== content) {
    content = newContent2;
    changed = true;
  }
  
  const newContent3 = content.replace(/\/\/\s*@ts-expect-error.*/g, '');
  if (newContent3 !== content) {
    content = newContent3;
    changed = true;
  }

  if (changed) {
    writeFileSync(file, content, 'utf8');
    console.log(`Fixed types in ${file}`);
  }
}
