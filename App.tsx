import React, { useState } from 'react';
import { AppMode } from './types';
import HomeScreen from './components/HomeScreen';
import FastMode from './components/FastMode';
import SceneDescriptorMode from './components/SceneDescriptorMode';
import MapsMode from './components/MapsMode';

function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.HOME);

  const renderMode = () => {
    switch (mode) {
      case AppMode.HOME:
        return <HomeScreen setMode={setMode} />;
      case AppMode.FAST:
        return <FastMode setMode={setMode} />;
      case AppMode.SCENE_DESCRIPTOR:
        return <SceneDescriptorMode setMode={setMode} />;
      case AppMode.MAPS:
        return <MapsMode setMode={setMode} />;
      default:
        return <HomeScreen setMode={setMode} />;
    }
  };

  return (
    <main>
      {renderMode()}
    </main>
  );
}

export default App;
