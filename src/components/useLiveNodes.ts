"use client";

import { useEffect, useState } from "react";
import type { VizNode } from "@/lib/viz";

// Seedet mit den Server-Daten und abonniert den All-Nodes-SSE-Stream — alle
// Views (Registry, Sphere) teilen sich diese Live-Basis.
export function useLiveNodes(initial: VizNode[]): VizNode[] {
  const [nodes, setNodes] = useState(initial);

  // Server-Revalidate (z.B. nach „check now") → frische Basis übernehmen.
  useEffect(() => setNodes(initial), [initial]);

  useEffect(() => {
    const es = new EventSource("/api/monitors/stream");
    es.onmessage = (e) => {
      try {
        setNodes(JSON.parse(e.data) as VizNode[]);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  return nodes;
}
