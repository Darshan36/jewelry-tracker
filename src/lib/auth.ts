import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authorizeCredentials } from "@/lib/authorize-credentials";
import {
  jwtCallback,
  sessionCallback,
  type AppSignInUser,
  type AppToken,
} from "@/lib/auth-callbacks";

// Re-export for callers that previously imported from this module.
export { authorizeCredentials } from "@/lib/authorize-credentials";

export const { auth, handlers, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 }, // 30 days
  pages: {
    signIn: "/auth/login",
    error: "/auth/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        try {
          return await authorizeCredentials(raw);
        } catch (err) {
          console.error("[authorize] threw:", err);
          throw err;
        }
      },
    }),
  ],
  callbacks: {
    // Phase 21.fix — stale-JWT bug fix.
    //
    // jwt callback re-reads the user from the DB on every request to
    // catch role changes and deactivations within one request of the
    // admin's write. FAIL-SAFE on DB error (keeps existing token) to
    // prevent DB-blip mass logout. See src/lib/auth-callbacks.ts for
    // the full rationale + the asymmetry vs requireRole's fail-closed.
    //
    // Extracted to its own module (Phase 16 pattern) for unit testing.
    async jwt({ token, user }) {
      // Adapt next-auth's loose types to the strict AppToken shape.
      const appUser = user
        ? ({ id: (user as { id?: string }).id ?? "",
             role: (user as { role: AppSignInUser["role"] }).role })
        : undefined;
      const result = await jwtCallback({ token: token as AppToken, user: appUser });
      // Returning null from jwt invalidates the session per Auth.js v5
      // semantics. Cast lets us return null even though the type
      // declaration is JWT (Auth.js supports it).
      return result as unknown as typeof token;
    },
    async session({ session, token }) {
      return sessionCallback({
        session: session as unknown as Parameters<typeof sessionCallback>[0]["session"],
        token: token as AppToken,
      }) as unknown as typeof session;
    },
  },
});
