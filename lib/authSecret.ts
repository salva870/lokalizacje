export function getAuthSecret(): Uint8Array {
  const authSecretRaw = process.env.AUTH_SECRET?.trim() ?? "";
  if (authSecretRaw.length < 32) {
    throw new Error("AUTH_SECRET musi miec min. 32 znaki i nie moze byc pusty.");
  }
  return new TextEncoder().encode(authSecretRaw);
}
