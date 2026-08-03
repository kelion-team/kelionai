import { useState, useEffect } from 'react';

export default function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timerId = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timerId);
  }, []);

  const getGreeting = () => {
    const hours = time.getHours();
    if (hours < 12) {
      return 'Bună dimineața';
    } else if (hours < 18) {
      return 'Bună ziua';
    } else {
      return 'Bună seara';
    }
  };

  return (
    <div className="clock-container">
      <div className="clock-greeting">{getGreeting()}</div>
      <div className="clock-time">{time.toLocaleTimeString('ro-RO')}</div>
    </div>
  );
}
