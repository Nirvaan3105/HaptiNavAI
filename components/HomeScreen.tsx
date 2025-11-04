import React from 'react';
import { AppMode } from '../types';

interface HomeScreenProps {
  setMode: (mode: AppMode) => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ setMode }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-5xl font-bold mb-4">AI Vision Assistant</h1>
      <p className="text-xl text-gray-400 mb-12">Choose a mode to get started</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
        <button
          onClick={() => setMode(AppMode.FAST)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-6 px-4 rounded-lg shadow-lg transition duration-300"
        >
          <h2 className="text-2xl mb-2">Fast Mode</h2>
          <p>Quickly identify objects in your view.</p>
        </button>
        <button
          onClick={() => setMode(AppMode.SCENE_DESCRIPTOR)}
          className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-6 px-4 rounded-lg shadow-lg transition duration-300"
        >
          <h2 className="text-2xl mb-2">Scene Descriptor</h2>
          <p>Get a real-time audio description of your surroundings.</p>
        </button>
        <button
          onClick={() => setMode(AppMode.MAPS)}
          className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-6 px-4 rounded-lg shadow-lg transition duration-300 col-span-1 md:col-span-2"
        >
          <h2 className="text-2xl mb-2">Maps Mode</h2>
          <p>Explore nearby places and get information.</p>
        </button>
      </div>
    </div>
  );
};

export default HomeScreen;
