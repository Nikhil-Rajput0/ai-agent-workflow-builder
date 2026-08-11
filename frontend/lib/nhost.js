"use client";

import { NhostClient } from "@nhost/nextjs";
import { createClient as createWSClient } from "graphql-ws";
import { Client, cacheExchange, fetchExchange, subscriptionExchange } from "urql";

export const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN ?? "localhost",
  region: process.env.NEXT_PUBLIC_NHOST_REGION,
});

function makeWsClient() {
  if (typeof window === "undefined") return null;
  const httpUrl = nhost.graphql.getUrl();
  const wsUrl = httpUrl.replace(/^http/, "ws");
  return createWSClient({
    url: wsUrl,
    connectionParams: () => {
      const token = nhost.auth.getAccessToken();
      return { headers: token ? { Authorization: `Bearer ${token}` } : {} };
    },
  });
}

export function createUrqlClient() {
  const wsClient = makeWsClient();
  return new Client({
    url: nhost.graphql.getUrl(),
    fetchOptions: () => {
      const token = nhost.auth.getAccessToken();
      return { headers: token ? { Authorization: `Bearer ${token}` } : {} };
    },
    exchanges: [
      cacheExchange,
      fetchExchange,
      ...(wsClient
        ? [
            subscriptionExchange({
              forwardSubscription(request) {
                const input = { ...request, query: request.query ?? "" };
                return {
                  subscribe(sink) {
                    const unsubscribe = wsClient.subscribe(input, sink);
                    return { unsubscribe };
                  },
                };
              },
            }),
          ]
        : []),
    ],
  });
}
