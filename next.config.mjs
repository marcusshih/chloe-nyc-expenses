import { fileURLToPath } from 'node:url';
import { publicConfiguration } from './lib/config.js';
// Reject private/legacy keys before compiling any NEXT_PUBLIC_ value into assets.
publicConfiguration(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const root = fileURLToPath(new URL('.', import.meta.url));
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export default { output: 'export', distDir: process.env.NEXT_DIST_DIR || '.next', outputFileTracingRoot: root, turbopack: { root }, basePath, assetPrefix: basePath || undefined, trailingSlash: true, images: { unoptimized: true } };
