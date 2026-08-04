"use client";

import { useState } from "react";
import CountrySelect from "@/components/CountrySelect";
import Game from "@/components/Game";

export default function Home() {
  const [code, setCode] = useState<string | null>(null);

  if (!code) return <CountrySelect onStart={setCode} />;
  return <Game code={code} />;
}
