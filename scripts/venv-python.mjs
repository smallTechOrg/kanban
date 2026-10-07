#!/usr/bin/env node
/**
 * My Day -- run the repo virtualenv's own interpreter.
 *
 * The single source of truth for "where is the venv Python" (CLAUDE.md section 3): the root
 * npm scripts all go through here instead of repeating an interpreter path each.
 *
 * npm runs scripts through cmd.exe on Windows, which rejects a forward-slash relative command
 * path (".venv/Scripts/python" is not recognized...), while the POSIX layout is .venv/bin/python
 * -- so no single literal works on both. Node is already required for the toolchain, resolves the
 * repo root from this file (the repo path contains a space, so nothing may depend on the cwd),
 * and spawns without a shell, so quoting is not in play.
 *
 * Usage: node scripts/venv-python.mjs -m pytest backend/tests
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** The two virtualenv layouts, Windows first. */
const CANDIDATES = [
  join(root, '.venv', 'Scripts', 'python.exe'),
  join(root, '.venv', 'bin', 'python'),
];

const python = CANDIDATES.find((candidate) => existsSync(candidate));

if (!python) {
  process.stderr.write(
    `error: no virtualenv interpreter under ${join(root, '.venv')} -- run "npm run setup" first.\n`,
  );
  process.exit(1);
}

const child = spawn(python, process.argv.slice(2), { stdio: 'inherit', cwd: root });

child.on('error', (error) => {
  process.stderr.write(`error: could not run ${python}: ${error.message}\n`);
  process.exit(1);
});

// Propagate the real outcome so `npm run lint` && chains and CI still fail correctly.
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
