// The backend runs directly on Bun. Build the existing frontend and verify the
// shipped BGS executable; there is no embedded coding-agent bundle to compile.
for (const command of [[process.execPath, 'scripts/check-bgs.ts'],
  [process.execPath, 'run', 'typecheck'], [process.execPath, 'run', '--cwd', 'apps/frontend', 'build']]) {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) process.exit(1)
}
