#!/usr/bin/env bun
/**
 * Publish script for bun workspaces with changesets
 * 
 * Uses bun pm pack (resolves workspace:*) + npm publish (uses NPM_TOKEN)
 * 
 * Why not `bunx changeset publish`? Doesn't resolve workspace:* protocol
 * Why not `bun publish`? No npm token support yet (https://github.com/oven-sh/bun/issues/15601)
 * 
 * Lockfile sync is handled by ci:version running `bun update` after `changeset version`
 */

import { $ } from "bun";
import { readdir, unlink } from "node:fs/promises";

const packages = [
  "packages/swarm-mail",
  "packages/opencode-swarm-plugin",
];

async function getPublishedVersion(name: string): Promise<string | null> {
  try {
    const result = await $`npm view ${name} version`.quiet().text();
    return result.trim();
  } catch {
    return null;
  }
}

async function getLocalVersion(pkgPath: string): Promise<{ name: string; version: string }> {
  const pkg = await Bun.file(`${pkgPath}/package.json`).json();
  return { name: pkg.name, version: pkg.version };
}

async function cleanTarballs(pkgPath: string): Promise<void> {
  const files = await readdir(pkgPath);
  for (const f of files.filter(f => f.endsWith('.tgz'))) {
    await unlink(`${pkgPath}/${f}`);
  }
}

async function findTarball(pkgPath: string): Promise<string> {
  const files = await readdir(pkgPath);
  const tarball = files.find(f => f.endsWith('.tgz'));
  if (!tarball) throw new Error(`No tarball found in ${pkgPath}`);
  return `${pkgPath}/${tarball}`;
}

async function main() {
  console.log("🦋 Publishing packages...\n");

  let published = 0;

  for (const pkgPath of packages) {
    const { name, version } = await getLocalVersion(pkgPath);
    const npmVersion = await getPublishedVersion(name);

    if (npmVersion === version) {
      console.log(`⏭️  ${name}@${version} already on npm`);
      continue;
    }

    console.log(`📦 ${name}@${version} (npm: ${npmVersion ?? "none"})...`);
    
    try {
      // Clean any stale tarballs first
      await cleanTarballs(pkgPath);
      await $`bun pm pack`.cwd(pkgPath).quiet();
      const tarball = await findTarball(pkgPath);
      await $`npm publish ${tarball} --access public`.quiet();
      await unlink(tarball);
      
      console.log(`✅ Published ${name}@${version}`);
      published++;
    } catch (error) {
      console.error(`❌ Failed: ${name}`, error);
      process.exit(1);
    }
  }

  // Let changesets handle git tags
  console.log(published > 0 ? `\n🎉 Published ${published} package(s)` : "\n✨ Nothing to publish");
}

main();
