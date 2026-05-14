// TypeScript module augmentation for Auth.js v5.
//
// Adds `role` to the User and Session, and `id` + `role` to the JWT.
// Without these declarations, the callbacks in src/lib/auth.ts would
// produce type errors when reading/writing custom fields.
//
// Auth.js v5 re-exports its types from @auth/core/*; module augmentation
// has to target the original declaration site, not the re-export. We
// augment both the next-auth wrapper paths (canonical) and the @auth/core
// originals (where interfaces actually live), so consumers using either
// import style get the merged types.

import type { Role } from "@/generated/prisma";

declare module "next-auth" {
  interface User {
    role: Role;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
    };
  }
}

declare module "@auth/core/types" {
  interface User {
    role: Role;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
