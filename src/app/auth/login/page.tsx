import { Suspense } from "react";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md p-10 bg-surface-container border border-outline-variant">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight mb-1">
            Shree Creation
          </h1>
          <p className="text-on-surface-variant text-xs uppercase tracking-widest">
            Jewelry Manufacturing Management
          </p>
        </header>

        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
