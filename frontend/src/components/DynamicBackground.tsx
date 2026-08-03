import React, { useState, useEffect } from 'react';

interface VirtualMonitor {
  x: number; // top-left corner X in the image
  y: number; // top-left corner Y in the image
  width: number; // width of the virtual monitor in the image
  height: number; // height of the virtual monitor in the image
}

interface DynamicBackgroundProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  virtualMonitor: VirtualMonitor;
}

export default function DynamicBackground({ imageUrl, imageWidth, imageHeight, virtualMonitor }: DynamicBackgroundProps) {
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { x: vmX, y: vmY, width: vmWidth, height: vmHeight } = virtualMonitor;
  const { width: viewportWidth, height: viewportHeight } = viewport;

  // Calculate the scale required to make the virtual monitor fill the viewport
  const scaleX = viewportWidth / vmWidth;
  const scaleY = viewportHeight / vmHeight;
  // Use the 'cover' approach: scale uniformly until both dimensions of the virtual monitor are >= viewport dimensions
  const scale = Math.max(scaleX, scaleY);

  // Calculate the new dimensions of the image after scaling
  const scaledImageWidth = imageWidth * scale;
  const scaledImageHeight = imageHeight * scale;

  // Calculate the translation needed to center the virtual monitor within the viewport.
  // 1. Find the top-left corner of the scaled virtual monitor
  const scaledVmX = vmX * scale;
  const scaledVmY = vmY * scale;
  // 2. Calculate the translation to move this point to the viewport's top-left corner
  const translateX = -scaledVmX;
  const translateY = -scaledVmY;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: `${scaledImageWidth}px`,
    height: `${scaledImageHeight}px`,
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: '100% 100%',
    transform: `translate(${translateX}px, ${translateY}px)`,
    zIndex: -1,
    willChange: 'transform', // Performance hint
  };

  return <div style={style} />;
}
