import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { whenTransitionEnds } from '../state/launch'
import { useCabin } from '../state/store'
import { followArea, type Hole } from './youtube/youtube'

/** Where a service's page shows, in the frame's pixels (its `show` command). */
export interface Placed {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where a service's hidden page shows (an app whose website runs hidden in the host): the page, placed under the cabin page by
 * the host, at this element's size (`show`), and the CarPlay area cut open over it (Shell.tsx, from `hole`).
 * Placed again whenever it may have moved (as YouTube's VideoHole.tsx, whose ways it follows), and gone with it
 * (`hide`); what's drawn over it (`children`) is in its own layer above the CarPlay area.
 */
export function PageHole({
  className,
  hole,
  setHole,
  show,
  hide,
  children,
}: {
  className: string
  hole: Hole | null
  setHole(hole: Hole | null): void
  show(placed: Placed): void
  hide(): void
  children: ReactNode
}) {
  const handedOver = useCabin((state) => state.truckScreen)
  const frame = useRef<HTMLDivElement>(null)
  // The latest ways to tell where it is (the effect runs once a placing, not at every render).
  const told = useRef({ setHole, show, hide })
  useLayoutEffect(() => {
    told.current = { setHole, show, hide }
  })
  useEffect(() => {
    const element = frame.current
    if (!element || handedOver) return
    const slot = element.closest('.screen-slot')
    const moving = () => !!slot && (slot.classList.contains('entering') || slot.classList.contains('leaving'))
    const place = () => {
      const area = document.querySelector('.carplay')?.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      if (!area || box.width === 0) return
      told.current.setHole({
        x: box.left - area.left,
        y: box.top - area.top,
        width: box.width,
        height: box.height,
        radius: 0,
      })
      const scale = window.devicePixelRatio
      told.current.show({
        x: Math.round(box.left * scale),
        y: Math.round(box.top * scale),
        width: Math.round(box.width * scale),
        height: Math.round(box.height * scale),
      })
    }
    let following: (() => void) | null = null
    let settling: ReturnType<typeof setTimeout>[] = []
    let gone = false
    const follow = () => {
      if (gone || following || moving()) return
      following = followArea(place, element)
      // The app's window grows in from its icon (a transform, which no size change tells of).
      settling = [120, 350, 700].map((ms) => setTimeout(place, ms))
    }
    const stopped = slot ? new MutationObserver(follow) : null
    if (slot) stopped?.observe(slot, { attributes: true, attributeFilter: ['class'] })
    whenTransitionEnds(follow)
    return () => {
      gone = true
      stopped?.disconnect()
      settling.forEach(clearTimeout)
      if (!following) return
      following()
      told.current.setHole(null)
      told.current.hide()
    }
  }, [handedOver])
  const layer = hole ? document.getElementById('video-over') : null
  return (
    <div ref={frame} className={className}>
      {layer &&
        hole &&
        createPortal(
          <div
            className="over-video"
            style={{ left: hole.x, top: hole.y, width: hole.width, height: hole.height, borderRadius: hole.radius }}
          >
            <div
              className="over-video-content"
              style={{
                width: `calc(${hole.width}px / var(--ui-scale, 1))`,
                height: `calc(${hole.height}px / var(--ui-scale, 1))`,
              }}
            >
              {children}
            </div>
          </div>,
          layer,
        )}
    </div>
  )
}
