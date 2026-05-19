export function publicAsset(path: string) {
  const baseUrl = process.env.PUBLIC_URL ?? '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
