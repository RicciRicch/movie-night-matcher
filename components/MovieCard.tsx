"use client";

import Image from "next/image";
import { useState } from "react";
import type { Movie } from "../lib/room";

export function Poster({ movie }: { movie: Movie }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="poster">
      {movie.poster && !failed ? (
        <Image src={movie.poster} alt={movie.title + " poster"} width={500} height={750}
          unoptimized onError={() => setFailed(true)} />
      ) : <div className="poster-fallback"><span aria-hidden="true">✦</span><p>{movie.title}</p><small>Poster unavailable</small></div>}
    </div>
  );
}

export default function MovieCard({ movie, onVote }: { movie: Movie; onVote: (liked: boolean) => void }) {
  return (
    <div className="movie-card">
      <Poster key={movie.poster ?? movie.id} movie={movie} />
      <div className="movie-copy">
        <p className="eyebrow">Tonight’s possibility</p>
        <h2>{movie.title}</h2>
        <p className="movie-details">{movie.details}</p>
        {movie.rating !== null && <p className="rating"><span aria-hidden="true">★</span> {movie.rating.toFixed(1)} <span>on TMDB</span></p>}
        <p className="synopsis">{movie.description}</p>
        <div className="vote-actions">
          <button type="button" className="button pass" onClick={() => onVote(false)}><span aria-hidden="true">×</span> Pass</button>
          <button type="button" className="button like" onClick={() => onVote(true)}><span aria-hidden="true">♡</span> I’d watch it</button>
        </div>
        <p className="fine-print">Go with your first instinct. Your vote stays hidden from the group.</p>
      </div>
    </div>
  );
}
