import './DynamicBackground.css';

const DynamicBackground = () => {
  return (
    <div className="dynamic-background-container">
      <div
        className="animated-element light-pulse"
        style={{ top: '30%', left: '10%' }}
      ></div>
      <div
        className="animated-element data-stream"
        style={{ top: '50%', left: '80%' }}
      ></div>
      <div
        className="animated-element radar-sweep"
        style={{ bottom: '20%', left: '15%' }}
      ></div>
    </div>
  );
};

export default DynamicBackground;
