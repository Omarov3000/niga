import { useState, useEffect, useRef, useCallback } from 'react';

interface UseAudioReturn {
  volume: number;
  progress: number; // ms
  playing: boolean;
  ready: boolean;
  duration: number;
  play: () => void;
  pause: () => void;
  setProgress: (progress: number) => void;
  setRelativeProgress: (ms: number) => void; // ms is delta
  setVolume: (volume: number) => void;
}

export function useAudio(url?: string, onEnd?: () => void): UseAudioReturn {
  // Create refs for audio context and gain node
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Initialize audio context lazily
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
    }
    return { audioContext: audioContextRef.current, gainNode: gainNodeRef.current };
  }, []);

  const [volume, setVolume] = useState<number>(1);
  const [progress, setProgress] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const [ready, setReady] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);

  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preloadingRef = useRef<boolean>(false);
  const currentUrlRef = useRef<string | undefined>(undefined);
  const playingRef = useRef<boolean>(false);

  // Progress tracking
  const startProgressTracking = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(() => {
      const audioState = getAudioContext();
      if (audioState.audioContext && startTimeRef.current >= 0) {
        const elapsed = (audioState.audioContext.currentTime - startTimeRef.current) * 1000;
        setProgress(Math.min(elapsed, duration));

        // Check if playback is complete
        if (elapsed >= duration && duration > 0) {
          setPlaying(false);
          playingRef.current = false;
          setProgress(duration);
          if (onEnd) onEnd();
          clearInterval(progressIntervalRef.current!);
        }
      }
    }, 100);
  }, [duration, onEnd, getAudioContext]);

  const stopProgressTracking = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // Pre-load audio data (called on mount and URL change)
  const preloadAudio = useCallback(async (audioUrl: string) => {
    if (!audioUrl || preloadingRef.current || currentUrlRef.current === audioUrl) return;

    try {
      preloadingRef.current = true;
      setReady(false);
      setDuration(0);
      setProgress(0);
      audioBufferRef.current = null;
      currentUrlRef.current = audioUrl;

      const response = await fetch(audioUrl);
      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      // Read all chunks
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalSize += value.length;
      }

      // Combine all chunks into a single array buffer
      const combinedBuffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combinedBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      // Decode the complete audio data
      const audioState = getAudioContext();
      const audioBuffer = await audioState.audioContext.decodeAudioData(combinedBuffer.buffer);
      audioBufferRef.current = audioBuffer;
      setDuration(audioBuffer.duration * 1000);
      setReady(true);

    } catch (error) {
      console.error('Error preloading audio:', error);
      setReady(false);
      audioBufferRef.current = null;
    } finally {
      preloadingRef.current = false;
    }
  }, [getAudioContext]);

  const play = useCallback(async () => {
    // If no buffer loaded yet, stream first
    if (!audioBufferRef.current && url) {
      await preloadAudio(url);
    }

    if (!ready || !audioBufferRef.current) return;

    const audioState = getAudioContext();
    if (!audioState.audioContext) return;

    // Resume audio context if suspended
    if (audioState.audioContext.state === 'suspended') {
      await audioState.audioContext.resume();
    }

    // Stop current source if playing
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {
        // Source might already be stopped
      }
    }

    // Create new source
    sourceNodeRef.current = audioState.audioContext.createBufferSource();
    sourceNodeRef.current.buffer = audioBufferRef.current;
    sourceNodeRef.current.connect(audioState.gainNode);

    // Calculate offset for resume
    const offset = pauseTimeRef.current / 1000;

    sourceNodeRef.current.onended = () => {
      setPlaying(false);
      playingRef.current = false;
      setProgress(duration);
      if (onEnd) onEnd();
      stopProgressTracking();
    };

    sourceNodeRef.current.start(0, offset);
    startTimeRef.current = audioState.audioContext.currentTime - offset;
    setPlaying(true);
    playingRef.current = true;
    startProgressTracking();
  }, [ready, duration, onEnd, startProgressTracking, stopProgressTracking, getAudioContext, url, preloadAudio]);

  const pause = useCallback(() => {
    if (sourceNodeRef.current) {
      // Calculate current progress before stopping
      const audioState = getAudioContext();
      if (audioState.audioContext && startTimeRef.current >= 0) {
        const elapsed = (audioState.audioContext.currentTime - startTimeRef.current) * 1000;
        pauseTimeRef.current = Math.min(elapsed, duration);
      }
      
      try {
        sourceNodeRef.current.stop();
      } catch (e) {
        // Source might already be stopped
      }

      setPlaying(false);
      playingRef.current = false;
      stopProgressTracking();
    }
  }, [stopProgressTracking, getAudioContext, duration]);

  const setProgressHandler = useCallback((newProgress: number) => {
    const clampedProgress = Math.max(0, Math.min(newProgress, duration));
    setProgress(clampedProgress);
    pauseTimeRef.current = clampedProgress;

    if (playingRef.current && sourceNodeRef.current) {
      // Stop current playback
      try {
        sourceNodeRef.current.stop();
      } catch (e) {
        // Source might already be stopped
      }
      
      // Restart from new position
      const audioState = getAudioContext();
      if (audioState.audioContext && audioBufferRef.current) {
        sourceNodeRef.current = audioState.audioContext.createBufferSource();
        sourceNodeRef.current.buffer = audioBufferRef.current;
        sourceNodeRef.current.connect(audioState.gainNode);
        
        const offset = clampedProgress / 1000;
        sourceNodeRef.current.onended = () => {
          setPlaying(false);
          playingRef.current = false;
          setProgress(duration);
          if (onEnd) onEnd();
          stopProgressTracking();
        };
        
        sourceNodeRef.current.start(0, offset);
        startTimeRef.current = audioState.audioContext.currentTime - offset;
      }
    }
  }, [duration, getAudioContext, onEnd, stopProgressTracking]);

  const setRelativeProgress = useCallback((ms: number) => {
    const newProgress = progress + ms;
    const clampedProgress = Math.max(0, Math.min(newProgress, duration));
    setProgressHandler(clampedProgress);
  }, [progress, duration, setProgressHandler]);

  const setVolumeHandler = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolume(clampedVolume);
    // Update gain node immediately
    const audioState = getAudioContext();
    if (audioState.gainNode && audioState.audioContext) {
      audioState.gainNode.gain.setValueAtTime(clampedVolume, audioState.audioContext.currentTime);
    }
  }, [getAudioContext]);

  // Single effect for URL changes and cleanup
  useEffect(() => {
    // Pre-load audio when URL changes
    if (url && url !== currentUrlRef.current) {
      preloadAudio(url);
    } else if (!url) {
      setReady(false);
      setDuration(0);
      setProgress(0);
      setPlaying(false);
      audioBufferRef.current = null;
      currentUrlRef.current = undefined;
    }

    // Cleanup function
    return () => {
      stopProgressTracking();
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
        } catch (e) {
          // Source might already be stopped
        }
      }
    };
  }, [url, preloadAudio, stopProgressTracking]);

  // Only close audio context when component unmounts
  useEffect(() => {
    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    volume,
    progress,
    playing,
    ready,
    duration,
    play,
    pause,
    setProgress: setProgressHandler,
    setRelativeProgress,
    setVolume: setVolumeHandler
  };
};
