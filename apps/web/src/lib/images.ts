/**
 * Product images. `ItemResolution.product.imageUrl` and `ModelOption.imageUrl` are being added to the API
 * additively; until the shared types carry them they are read optionally here, so the UI works with or without.
 * Only http(s), protocol-relative, root-relative and data:image URLs are rendered.
 */
type MaybeImage = { imageUrl?: string | null } | null | undefined;

const SAFE = /^(https?:\/\/|\/\/|\/(?!\/)|data:image\/(png|jpe?g|webp|gif|avif);)/i;

export function safeImageUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const u = url.trim();
  return u && SAFE.test(u) ? u : undefined;
}

/** The image of a product reference or model option, when the server sent a usable one. */
export function imageOf(x: unknown): string | undefined {
  return safeImageUrl((x as MaybeImage)?.imageUrl);
}
