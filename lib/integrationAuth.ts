export function assertIntegrationKey(request: Request) {
  const expected = process.env.LOC_INTEGRATION_API_KEY?.trim();
  if (!expected) {
    throw new Error("Integration API disabled");
  }
  const provided = request.headers.get("x-loc-integration-key")?.trim();
  if (!provided || provided !== expected) {
    throw new Error("Unauthorized");
  }
}
