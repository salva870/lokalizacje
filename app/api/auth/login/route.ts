import { NextResponse } from "next/server";
import { z } from "zod";
import { signIn } from "@/lib/auth";

const bodySchema = z.object({
  login: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Niepoprawne dane logowania" }, { status: 400 });
  }

  const session = await signIn(parsed.data.login, parsed.data.password);
  if (!session) {
    return NextResponse.json({ error: "Bledny login lub haslo" }, { status: 401 });
  }

  return NextResponse.json({ user: session });
}
