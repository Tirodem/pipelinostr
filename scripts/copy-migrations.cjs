const fs = require('fs');
const path = require('path');

const src = path.join('src', 'db', 'migrations');
const dst = path.join('dist', 'db', 'migrations');

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });

const files = fs.readdirSync(src).filter((f) => f.endsWith('.sql'));
if (files.length === 0) {
  console.error(`copy-migrations: no .sql files found in ${src}`);
  process.exit(1);
}

for (const f of files) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
console.log(`copy-migrations: copied ${files.length} file(s) to ${dst}`);
