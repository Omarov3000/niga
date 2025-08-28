import { useState, useRef } from 'react'
import { useAudio } from './use-audio'

function App() {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const {
    volume,
    progress,
    playing,
    ready,
    duration,
    play,
    pause,
    setProgress,
    setRelativeProgress,
    setVolume
  } = useAudio(audioUrl || undefined)

  const formatTime = (milliseconds: number) => {
    const seconds = milliseconds / 1000
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }

    const url = URL.createObjectURL(file)
    setAudioUrl(url)
  }


  const togglePlayPause = () => {
    if (playing) {
      pause()
    } else {
      play()
    }
  }

  const skip = (seconds: number) => {
    setRelativeProgress(seconds * 1000)
  }

  return (
    <div style={{ padding: '20px' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button onClick={() => fileInputRef.current?.click()}>
        Choose Audio File
      </button>
      {audioUrl && ready && (
        <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button 
            onClick={() => skip(-10)}
            style={{ 
              padding: '10px 15px', 
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            -10s
          </button>
          <button 
            onClick={togglePlayPause}
            style={{ 
              padding: '10px 20px', 
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button 
            onClick={() => skip(10)}
            style={{ 
              padding: '10px 15px', 
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            +10s
          </button>
          <div style={{ fontSize: '14px', marginLeft: '10px' }}>
            {formatTime(progress)} / {formatTime(duration)}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
