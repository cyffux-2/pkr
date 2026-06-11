const PUBLIC_URL = process.env.PUBLIC_URL || '';

export const getPublicUrl = (path: string): string => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${PUBLIC_URL}${cleanPath}`;
};
