#!/usr/bin/env bun
/**
 * Custom publish script that uses bun publish to properly resolve workspace:* protocols
 * 
 * Changesets uses npm publish which doesn't resolve workspace protocols.
 * Bun publish does resolve them, so we use this script instead.
 */

import { $ } from "bun";

const packages = [
  "packages/swarm-mail",
  "packages/opencode-swarm-plugin",
];

async function getPublishedVersion(name: string): Promise<string | null> {
  try {
    const result = await $`npm view ${name} version`.quiet().text();
    return result.trim();
  } catch {
    return null; // Not published yet
  }
}

async function getLocalVersion(pkgPath: string): Promise<{ name: string; version: string }> {
  const pkg = await Bun.file(`${pkgPath}/package.json`).json();
  return { name: pkg.name, version: pkg.version };
}

async function main() {
  console.log("🦋 Checking packages for publishing...\n");

  for (const pkgPath of packages) {
    const { name, version } = await getLocalVersion(pkgPath);
    const publishedVersion = await getPublishedVersion(name);

    if (publishedVersion === version) {
      console.log(`⏭️  ${name}@${version} already published, skipping`);
      continue;
    }

    console.log(`📦 Publishing ${name}@${version} (npm has ${publishedVersion ?? "nothing"})...`);
    
    try {
      // Use bun publish which resolves workspace:* protocols
      await $`bun publish --access public`.cwd(pkgPath).quiet();
      console.log(`✅ ${name}@${version} published successfully`);
      
      // Create git tag
      const tag = `${name}@${version}`;
      await $`git tag ${tag}`.quiet();
      await $`git push origin ${tag}`.quiet();
      console.log(`🏷️  Created and pushed tag: ${tag}`);
    } catch (error) {
      console.error(`❌ Failed to publish ${name}:`, error);
      process.exit(1);
    }
  }

  console.log("\n✨ Done!");
}

main();
