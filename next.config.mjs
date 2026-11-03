const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export default { output: 'export', basePath, assetPrefix: basePath || undefined, trailingSlash: true, images: { unoptimized: true } };
