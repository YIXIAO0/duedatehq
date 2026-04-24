import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";

// Clerk components use runtime data — with Cache Components enabled they
// must live inside a <Suspense> boundary.
export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Suspense fallback={<AuthSkeleton />}>
        <SignIn />
      </Suspense>
    </div>
  );
}

function AuthSkeleton() {
  return (
    <div className="h-[480px] w-[400px] animate-pulse rounded-lg bg-card shadow-sm" />
  );
}
