"use client";

import { useRouter } from "next/navigation";
import { RouterProvider } from "@heroui/react";

type HeroUIProviderProps = {
  children: React.ReactNode;
};

/**
 * Client-side wrapper that connects HeroUI (react-aria-components) to the
 * Next.js App Router. Required so HeroUI Link / Button components use
 * next/navigation instead of the browser's native navigation.
 */
export function HeroUIProvider({ children }: HeroUIProviderProps) {
  const router = useRouter();

  return (
    <RouterProvider navigate={router.push}>
      {children}
    </RouterProvider>
  );
}
