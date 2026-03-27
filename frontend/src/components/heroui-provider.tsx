"use client";

import { RouterProvider } from "@heroui/react";
import { useRouter } from "next/navigation";

type HeroUIProviderProps = {
  children: React.ReactNode;
};

export function HeroUIProvider({ children }: HeroUIProviderProps) {
  const router = useRouter();

  return <RouterProvider navigate={router.push}>{children}</RouterProvider>;
}
