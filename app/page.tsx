"use client";

import { useEffect, useState } from "react";
import CountrySelect from "@/components/CountrySelect";
import Game from "@/components/Game";

export default function Home() {
  const [code, setCode] = useState<string | null>(null);
  const [ai, setAi] = useState(false);

  // AI/demo mode for promo capture: load `?ai` (optionally `?ai&country=fr`) and the
  // game auto-starts and plays itself hands-free. Read on the client after mount so
  // server and first client render match (no hydration mismatch).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // `?demo` is the standard promo-capture trigger across repos; `?ai` is a legacy alias
    if (p.has("demo") || p.has("ai")) {
      // one-time URL-driven auto-start; done in an effect (not lazy state) so the
      // server render and first client render match (CountrySelect) before we swap in
      /* eslint-disable react-hooks/set-state-in-effect */
      setAi(true);
      setCode(p.get("country") || "us");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, []);

  if (!code) return <CountrySelect onStart={setCode} />;
  return <Game code={code} ai={ai} onExit={() => setCode(null)} />;
}
