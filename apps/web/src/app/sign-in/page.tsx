import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-12">
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
