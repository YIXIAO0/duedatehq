// Empty shim used by vitest only. The real `server-only` package throws
// when bundled into a client component; in Node-side unit tests there's
// no client/server boundary to guard, so this is a no-op.
export {};
