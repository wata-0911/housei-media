import { useEffect, useRef, useState } from 'react'

type XTimelineProps = {
  tweetId: string
}

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        createTweet: (
          tweetId: string,
          element: HTMLElement,
          options?: {
            theme?: 'light' | 'dark'
            align?: 'left' | 'center' | 'right'
            conversation?: 'none' | 'all'
          }
        ) => Promise<HTMLElement | null>
      }
    }
  }
}

const SCRIPT_ID = 'twitter-wjs'
const SCRIPT_URL = 'https://platform.twitter.com/widgets.js'
const LOAD_TIMEOUT_MS = 10_000

let twitterScriptPromise: Promise<void> | null = null

function loadTwitterWidgets(): Promise<void> {
  if (window.twttr?.widgets) {
    return Promise.resolve()
  }

  if (twitterScriptPromise) {
    return twitterScriptPromise
  }

  twitterScriptPromise = new Promise<void>((resolve, reject) => {
    let script = document.getElementById(
      SCRIPT_ID
    ) as HTMLScriptElement | null

    if (script?.dataset.loadState === 'failed') {
      script.remove()
      script = null
    }

    const handleLoad = () => {
      if (script) {
        script.dataset.loadState = 'loaded'
      }

      if (window.twttr?.widgets) {
        resolve()
      } else {
        twitterScriptPromise = null
        reject(new Error('X widgets API is unavailable'))
      }
    }

    const handleError = () => {
      if (script) {
        script.dataset.loadState = 'failed'
        script.remove()
      }

      twitterScriptPromise = null
      reject(new Error('Failed to load X widgets script'))
    }

    if (!script) {
      script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = SCRIPT_URL
      script.async = true
      script.charset = 'utf-8'
      script.dataset.loadState = 'loading'

      script.addEventListener('load', handleLoad, { once: true })
      script.addEventListener('error', handleError, { once: true })

      document.head.appendChild(script)
      return
    }

    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
  })

  return twitterScriptPromise
}

export default function XTimeline({ tweetId }: XTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    const cleanTweetId = tweetId.trim()
    const container = containerRef.current

    if (!cleanTweetId || !container) {
      setHasError(true)
      return
    }

    let cancelled = false
    let timeoutId: number | undefined

    setHasError(false)
    container.innerHTML = ''

    const renderTweet = async () => {
      try {
        await Promise.race([
          loadTwitterWidgets(),
          new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => {
              reject(new Error('X widget loading timed out'))
            }, LOAD_TIMEOUT_MS)
          }),
        ])

        if (cancelled || !window.twttr?.widgets) {
          return
        }

        container.innerHTML = ''

        const element = await window.twttr.widgets.createTweet(
          cleanTweetId,
          container,
          {
            theme: 'light',
            align: 'center',
            conversation: 'none',
          }
        )

        if (cancelled) {
          element?.remove()
          return
        }

        if (!element) {
          throw new Error('X post could not be rendered')
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        console.error('Failed to render X post:', error)
        container.innerHTML = ''
        setHasError(true)
      } finally {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId)
        }
      }
    }

    void renderTweet()

    return () => {
      cancelled = true

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }

      container.innerHTML = ''
    }
  }, [tweetId])

  const cleanTweetId = tweetId.trim()

  if (hasError) {
    return (
      <div className="w-full min-h-[300px] flex items-center justify-center">
        <a
          href={`https://x.com/i/web/status/${encodeURIComponent(cleanTweetId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[#002255] underline hover:text-[#E65C00] transition-colors"
        >
          Xでこのポストを見る
        </a>
      </div>
    )
  }

  return (
    <div className="w-full flex justify-center items-center min-h-[300px]">
      <div ref={containerRef} className="w-full max-w-lg" />
    </div>
  )
}