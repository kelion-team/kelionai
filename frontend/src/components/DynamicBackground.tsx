import { useState, useEffect, useRef } from 'react';
import './DynamicBackground.css';

// Imaginea de fundal originală
// Măsurată manual: monitorul din imagine este la 18.5% de la stânga, 16.2% de la top,
// și are 63% din lățimea imaginii și 58.1% din înălțimea ei.
import backgroundImage from '../assets/background-image.png';

const DynamicBackground = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;

      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;

      // Dimensiunile imaginii de fundal (intrinseci)
      const imageWidth = 3840;
      const imageHeight = 2160;

      // Coordonatele și dimensiunile "monitorului" din imagine, ca procente
      const monitorXPercent = 18.5 / 100;
      const monitorYPercent = 16.2 / 100;
      const monitorWidthPercent = 63 / 100;
      const monitorHeightPercent = 58.1 / 100;

      // Calculează lățimea și înălțimea imaginii scalate
      // pentru ca monitorul din imagine să umple ecranul
      const newImageWidth = screenWidth / monitorWidthPercent;
      const newImageHeight = screenHeight / monitorHeightPercent;

      // Alege cea mai mare scală pentru a acoperi tot, păstrând aspect ratio
      const scaleX = newImageWidth / imageWidth;
      const scaleY = newImageHeight / imageHeight;
      const newScale = Math.max(scaleX, scaleY);
      setScale(newScale);

      // Calculează offset-ul pentru a centra monitorul din imagine
      const finalImageWidth = imageWidth * newScale;
      const finalImageHeight = imageHeight * newScale;

      const monitorX = finalImageWidth * monitorXPercent;
      const monitorY = finalImageHeight * monitorYPercent;

      const newOffsetX = -(monitorX);
      const newOffsetY = -(monitorY);

      setOffset({ x: newOffsetX, y: newOffsetY });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div ref={containerRef} className="dynamic-background-container">
      <div
        className="background-image"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          transform: `scale(${scale}) translate(${offset.x}px, ${offset.y}px)`,
        }}
      >
        <div className="animated-element light-pulse" style={{ top: '30%', left: '10%' }}></div>
        <div className="animated-element data-stream" style={{ top: '50%', left: '80%' }}></div>
        <div className="animated-element radar-sweep" style={{ bottom: '20%', left: '15%' }}></div>
      </div>
    </div>
  );
};

export default DynamicBackground;
