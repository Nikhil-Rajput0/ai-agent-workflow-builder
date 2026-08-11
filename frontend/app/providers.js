"use client";

import { NhostProvider } from "@nhost/nextjs";
import { Provider as UrqlProvider } from "urql";
import { useMemo } from "react";
import { nhost, createUrqlClient } from "@/lib/nhost";

export default function Providers({ children }) {
  const urqlClient = useMemo(() => createUrqlClient(), []);
  return (
    <NhostProvider nhost={nhost}>
      <UrqlProvider value={urqlClient}>{children}</UrqlProvider>
    </NhostProvider>
  );
}
