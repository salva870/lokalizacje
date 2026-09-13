export async function logServerError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    level: "error",
    ts: new Date().toISOString(),
    context,
    message,
  };
  console.error(JSON.stringify(payload));
}
