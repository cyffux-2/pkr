const PUBLIC_URL = process.env.PUBLIC_URL || '';

export const getPublicUrl = (path: string): string => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${PUBLIC_URL}${cleanPath}`;
};

export const applyPublicImageFallback = (image: HTMLImageElement, path: string) => {
  const cleanPath = path.replace(/^\/+/, '');
  const attempts = [
    getPublicUrl(cleanPath),
    cleanPath,
    `/${cleanPath}`,
  ];
  const currentAttempt = Number(image.dataset.publicImageAttempt ?? '0');
  const nextAttempt = currentAttempt + 1;
  const nextSrc = attempts[nextAttempt];

  if (!nextSrc) return;

  image.dataset.publicImageAttempt = String(nextAttempt);
  image.src = nextSrc;
};
