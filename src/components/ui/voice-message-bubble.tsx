"use client"

import * as React from "react"
import { Pause, Play } from "lucide-react"

import { cn } from "@/lib/utils"

interface VoiceMessageBubbleProps {
  audioSrc: string
  // "out" = mensagem enviada pela equipe (direita), "in" = recebida do contato (esquerda).
  tone?: "in" | "out"
  className?: string
}

const BARS = 32

// Altura de cada barra sai do próprio src, não de Math.random: a onda fica igual a cada render
// (senão ela tremeria a cada atualização do cronômetro).
function waveHeights(seed: string): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return Array.from({ length: BARS }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0
    return 4 + (h % 13) + ((i * 7) % 3)
  })
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function VoiceMessageBubble({ audioSrc, tone = "in", className }: VoiceMessageBubbleProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [current, setCurrent] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const heights = React.useMemo(() => waveHeights(audioSrc), [audioSrc])

  // Áudio gravado pelo navegador (webm) não traz duração no cabeçalho: o Chrome reporta Infinity até
  // que o player pule pro fim. Truque comum: pular pra um tempo enorme, ler a duração real e voltar.
  function onLoadedMetadata(e: React.SyntheticEvent<HTMLAudioElement>) {
    const el = e.currentTarget
    if (Number.isFinite(el.duration)) {
      setDuration(el.duration)
      return
    }
    el.currentTime = Number.MAX_SAFE_INTEGER
    const onDurationChange = () => {
      if (Number.isFinite(el.duration)) {
        setDuration(el.duration)
        el.currentTime = 0
        el.removeEventListener("durationchange", onDurationChange)
      }
    }
    el.addEventListener("durationchange", onDurationChange)
  }

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current
    if (!el || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    el.currentTime = ratio * duration
    setCurrent(el.currentTime)
  }

  const progress = duration ? Math.min(1, current / duration) : 0
  const mine = tone === "out"

  return (
    <div className={cn("flex items-center gap-2.5 min-w-[220px] max-w-[280px] py-1", className)}>
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrent(0)
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
        className={cn(
          "grid place-items-center w-9 h-9 rounded-full shrink-0 cursor-pointer bg-primary-strong text-white"
        )}
      >
        {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div
          onClick={seek}
          role="slider"
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          className="flex items-center gap-[2px] h-7 cursor-pointer"
        >
          {heights.map((h, i) => {
            const played = i / BARS < progress
            return (
              <span
                key={i}
                className={cn("w-[3px] rounded-full", played ? "bg-primary-strong" : mine ? "bg-primary-strong/35" : "bg-text-muted/40")}
                style={{ height: `${h * 1.6}px` }}
              />
            )
          })}
        </div>
        <span className="text-[11px] text-text-muted tabular-nums">{formatTime(playing || current > 0 ? current : duration)}</span>
      </div>
    </div>
  )
}
