import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

const files = glob.sync('packages/ink/src/**/*.{ts,tsx}');

let extractedCount = 0;
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const match = content.match(/\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,(.+)/);
  if (match) {
    try {
      const base64 = match[1];
      const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
      const sourcemap = JSON.parse(jsonStr);
      if (sourcemap.sourcesContent && sourcemap.sourcesContent.length > 0) {
        const originalSource = sourcemap.sourcesContent[0];
        writeFileSync(file, originalSource, 'utf8');
        console.log(`Extracted original source for ${file}`);
        extractedCount++;
      }
    } catch (err) {
      console.error(`Failed to extract sourcemap for ${file}:`, err);
    }
  }
}
console.log(`Successfully extracted ${extractedCount} files.`);
