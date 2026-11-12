import { mkdtemp, mkdir, realpath, symlink, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve_build_dir, zip_directory } from '../../src/tools/apps.js';

let root: string;
let outside: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'bd-root-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'bd-outside-')));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('zip_directory', () => {
  it('zips nested files with forward-slash paths, skips hidden files, and lists what it packed', async () => {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<html/>');
    await writeFile(join(root, 'assets', 'app.js'), 'x');
    await writeFile(join(root, '.env'), 'SECRET=1');
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), 'x');

    const { data, files } = await zip_directory(root);
    expect(Object.keys(unzipSync(new Uint8Array(data))).sort()).toEqual(['assets/app.js', 'index.html']);
    expect([...files].sort()).toEqual(['assets/app.js', 'index.html']);
  });

  it('refuses symlinks instead of following them out of the build dir', async () => {
    await writeFile(join(root, 'index.html'), '<html/>');
    await symlink('/etc/passwd', join(root, 'leak.txt'));
    await expect(zip_directory(root)).rejects.toThrow(/Symlink not allowed/);
  });

  it('rejects an empty directory', async () => {
    await expect(zip_directory(root)).rejects.toThrow(/No files found/);
  });

  it('refuses a tree with too many files before reading any of them', async () => {
    for (let i = 0; i < 12; i++) await writeFile(join(root, `f${i}.txt`), 'x');
    await expect(zip_directory(root, { max_files: 10 })).rejects.toThrow(/more than 10 files/);
  });

  it('refuses a tree that is too large before reading any of it', async () => {
    await writeFile(join(root, 'big.txt'), 'x'.repeat(2048));
    await expect(zip_directory(root, { max_bytes: 1024 })).rejects.toThrow(/larger than 1024 bytes/);
  });
});

describe('resolve_build_dir (jail)', () => {
  it('accepts a directory inside the allowed root, absolute or relative to it', async () => {
    await mkdir(join(root, 'dist'));
    expect(resolve_build_dir(join(root, 'dist'), root)).toBe(join(root, 'dist'));
    expect(resolve_build_dir('dist', root)).toBe(join(root, 'dist'));
  });

  it('accepts the root itself (WP_MCP_BUILD_ROOT may point straight at dist/)', () => {
    expect(resolve_build_dir(root, root)).toBe(root);
  });

  it.each([
    ['a sibling outside the root', () => outside],
    ['a .. traversal out of the root', () => join(root, '..', 'etc')],
    ['the filesystem root', () => '/'],
    ['/etc', () => '/etc'],
    ['the home directory', () => homedir()],
    ['the home .ssh directory', () => join(homedir(), '.ssh')],
  ])('refuses %s', (_l, dir) => {
    expect(() => resolve_build_dir(dir(), root)).toThrow(/outside|not allowed|WP_MCP_BUILD_ROOT/i);
  });

  it('refuses a symlink inside the root that points outside it', async () => {
    await writeFile(join(outside, 'secret.json'), '{}');
    await symlink(outside, join(root, 'dist'));
    expect(() => resolve_build_dir(join(root, 'dist'), root)).toThrow(/outside/i);
  });

  it('refuses a sibling whose name merely starts with the root name', async () => {
    const sibling = `${root}-evil`;
    await mkdir(sibling);
    try {
      expect(() => resolve_build_dir(sibling, root)).toThrow(/outside/i);
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });

  it('refuses an unusable root (/ or the home directory) and says how to fix it', () => {
    expect(() => resolve_build_dir('dist', '/')).toThrow(/WP_MCP_BUILD_ROOT/);
    expect(() => resolve_build_dir('dist', homedir())).toThrow(/WP_MCP_BUILD_ROOT/);
  });

  it('refuses a root that CONTAINS the home directory (e.g. /Users), not just home itself', () => {
    const parent = dirname(homedir());
    expect(() => resolve_build_dir(join(homedir(), 'Documents'), parent)).toThrow(/too broad|WP_MCP_BUILD_ROOT/);
    expect(() => resolve_build_dir('anything', parent)).toThrow(/too broad|WP_MCP_BUILD_ROOT/);
  });

  it.each([
    ['a hidden directory inside the root', '.secrets'],
    ['a hidden directory nested in the root', 'app/.aws'],
    ['a directory inside a hidden directory', '.cache/dist'],
    ['.git', '.git'],
  ])('refuses %s even though its own children are not hidden', async (_l, rel) => {
    await mkdir(join(root, rel), { recursive: true });
    await writeFile(join(root, rel, 'credentials.json'), '{"token":"x"}');
    expect(() => resolve_build_dir(join(root, rel), root)).toThrow(/hidden/i);
    expect(() => resolve_build_dir(rel, root)).toThrow(/hidden/i);
  });

  it('refuses a visible symlink that resolves into a hidden directory', async () => {
    await mkdir(join(root, '.private'));
    await symlink(join(root, '.private'), join(root, 'dist'));
    expect(() => resolve_build_dir(join(root, 'dist'), root)).toThrow(/hidden/i);
  });

  it('still allows a root that merely lives under a hidden directory, and dotted but visible names', async () => {
    const hidden_root = join(root, '.workspace');
    await mkdir(join(hidden_root, 'dist.v2'), { recursive: true });
    expect(resolve_build_dir('dist.v2', hidden_root)).toBe(join(hidden_root, 'dist.v2'));
  });

  it('reports a missing directory clearly', () => {
    expect(() => resolve_build_dir(join(root, 'nope'), root)).toThrow(/does not exist/);
  });
});
