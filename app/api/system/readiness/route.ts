import { NextResponse } from "next/server";
import { isSupabaseConfigured, getSupabaseClient, isSupabasePrivileged } from "@/lib/supabase";

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({
      mode: "local-fallback",
      ok: true,
      message: "Supabase nie jest skonfigurowany, aktywny jest fallback in-memory.",
    });
  }

  if (!isSupabasePrivileged) {
    return NextResponse.json(
      {
        mode: "supabase",
        ok: false,
        error: "Brak SUPABASE_SERVICE_ROLE_KEY",
        hint: "Dodaj klucz service_role do backendowego .env i zrestartuj aplikacje.",
      },
      { status: 503 },
    );
  }

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("locations").select("code").limit(1);
    if (error) {
      return NextResponse.json(
        {
          mode: "supabase",
          ok: false,
          error: error.message,
          hint: "Uruchom SQL z supabase/schema.sql i sprawdz RLS policies.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({
      mode: "supabase",
      ok: true,
      message: "Polaczenie z Supabase dziala.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        mode: "supabase",
        ok: false,
        error: error instanceof Error ? error.message : "Nieznany blad",
      },
      { status: 503 },
    );
  }
}
