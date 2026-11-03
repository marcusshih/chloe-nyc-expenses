import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export default { output: 'export', outputFileTracingRoot: root, turbopack: { root }, basePath, assetPrefix: basePath || undefined, trailingSlash: true, images: { unoptimized: true } };
