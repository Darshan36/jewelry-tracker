// The proxy redirects `/` to `/dashboard` (or `/auth/login`) before this
// component ever renders. The file exists only because Next.js requires
// every URL path to have a route file.

export default function RootPage() {
  return null;
}
