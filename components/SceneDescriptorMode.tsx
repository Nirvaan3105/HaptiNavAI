
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AppMode } from '../types';
import { ArrowLeftIcon, MicIcon, StopCircleIcon } from './icons';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from '@google/genai';
import { decode, decodeAudioData, createBlob } from '../utils/audio';

interface SceneDescriptorModeProps {
  setMode: (mode: AppMode) => void;
}

type SessionState = 'idle' | 'connecting' | 'active' | 'error' | 'stopped';

const SceneDescriptorMode: React.FC<SceneDescriptorModeProps> = ({ setMode }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [transcription, setTranscription] = useState<string>('');
  
  const sessionRef = useRef<Promise<LiveSession> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  
  const nextAudioStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const cleanup = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    if(scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if(inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if(outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    if (sessionRef.current) {
      sessionRef.current.then(session => session.close());
      sessionRef.current = null;
    }
  }, []);

  const startCameraAndMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: true,
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setError("Could not access camera or microphone. Please check permissions.");
      setSessionState('error');
    }
  }, []);

  useEffect(() => {
    startCameraAndMic();
    return () => {
      cleanup();
    };
  }, [startCameraAndMic, cleanup]);

  const startSession = async () => {
    if (!mediaStreamRef.current) {
      setError("Media stream not available.");
      setSessionState('error');
      return;
    }
    
    setSessionState('connecting');
    setTranscription('');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      nextAudioStartTimeRef.current = 0;

      sessionRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'You are a visual assistant. Describe what you see from the video frames and answer any user questions concisely. Be helpful and descriptive.',
        },
        callbacks: {
          onopen: () => {
            if (!inputAudioContextRef.current || !mediaStreamRef.current) return;
            const source = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
            scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              // FIX: Per guideline, solely rely on sessionPromise to resolve to avoid race conditions.
              sessionRef.current?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
            
            frameIntervalRef.current = window.setInterval(() => {
                if(videoRef.current && canvasRef.current) {
                    const video = videoRef.current;
                    const canvas = canvasRef.current;
                    const context = canvas.getContext('2d');
                    if (context) {
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                        canvas.toBlob(async (blob) => {
                            // FIX: Per guideline, solely rely on sessionPromise to resolve to avoid race conditions.
                            if(blob) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    const base64data = (reader.result as string).split(',')[1];
                                    sessionRef.current?.then((session) => {
                                        session.sendRealtimeInput({ media: { data: base64data, mimeType: 'image/jpeg' } });
                                    });
                                };
                                reader.readAsDataURL(blob);
                            }
                        }, 'image/jpeg', 0.8);
                    }
                }
            }, 1000); // 1 frame per second
            setSessionState('active');
          },
          onmessage: async (message: LiveServerMessage) => {
             if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                setTranscription(prev => prev + text);
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
                const ctx = outputAudioContextRef.current;
                nextAudioStartTimeRef.current = Math.max(nextAudioStartTimeRef.current, ctx.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
                source.start(nextAudioStartTimeRef.current);
                nextAudioStartTimeRef.current += audioBuffer.duration;
                audioSourcesRef.current.add(source);
            }
            
            if (message.serverContent?.interrupted) {
                for(const source of audioSourcesRef.current.values()) {
                    source.stop();
                }
                audioSourcesRef.current.clear();
                nextAudioStartTimeRef.current = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Session error:', e);
            setError('An error occurred with the connection.');
            setSessionState('error');
            cleanup();
          },
          onclose: () => {
             setSessionState('stopped');
             cleanup();
          },
        },
      });
      // Initial user prompt
      sessionRef.current.then((session) => session.sendRealtimeInput({text: "What is happening in front of me?"}));
    } catch (e) {
      console.error('Failed to start session', e);
      setError('Failed to initialize AI session.');
      setSessionState('error');
    }
  };
  
  const stopSession = () => {
    cleanup();
    setSessionState('stopped');
  };

  const getStatusMessage = () => {
    switch(sessionState) {
        case 'idle': return 'Press mic to start';
        case 'connecting': return 'Connecting...';
        case 'active': return 'Listening...';
        case 'stopped': return 'Session ended. Press mic to restart.';
        case 'error': return error || 'An error occurred';
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-between min-h-screen bg-black p-4">
      <div className="absolute top-4 left-4 z-20">
        <button onClick={() => { stopSession(); setMode(AppMode.HOME); }} className="p-2 bg-gray-800 bg-opacity-50 rounded-full">
            <ArrowLeftIcon className="w-6 h-6 text-white" />
        </button>
      </div>
       <div className="w-full max-w-lg aspect-[9/16] rounded-xl overflow-hidden relative shadow-lg bg-gray-800 flex items-center justify-center mt-16">
        {error && sessionState !== 'active' && <p className="text-red-400 text-center px-4">{error}</p>}
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden"></canvas>
      </div>
      <div className="w-full max-w-lg text-center mt-4 flex-grow flex flex-col justify-end pb-24">
        <div className="min-h-[6em] bg-black bg-opacity-30 rounded-lg p-3 mb-4">
            <p className="text-lg text-gray-300">{transcription || getStatusMessage()}</p>
        </div>
        <div className="flex items-center justify-center">
            {sessionState !== 'active' ? (
                 <button onClick={startSession} disabled={sessionState === 'connecting'} className="w-20 h-20 bg-teal-600 rounded-full flex items-center justify-center border-4 border-teal-400 disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-teal-500">
                    <MicIcon className="w-8 h-8 text-white"/>
                </button>
            ): (
                <button onClick={stopSession} className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center border-4 border-red-400 focus:outline-none focus:ring-4 focus:ring-red-500">
                    <StopCircleIcon className="w-8 h-8 text-white"/>
                </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default SceneDescriptorMode;
