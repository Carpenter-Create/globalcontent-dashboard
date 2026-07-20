// Test-only stand-in for the "server-only" package (aliased in vitest.config.ts).
// The real package throws unconditionally unless resolved under the "react-server"
// export condition, which Vite/Vitest's default Node resolution doesn't set — so any
// module importing "server-only" would throw the instant it's imported in a test. This
// stub is a no-op, matching the package's own "react-server" condition (empty.js).
export {};
