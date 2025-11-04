import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AppMode } from '../types';
import { ArrowLeftIcon, MapPinIcon, NavigationIcon } from './icons';
import { GoogleGenAI } from '@google/genai';

interface MapsModeProps {
  setMode: (mode: AppMode) => void;
}

// Helper to convert blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = (reader.result as string).split(',')[1];
            resolve(base64data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};


const MapsMode: React.FC<MapsModeProps> = ({ setMode }) => {
    const [destination, setDestination] = useState('');
    const [isNavigating, setIsNavigating] = useState(false);
    const [instruction, setInstruction] = useState('Enter a destination to begin.');
    const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [locationPermission, setLocationPermission] = useState<'checking' | 'prompt' | 'granted' | 'denied'>('checking');

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const intervalRef = useRef<number | null>(null);
    const aiRef = useRef<GoogleGenAI | null>(null);
    const locationWatcherId = useRef<number | null>(null);
    const isNavigatingRef = useRef(isNavigating);

    useEffect(() => {
        isNavigatingRef.current = isNavigating;
    }, [isNavigating]);

    // Initialize AI instance
    useEffect(() => {
        aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    }, []);

    const speak = (text: string) => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
    };

    const cleanup = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (videoRef.current && videoRef.current.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
        }
        window.speechSynthesis.cancel();
    }, []);
    
    // Check and handle location permissions
    useEffect(() => {
        const checkLocationPermission = async () => {
            if (!navigator.geolocation) {
                setError("Geolocation is not supported by your browser.");
                setLocationPermission('denied');
                return;
            }

            try {
                const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
                setLocationPermission(permissionStatus.state);
                permissionStatus.onchange = () => {
                    setLocationPermission(permissionStatus.state);
                };
            } catch (error) {
                console.error("Permissions API not supported, falling back to prompt.", error);
                setLocationPermission('prompt');
            }
        };

        checkLocationPermission();
    }, []);

    // Fetch location when permission is granted
    useEffect(() => {
        if (locationPermission === 'granted') {
            setIsLoading(true);
            const successCallback = (position: GeolocationPosition) => {
                setCurrentLocation({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                });
                setIsLoading(false);
                setError(null);
            };
            const errorCallback = (err: GeolocationPositionError) => {
                setError("Unable to retrieve your location. Please check device settings.");
                setIsLoading(false);
            };

            navigator.geolocation.getCurrentPosition(successCallback, errorCallback, { enableHighAccuracy: true });
            
            locationWatcherId.current = navigator.geolocation.watchPosition(successCallback, errorCallback, { enableHighAccuracy: true });
        } else {
            setIsLoading(false);
        }
        
        return () => {
            if (locationWatcherId.current) {
                navigator.geolocation.clearWatch(locationWatcherId.current);
                locationWatcherId.current = null;
            }
        };
    }, [locationPermission]);


    const requestLocationPermission = () => {
        navigator.geolocation.getCurrentPosition(
            () => {
                // Success is handled by the permission status change listener
            },
            (err) => {
                if(err.code === err.PERMISSION_DENIED) {
                     setError("Location permission denied. Please enable it in your browser settings.");
                } else {
                     setError("Unable to retrieve your location.");
                }
            }
        );
    };

    // Manage camera stream
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
            }
        } catch (err) {
            console.error("Error accessing camera:", err);
            setError("Could not access camera. Please check permissions.");
        }
    };
    
    const getNavigationInstruction = async () => {
        if (!aiRef.current || !currentLocation || !videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) {
            return;
        }

        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) return;
        
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        if (!blob) return;
        
        const base64Image = await blobToBase64(blob);

        setInstruction("Thinking...");

        try {
            const response = await aiRef.current.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: {
                    parts: [
                        {
                            inlineData: {
                                mimeType: 'image/jpeg',
                                data: base64Image,
                            }
                        },
                        {
                            text: `You are a walking navigation assistant. My current location is latitude ${currentLocation.lat}, longitude ${currentLocation.lng}, and my destination is "${destination}". Using this real-time location and Google Maps data, provide the next clear, concise walking instruction to guide me. Also, use the attached image of my current view to identify and mention any relevant landmarks, street signs, or potential obstacles in the instruction. The instruction should be a single step.`
                        }
                    ]
                },
                config: {
                    tools: [{ googleMaps: {} }],
                    toolConfig: {
                        retrievalConfig: {
                            latLng: {
                                latitude: currentLocation.lat,
                                longitude: currentLocation.lng
                            }
                        }
                    }
                }
            });

            if (isNavigatingRef.current) {
                const newInstruction = response.text;
                setInstruction(newInstruction);
                speak(newInstruction);
            }
        } catch (err) {
            console.error("AI navigation error:", err);
            if (isNavigatingRef.current) {
                const errorMsg = "Sorry, I couldn't get the next instruction.";
                setInstruction(errorMsg);
                speak(errorMsg);
            }
        }
    };

    const handleStartNavigation = async () => {
        if (!destination.trim() || !currentLocation) {
            setError("Please enter a destination and enable location.");
            return;
        }
        setError(null);
        setIsNavigating(true);
        await startCamera();
        setInstruction("Starting navigation...");
        speak("Starting navigation...");

        // Give camera time to initialize before first call
        setTimeout(() => {
            getNavigationInstruction();
            intervalRef.current = window.setInterval(getNavigationInstruction, 8000); // Update every 8 seconds
        }, 2000);
    };

    const handleStopNavigation = () => {
        setIsNavigating(false);
        setInstruction('Navigation stopped. Enter a destination to begin again.');
        cleanup();
    };
    
    const handleBack = () => {
        cleanup();
        setMode(AppMode.HOME);
    };

    if (isLoading || locationPermission === 'checking') {
        return (
             <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
                <svg className="animate-spin h-10 w-10 text-white mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p>{locationPermission === 'checking' ? 'Checking permissions...' : 'Getting your location...'}</p>
             </div>
        );
    }

    if (locationPermission === 'prompt') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4 text-center">
                <button onClick={handleBack} className="absolute top-4 left-4 z-20 p-2 bg-gray-800 bg-opacity-50 rounded-full">
                    <ArrowLeftIcon className="w-6 h-6 text-white" />
                </button>
                <MapPinIcon className="w-16 h-16 text-sky-400 mb-4" />
                <h1 className="text-2xl font-bold mb-2">Location Required</h1>
                <p className="text-gray-400 mb-6 max-w-sm">This feature needs your location to provide navigation instructions. Please grant permission to continue.</p>
                <button
                    onClick={requestLocationPermission}
                    className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg"
                >
                    Enable Location
                </button>
                {error && <p className="text-red-400 mt-4">{error}</p>}
            </div>
        );
    }
    
    if (locationPermission === 'denied') {
        return (
             <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4 text-center">
                 <button onClick={handleBack} className="absolute top-4 left-4 z-20 p-2 bg-gray-800 bg-opacity-50 rounded-full">
                    <ArrowLeftIcon className="w-6 h-6 text-white" />
                </button>
                <MapPinIcon className="w-16 h-16 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold mb-2">Location Access Denied</h1>
                <p className="text-gray-400 mb-6 max-w-sm">You've denied location access. To use navigation, please enable it in your browser's site settings.</p>
                {error && <p className="text-red-400 mt-4">{error}</p>}
             </div>
        );
    }

    // Granted
    return (
        <div className="relative flex flex-col items-center justify-between min-h-screen bg-black p-4">
             <button onClick={handleBack} className="absolute top-4 left-4 z-20 p-2 bg-gray-800 bg-opacity-50 rounded-full">
                <ArrowLeftIcon className="w-6 h-6 text-white" />
            </button>
            {isNavigating && (
                <div className="absolute inset-0 z-0">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    <canvas ref={canvasRef} className="hidden" />
                </div>
            )}
            
            <div className={`relative z-10 w-full max-w-lg mt-16 text-center transition-opacity duration-500 ${isNavigating ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <h1 className="text-4xl font-bold mb-4">Maps Navigation</h1>
                <div className="relative">
                    <MapPinIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                        placeholder="Enter destination..."
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 pl-10 pr-4 text-white text-lg focus:ring-2 focus:ring-sky-500 focus:outline-none"
                    />
                </div>
                <button
                    onClick={handleStartNavigation}
                    disabled={!destination || !currentLocation}
                    className="mt-4 w-full bg-sky-600 hover:bg-sky-700 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg shadow-lg transition duration-300 flex items-center justify-center text-lg"
                >
                    <NavigationIcon className="w-5 h-5 mr-2" />
                    Start Navigation
                </button>
                {error && <p className="text-red-400 mt-4">{error}</p>}
            </div>

            <div className={`absolute bottom-0 left-0 w-full p-4 z-10 transition-transform duration-500 ${isNavigating ? 'translate-y-0' : 'translate-y-full'}`}>
                 <div className="w-full max-w-lg mx-auto bg-black bg-opacity-60 rounded-xl p-4 text-center backdrop-blur-sm">
                    <p className="text-xl text-gray-100 min-h-[3em]">{instruction}</p>
                    <button onClick={handleStopNavigation} className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-full">
                        Stop
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MapsMode;