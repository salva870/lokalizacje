const PRODUCT_IMAGE_ORIGIN = "https://divotikids.pl";

/** Link przekierowujacy do pierwszego zdjecia produktu (WordPress ?sku_image=). */
export function productImageRedirectUrl(model: string): string {
  const sku = model.trim();
  if (!sku) return "";
  return `${PRODUCT_IMAGE_ORIGIN}/?sku_image=${encodeURIComponent(sku)}`;
}
