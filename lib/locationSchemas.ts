import { z } from "zod";

export const locationTypeValues = [
  "DISPLAY",
  "WYSTAWA",
  "BUFFER",
  "RESERVED",
  "BACKROOM_BOX",
  "BACKROOM_SHELF",
  "INACTIVE",
  "DAMAGED",
] as const;

export const locationTypeSchema = z.enum(locationTypeValues);

export const createLocationSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Kod musi miec co najmniej 2 znaki")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Kod moze zawierac tylko litery, cyfry, _ i -"),
  name: z.string().trim().min(2, "Nazwa musi miec co najmniej 2 znaki").max(120),
  parentZone: z.enum(["SKLEP", "ZAPLECZE"]),
  locationType: locationTypeSchema,
});

export function formatZodLocationError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Niepoprawne dane lokalizacji";
  const path = first.path.length ? `${String(first.path[0])}: ` : "";
  return `${path}${first.message}`;
}
