import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function sourceFingerprint(root = '.') {
  const hash = createHash('sha256');
  async function walk(relative, optional = false) {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) {
      if (optional && error.code === 'ENOENT') { hash.update(`missing-directory:${relative}`); return; }
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) { hash.update(file); hash.update(await readFile(path.join(root, file))); }
    }
  }
  // Exclude runtime pack databases, reports and credentials. Include the test
  // definitions themselves so changing expected outcomes invalidates evidence.
  for (const directory of ['scripts', 'styles', 'lang', 'tests/live']) await walk(directory);
  hash.update(await readFile(path.join(root, 'module.json')));
  hash.update(await readFile(path.join(root, 'package-lock.json')));
  return hash.digest('hex');
}

