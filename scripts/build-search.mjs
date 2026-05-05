/**
 * Build Pagefind search index from the Astro build output.
 * Run after `astro build`.
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

try {
  console.log('Building Pagefind search index...');
  execSync('npx pagefind --site dist --output-path dist/pagefind', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
  console.log('Pagefind index built successfully.');
} catch (err) {
  console.error('Pagefind build failed:', err.message);
  console.error('Install with: bun add -d pagefind');
}
