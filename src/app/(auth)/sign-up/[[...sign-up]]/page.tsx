import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Suspense fallback={<AuthSkeleton />}>
        <SignUp />
      </Suspense>
    </div>
  );
}

function AuthSkeleton() {
  return (
    <div className="h-[520px] w-[400px] animate-pulse rounded-lg bg-card shadow-sm" />
  );
}
