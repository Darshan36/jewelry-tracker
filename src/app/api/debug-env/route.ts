// TEMPORARY diagnostic — gated by a header token. Returns which env-var
// keys are visible to the runtime function. NEVER returns values.
// REMOVE before normal operation.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RELEVANT = [
  "DATABASE_URL",
  "DIRECT_URL",
  "AUTH_SECRET",
  "AUTH_TRUST_HOST",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SEED_ADMIN_EMAIL",
  "SEED_ADMIN_PASSWORD",
  "SEED_ADMIN_NAME",
  "VERCEL_ENV",
  "VERCEL_REGION",
  "NODE_ENV",
];

export async function GET(req: Request) {
  const token = req.headers.get("x-debug-token");
  if (token !== "g7s4-diag-only-2026") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const out: Record<string, { present: boolean; length: number }> = {};
  for (const k of RELEVANT) {
    const v = process.env[k];
    out[k] = { present: v !== undefined, length: v ? v.length : 0 };
  }
  return NextResponse.json({ env: out, allKeys: Object.keys(process.env).filter(k => RELEVANT.includes(k) || k.startsWith("AUTH_") || k.startsWith("DATABASE") || k.startsWith("DIRECT")).sort() });
}
