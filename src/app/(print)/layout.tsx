// Phase 20 — (print) route group layout.
//
// A sibling to (app)/. URLs under (print)/ resolve to the SAME paths
// they would in (app)/ (route groups don't affect URLs), but they get
// THIS layout instead — no sidebar, no app chrome, plain black-on-white
// rendering optimized for browser print.
//
// Auth check is duplicated from (app)/layout.tsx because route group
// layouts don't share parents. The proxy still gates the URL too
// (defense in depth — `/sales/[id]/bill` is covered by the existing
// `/sales` ADMIN gate via the proxy's path-prefix match).
//
// Body background override: (app) routes set body to cream via
// globals.css; (print) routes need pure white for print reliability.
// We override here via a <style> tag in the markup tree — this scopes
// the rule to (print) tree's mount and doesn't pollute globals.css.

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export default async function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  return (
    <>
      {/* Override body to plain white for ALL of (print)/. The (app)
          tree's cream background does not apply here. `!important` is
          necessary because globals.css declares the body color with
          regular specificity; without `!important` the body rule wins
          due to source order. */}
      <style>{`
        body { background-color: #ffffff !important; color: #000000; }
        @media print {
          body { background-color: #ffffff !important; margin: 0; }
          @page { margin: 14mm; }
        }
      `}</style>
      <div className="bg-white text-black min-h-screen">{children}</div>
    </>
  );
}
