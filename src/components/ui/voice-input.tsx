"use client"

import React from "react"
import { Mic } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

import { cn } from "@/lib/utils"

interface VoiceInputProps {
  // Quando informado, o pai decide se está gravando (ex.: gravação só começa depois de o navegador dar permissão).
  listening?: boolean
  onStart?: () => void
  onStop?: () => void
  disabled?: boolean
}

export function VoiceInput({
  className,
  listening: listeningProp,
  onStart,
  onStop,
  disabled,
}: React.ComponentProps<"div"> & VoiceInputProps) {
  const [listeningState, setListeningState] = React.useState<boolean>(false)
  const [time, setTime] = React.useState<number>(0)
  const controlled = listeningProp !== undefined
  const listening = controlled ? listeningProp : listeningState

  // Pula a primeira renderização: sem isso, onStop dispararia logo ao montar.
  const mounted = React.useRef(false)

  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    // Modo controlado: os callbacks saem só do clique (onClickHandler), senão o efeito chamaria de novo.
    if (listening) {
      if (!controlled) onStart?.()
      const intervalId = setInterval(() => setTime((t) => t + 1), 1000)
      return () => clearInterval(intervalId)
    }
    if (!controlled) onStop?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const onClickHandler = () => {
    if (disabled) return
    if (!listening) setTime(0)
    if (!controlled) setListeningState(!listeningState)
    else if (listening) onStop?.()
    else onStart?.()
  }

  return (
    <div className={cn("flex flex-col items-center justify-center", className)}>
      <motion.button
        type="button"
        className={cn(
          "flex p-2 border items-center justify-center rounded-full shrink-0",
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
          listening ? "border-primary-strong" : "border-border text-text-muted hover:text-text hover:bg-bg"
        )}
        layout
        transition={{ layout: { duration: 0.4 } }}
        onClick={onClickHandler}
        disabled={disabled}
        title={listening ? "Parar e enviar gravação" : "Gravar áudio"}
        aria-label={listening ? "Parar e enviar gravação" : "Gravar áudio"}
      >
        <div className="h-6 w-6 items-center justify-center flex">
          {listening ? (
            <motion.div
              className="w-4 h-4 bg-primary rounded-sm"
              animate={{ rotate: [0, 180, 360] }}
              transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
          ) : (
            <Mic className="w-[18px] h-[18px]" />
          )}
        </div>
        <AnimatePresence mode="wait">
          {listening && (
            <motion.div
              initial={{ opacity: 0, width: 0, marginLeft: 0 }}
              animate={{ opacity: 1, width: "auto", marginLeft: 8 }}
              exit={{ opacity: 0, width: 0, marginLeft: 0 }}
              transition={{ duration: 0.4 }}
              className="overflow-hidden flex gap-2 items-center justify-center"
            >
              {/* Animação de frequência */}
              <div className="flex gap-0.5 items-center justify-center">
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-0.5 bg-primary rounded-full"
                    initial={{ height: 2 }}
                    animate={{ height: [2, 3 + ((i * 7) % 10), 3 + ((i * 3) % 6), 2] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.05, ease: "easeInOut" }}
                  />
                ))}
              </div>
              {/* Cronômetro */}
              <div className="text-xs text-text-muted w-10 text-center tabular-nums">{formatTime(time)}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  )
}
