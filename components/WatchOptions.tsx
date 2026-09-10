"use client";

import { useState } from "react";

type Availability = { subscription: string[]; rent: string[]; buy: string[]; link: string };
export default function WatchOptions({ id, country }: { id: number; country: string }) {
  const [data, setData] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/watch?id=${id}&country=${country}`, { signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t load streaming options.");
      setData(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t load streaming options."); }
    finally { setLoading(false); }
  }
  return <div className="watch-options">
    {!data && <button className="text-button" type="button" onClick={load} disabled={loading}>{loading ? "Checking availability…" : "Where can we watch? ↗"}</button>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {data && <>
      {data.subscription.length > 0 && <p><strong>With subscription</strong> {data.subscription.join(", ")}</p>}
      {data.rent.length > 0 && <p><strong>Rent</strong> {data.rent.join(", ")}</p>}
      {data.buy.length > 0 && <p><strong>Buy</strong> {data.buy.join(", ")}</p>}
      {!data.subscription.length && !data.rent.length && !data.buy.length && <p>No streaming options listed in your country right now.</p>}
      <a href={`https://www.themoviedb.org/movie/${id}/watch?locale=${country}`} target="_blank" rel="noreferrer">Check options on TMDB ↗</a>
      <small>Availability by JustWatch. Offers can change.</small>
    </>}
  </div>;
}
