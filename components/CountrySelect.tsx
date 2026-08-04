"use client";

import { useEffect, useMemo, useState } from "react";
import {
  COUNTRIES,
  searchCountries,
  findCountry,
  flagUrl,
} from "@/lib/countries";
import { startMenuMusic, stopMenuMusic } from "@/lib/game/music";
import { Dices } from "lucide-react";
import FlagMarble2D from "./FlagMarble2D";

export default function CountrySelect({
  onStart,
}: {
  onStart: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("us");
  const results = useMemo(() => searchCountries(query), [query]);
  const selected = findCountry(code);

  // Epic menu theme: browsers block audio until a gesture, so kick it off on the
  // first tap/keypress anywhere on the picker; stop it when the picker unmounts.
  useEffect(() => {
    const start = () => startMenuMusic();
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      stopMenuMusic();
    };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:flex-row lg:overflow-hidden">
      {/* left: the glossy marble you are about to defend with */}
      <section className="flex flex-col items-center justify-center gap-6 p-6 lg:h-full lg:w-[46%] lg:p-10">
        <h1 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">
          Country <span className="text-cyan-400">Defense</span>
        </h1>
        <p className="-mt-3 text-center text-sm text-white/50">
          Pick your country. Defend it from {COUNTRIES.length - 1} others.
        </p>

        <div className="relative aspect-square w-full max-w-[340px]">
          <div className="absolute inset-0 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="relative h-full w-full">
            <FlagMarble2D code={code} />
          </div>
        </div>

        <div className="text-center">
          <div className="text-xl font-bold text-white">{selected?.name}</div>
          <div className="text-xs font-semibold uppercase tracking-widest text-white/60">
            {selected?.region}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onStart(code)}
            className="min-h-11 rounded-full bg-cyan-400 px-8 py-3.5 text-base font-bold text-black shadow-lg shadow-cyan-500/30 transition active:scale-95"
          >
            Defend {selected?.name}
          </button>
          <button
            onClick={() => setCode(COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)].code)}
            aria-label="Pick a random country"
            title="Random country"
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-white/20 px-4 py-3 text-sm font-bold text-white/80 transition active:scale-95"
          >
            <Dices className="h-5 w-5" /> Random
          </button>
        </div>
        <p className="text-xs text-white/55">Drag the marble to spin it</p>
      </section>

      {/* right: searchable grid of all 194 flags */}
      <section className="flex flex-1 flex-col border-t border-white/10 lg:h-full lg:min-h-0 lg:border-l lg:border-t-0">
        <div className="p-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search country or continent"
            aria-label="Search country or continent"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder-white/50 outline-none focus:border-cyan-400/60"
          />
        </div>
        <div className="grid auto-rows-max grid-cols-3 gap-2 px-4 pb-6 sm:grid-cols-4 md:grid-cols-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {results.map((c) => {
            const active = c.code === code;
            return (
              <button
                key={c.code}
                onClick={() => setCode(c.code)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 transition ${
                  active
                    ? "border-cyan-400 bg-cyan-400/10"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25"
                }`}
              >
                {/* raw <img> with loading="lazy" so offscreen flags load on scroll
                    (a CSS background eagerly fetches all 194); next/image does not
                    lazy-rasterize SVGs well, so a plain lazy img is the right tool */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={flagUrl(c.code)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-8 w-11 rounded-md bg-white/10 object-cover ring-1 ring-black/40"
                />
                <span className="line-clamp-1 text-center text-[11px] leading-tight text-white/70">
                  {c.name}
                </span>
              </button>
            );
          })}
          {results.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-white/60">
              No country matches “{query}”.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
