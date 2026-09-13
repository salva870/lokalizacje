export function assertTrustedOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!host) throw new Error("Forbidden origin");

  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const expectedOrigin = `${proto}://${host}`;

  if (origin) {
    if (origin !== expectedOrigin) throw new Error("Forbidden origin");
    return;
  }

  const referer = request.headers.get("referer");
  if (!referer) return;
  if (!referer.startsWith(`${expectedOrigin}/`) && referer !== expectedOrigin) {
    throw new Error("Forbidden origin");
  }
}
