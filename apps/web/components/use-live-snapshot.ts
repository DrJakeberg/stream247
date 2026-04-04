"use client";

import { useEffect, useRef, useState } from "react";

type Options<T> = {
  initialSnapshot: T;
  stateUrl: string;
  streamUrl: string;
};

export function useLiveSnapshot<T>({ initialSnapshot, stateUrl, streamUrl }: Options<T>) {
  const [snapshot, setSnapshot] = useState<T>(initialSnapshot);
  const [connected, setConnected] = useState(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const eventSource = new EventSource(streamUrl);

    const fetchSnapshot = async () => {
      try {
        const response = await fetch(stateUrl, { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const nextSnapshot = (await response.json()) as T;
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      } catch {
        // Ignore transient polling errors and keep the last snapshot.
      }
    };

    const ensureFallbackPolling = () => {
      if (fallbackTimerRef.current) {
        return;
      }

      fallbackTimerRef.current = setInterval(() => {
        void fetchSnapshot();
      }, 10000);
    };

    const clearFallbackPolling = () => {
      if (!fallbackTimerRef.current) {
        return;
      }

      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    };

    eventSource.addEventListener("state", (event) => {
      try {
        const nextSnapshot = JSON.parse((event as MessageEvent<string>).data) as T;
        setSnapshot(nextSnapshot);
        setConnected(true);
        clearFallbackPolling();
      } catch {
        // Ignore malformed messages and keep the previous snapshot.
      }
    });

    eventSource.onerror = () => {
      setConnected(false);
      ensureFallbackPolling();
      void fetchSnapshot();
    };

    void fetchSnapshot();

    return () => {
      cancelled = true;
      eventSource.close();
      clearFallbackPolling();
    };
  }, [stateUrl, streamUrl]);

  return {
    snapshot,
    connected
  };
}
