import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BoundingBox, AppMode } from '../types';
import { CameraIcon, ArrowLeftIcon } from './icons';

// Declare cocoSsd and its types from the global scope, as it's loaded via <script>
declare const cocoSsd: {
  load: () => Promise<cocoSsd.ObjectDetection>;
};

namespace cocoSsd {
  export interface ObjectDetection {
    detect(img: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<DetectedObject[]>;
  }
  export interface DetectedObject {
    bbox: [number, number, number, number]; // [x, y, width, height] in pixels
    class: string;
    score: number;
  }
}

interface FastModeProps {
  setMode: (mode: AppMode) => void;
}

const FastMode: React.FC<FastModeProps> = ({ setMode }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<BoundingBox[]>([]);

  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);

  // Load the COCO-SSD model on component mount
  useEffect(() => {
    const loadModel = async () => {
      setIsLoadingModel(true);
      try {
        // Ensure cocoSsd is available on the window object
        if ((window as any).cocoSsd) {
          const loadedModel = await (window as any).cocoSsd.load();
          setModel(loadedModel);
        } else {
          throw new Error("coco-ssd model not loaded");
        }
      } catch (err) {
        console.error("Failed to load model:", err);
        setError("Could not load the object detection model. Please try again later.");
      } finally {
        setIsLoadingModel(false);
      }
    };
    loadModel();
  }, []);

  const startCamera = useCallback(async () => {
    // Stop any existing stream before starting a new one to prevent resource leaks
    if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play(); // Ensure video plays
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setError("Could not access camera. Please check permissions.");
    }
  }, []);

  useEffect(() => {
    startCamera();

    return () => {
      // Cleanup on unmount
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      window.speechSynthesis.cancel(); // Stop any speech on exit
    };
  }, [startCamera]);

  const handleCapture = async () => {
    if (videoRef.current && canvasRef.current && model && !isDetecting) {
      setIsDetecting(true);
      setBoxes([]);
      window.speechSynthesis.cancel();

      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        setCapturedImage(dataUrl);

        try {
          // Perform detection on the canvas
          const predictions = await model.detect(canvas);

          // Generate a summary for text-to-speech
          const uniqueLabels = [...new Set(predictions.map(p => p.class))];
          let summary: string;
          if (predictions.length === 0) {
            summary = "I could not detect any objects.";
          } else if (uniqueLabels.length === 1) {
            summary = `I see a ${uniqueLabels[0]}.`;
          } else {
            const lastLabel = uniqueLabels.pop()!;
            summary = `I see ${uniqueLabels.join(', ')}, and a ${lastLabel}.`;
          }
          const utterance = new SpeechSynthesisUtterance(summary);
          window.speechSynthesis.speak(utterance);


          // Convert predictions to our BoundingBox format with normalized coordinates
          const newBoxes: BoundingBox[] = predictions.map((p, index) => ({
            id: index,
            label: `${p.class} (${Math.round(p.score * 100)}%)`,
            x: p.bbox[0] / canvas.width,
            y: p.bbox[1] / canvas.height,
            width: p.bbox[2] / canvas.width,
            height: p.bbox[3] / canvas.height,
          }));
          
          setBoxes(newBoxes);

        } catch (err) {
            console.error("Detection failed:", err);
            setError("Object detection failed.");
        }
      }
      setIsDetecting(false);
    }
  };

  const handleReset = () => {
    window.speechSynthesis.cancel(); // Stop any ongoing speech
    setCapturedImage(null);
    setBoxes([]);
    startCamera(); // Restart camera to ensure a fresh stream
  };

  const getButtonContent = () => {
    if (isLoadingModel) {
      return (
        <div className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-gray-800">Loading Model...</span>
        </div>
      );
    }
    if (isDetecting) {
        return (
            <div className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-gray-800">Detecting...</span>
            </div>
        );
    }
    return <CameraIcon className="w-8 h-8 text-gray-800" />;
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-black p-4">
      <button onClick={() => setMode(AppMode.HOME)} className="absolute top-4 left-4 z-20 p-2 bg-gray-800 bg-opacity-50 rounded-full">
        <ArrowLeftIcon className="w-6 h-6 text-white" />
      </button>

      <div className="w-full max-w-lg aspect-[9/16] rounded-xl overflow-hidden relative shadow-lg bg-gray-800 flex items-center justify-center">
        {error && !isLoadingModel && <p className="text-red-400 text-center px-4">{error}</p>}
        
        <canvas ref={canvasRef} className="hidden" />

        {!capturedImage ? (
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        ) : (
          <div className="relative w-full h-full">
            <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
            {boxes.map(box => (
              <div
                key={box.id}
                className="absolute border-2 border-yellow-400"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
              >
                <span className="absolute -top-6 left-0 bg-yellow-400 text-black text-xs font-semibold px-1 rounded">
                  {box.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
        {!capturedImage ? (
          <button
            onClick={handleCapture}
            disabled={isLoadingModel || isDetecting}
            className="w-auto h-20 px-8 bg-white rounded-full flex items-center justify-center border-4 border-gray-500 focus:outline-none focus:ring-4 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Capture"
          >
            {getButtonContent()}
          </button>
        ) : (
          <button
            onClick={handleReset}
            className="px-6 py-3 bg-indigo-600 text-white rounded-full font-semibold shadow-lg focus:outline-none focus:ring-4 focus:ring-indigo-500"
          >
            Capture Again
          </button>
        )}
      </div>
    </div>
  );
};

export default FastMode;