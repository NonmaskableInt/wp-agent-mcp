import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zip_directory } from '../../src/tools/apps.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zipdir-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('zip_directory', () => {
  it('zips nested files with forward-slash paths and skips hidden files', async () => {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<html/>');
    await writeFile(join(dir, 'assets', 'app.js'), 'x');
    await writeFile(join(dir, '.env'), 'SECRET=1');
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'config'), 'x');

    const names = Object.keys(unzipSync(new Uint8Array(await zip_directory(dir)))).sort();
    expect(names).toEqual(['assets/app.js', 'index.html']);
  });

  it('refuses symlinks instead of following them out of the build dir', async () => {
    await writeFile(join(dir, 'index.html'), '<html/>');
    await symlink('/etc/passwd', join(dir, 'leak.txt'));
    await expect(zip_directory(dir)).rejects.toThrow(/Symlink not allowed/);
  });

  it('rejects an empty directory', async () => {
    await expect(zip_directory(dir)).rejects.toThrow(/No files found/);
  });
});
