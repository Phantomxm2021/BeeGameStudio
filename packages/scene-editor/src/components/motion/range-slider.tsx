// Ported from the free beUI Range Slider: https://beui.dev/components/motion/range-slider
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const SPRING_GLIDE = { stiffness: 700, damping: 50, mass: .5 }
const SPRING_BOUNCY = { type: 'spring', stiffness: 500, damping: 14, mass: .7 } as const
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export type RangeSliderProps = {
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  showTicks?: boolean
  className?: string
  'aria-label'?: string
  formatValueText?: (value: number) => string
}

function snap(next: number, min: number, max: number, step: number) {
  if (!(max > min)) return min
  if (!(step > 0)) return clamp(next, min, max)
  const whole = Math.floor(Number(((max - min) / step).toFixed(6)))
  const lastWhole = Number((min + whole * step).toFixed(6))
  const grid = clamp(Math.round((next - min) / step) * step + min, min, lastWhole)
  return Number((lastWhole < max && Math.abs(next - max) <= Math.abs(next - grid) ? max : grid).toFixed(6))
}

export function RangeSlider({ value, defaultValue = 0, onValueChange, min = 0, max = 100, step = 1, disabled = false, showTicks = true, className = '', 'aria-label': ariaLabel, formatValueText }: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [internal, setInternal] = useState(defaultValue)
  const [dragging, setDragging] = useState(false)
  const [trackWidth, setTrackWidth] = useState(180)
  const reduce = useReducedMotion()
  const lo = min
  const hi = max > min ? max : min
  const stride = step > 0 ? step : 1
  const controlled = value !== undefined
  const current = clamp(controlled ? value : internal, lo, hi)
  const percent = hi > lo ? ((current - lo) / (hi - lo)) * 100 : 0
  const commit = useCallback((next: number) => {
    const clean = snap(next, lo, hi, stride)
    if (!controlled) setInternal(clean)
    onValueChange?.(clean)
  }, [controlled, hi, lo, onValueChange, stride])
  const commitFromX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    commit(lo + clamp((clientX - rect.left) / rect.width, 0, 1) * (hi - lo))
  }, [commit, hi, lo])
  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* stale pointer */ }
    draggingRef.current = false
    setDragging(false)
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const values: Record<string, number> = { ArrowRight: current + stride, ArrowUp: current + stride, ArrowLeft: current - stride, ArrowDown: current - stride, PageUp: current + stride * 10, PageDown: current - stride * 10, Home: lo, End: hi }
    if (event.key in values) { event.preventDefault(); commit(values[event.key]) }
  }
  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const measure = () => { const width = track.getBoundingClientRect().width; if (width > 0) setTrackWidth(width) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure); observer.observe(track); return () => observer.disconnect()
  }, [])
  const target = useMotionValue(percent)
  useEffect(() => target.set(percent), [percent, target])
  const smooth = useSpring(target, SPRING_GLIDE)
  const position = reduce ? target : smooth
  const thumbX = useTransform(position, point => 8 + Math.max(0, trackWidth - 20) * point / 100)
  const fillScale = useTransform(position, point => point / 100)
  const stepCount = Math.floor(Number(((hi - lo) / stride).toFixed(6)))
  const ticks = showTicks && stepCount > 0 && stepCount <= 20 ? Array.from({ length: stepCount + 1 }, (_, index) => Number((lo + index * stride).toFixed(6))) : []

  return <div ref={trackRef} className={`beui-range-slider ${disabled ? 'is-disabled' : ''} ${className}`} onPointerDown={event => {
    if (disabled) return
    draggingRef.current = true; setDragging(true)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* implicit touch capture */ }
    thumbRef.current?.focus({ preventScroll: true }); commitFromX(event.clientX)
  }} onPointerMove={event => { if (draggingRef.current && !disabled) commitFromX(event.clientX) }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
    <motion.div aria-hidden className="beui-range-fill" style={{ scaleX: fillScale }} />
    <div aria-hidden className="beui-range-ticks">{ticks.map(tick => <span key={tick} style={{ left: `${((tick - lo) / (hi - lo)) * 100}%` }} />)}</div>
    <motion.div ref={thumbRef} role="slider" tabIndex={disabled ? -1 : 0} aria-label={ariaLabel} aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={current} aria-valuetext={formatValueText?.(current)} aria-disabled={disabled || undefined} onKeyDown={onKeyDown} animate={reduce ? undefined : { scaleY: dragging ? 1.35 : 1 }} transition={SPRING_BOUNCY} className="beui-range-thumb" style={{ x: thumbX }} />
  </div>
}
