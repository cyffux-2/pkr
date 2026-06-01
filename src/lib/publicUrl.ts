/**
 * Get the correct public URL for assets, accounting for the app's base path
 * in production (GitHub Pages subdirectory)
 * 
 * This captures PUBLIC_URL at build time, not runtime
 */

// Cette valeur sera remplacée par webpack au build time avec la vraie valeur de PUBLIC_URL
const PUBLIC_URL = process.env.PUBLIC_URL || '';

export const getPublicUrl = (path: string): string => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${PUBLIC_URL}${cleanPath}`;
};
