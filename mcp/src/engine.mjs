// Loads the headless rules engine. The engine is generated from ../index.html by online/build-engine.py
// (it is a build product, not checked in), so look for a usable copy and rebuild it when it is missing or stale.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

function mtime(p){ try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; } }

function locate(){
  if (process.env.CASC_ENGINE) return path.resolve(process.env.CASC_ENGINE);
  const bundled = path.resolve(here, '..', 'engine.js');            // a packaged distribution ships its own copy
  if (fs.existsSync(bundled)) return bundled;
  const built = path.join(repo, 'online', 'engine.js');
  const html = path.join(repo, 'index.html');
  if (mtime(built) < mtime(html)){
    const script = path.join(repo, 'online', 'build-engine.py');
    try { execFileSync('python3', [script], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) { if (!fs.existsSync(built)) throw new Error(`engine.js is missing and could not be built (python3 ${script}): ${e.message}`); }
  }
  return built;
}

export const enginePath = locate();
export const E = createRequire(import.meta.url)(enginePath);
