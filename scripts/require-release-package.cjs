console.error('Do not publish the development workspace: dist contains retained running versions. Run bun run release:pack, inspect the resulting tarball, and publish that tarball explicitly.')
process.exitCode = 1
