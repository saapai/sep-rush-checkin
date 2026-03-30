import { useState, useRef, useEffect } from 'react';
import './Webcam.css';

interface WebcamProps {
  width?: number;
  height?: number;
  className?: string;
  autoStart?: boolean;
}

const Webcam: React.FC<WebcamProps> = ({ 
  width = 320, 
  height = 240, 
  className = '',
  autoStart = false
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [currentCamera, setCurrentCamera] = useState<'user' | 'environment'>('user');
  const [isMobile, setIsMobile] = useState(false);

  // Detect if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
      setIsMobile(isMobileDevice);
    };
    
    checkMobile();
  }, []);

  const startWebcam = async (cameraType: 'user' | 'environment' = currentCamera) => {
    try {
      setError(null);
      
      // Request camera access with specific facing mode
      const constraints = {
        video: {
          width: { ideal: width },
          height: { ideal: height },
          ...(isMobile && { facingMode: cameraType })
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
        setHasPermission(true);
        setCurrentCamera(cameraType);
      }
    } catch (err) {
      console.error('Error accessing webcam:', err);
      setError('Unable to access webcam. Please check permissions.');
      setHasPermission(false);
    }
  };

  const stopWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  };

  const toggleWebcam = () => {
    if (isStreaming) {
      stopWebcam();
    } else {
      startWebcam();
    }
  };

  const flipCamera = async () => {
    if (isStreaming) {
      const newCamera = currentCamera === 'user' ? 'environment' : 'user';
      stopWebcam();
      // Small delay to ensure camera is fully stopped
      setTimeout(() => {
        startWebcam(newCamera);
      }, 100);
    }
  };

  // Auto-start webcam if autoStart is true
  useEffect(() => {
    if (autoStart) {
      startWebcam();
    }
  }, [autoStart]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, []);

  return (
    <div className={`webcam-container ${className}`}>
      <div className="webcam-box">
        <video
          ref={videoRef}
          width={width}
          height={height}
          autoPlay
          playsInline
          muted
          className="webcam-video"
        />
        
        {!isStreaming && !error && !autoStart && (
          <div className="webcam-placeholder">
            <p>Click to start webcam</p>
          </div>
        )}
        
        {!isStreaming && !error && autoStart && (
          <div className="webcam-placeholder">
            <p>Starting camera...</p>
          </div>
        )}
        
        {error && (
          <div className="webcam-error">
            <p>{error}</p>
          </div>
        )}
      </div>
      
      {!autoStart && (
        <div className="webcam-controls">
          <button 
            onClick={toggleWebcam}
            className={`webcam-button ${isStreaming ? 'stop' : 'start'}`}
          >
            {isStreaming ? 'Stop Camera' : 'Start Camera'}
          </button>
          
          {hasPermission === false && (
            <p className="permission-hint">
              Please allow camera access in your browser settings
            </p>
          )}
        </div>
      )}

      {/* Flip camera button - only show on mobile devices when streaming */}
      {isMobile && isStreaming && (
        <div className="webcam-flip-controls">
          <button 
            onClick={flipCamera}
            className="flip-camera-button"
            title="Flip Camera"
          >
            🔄
          </button>
        </div>
      )}
      
      {autoStart && hasPermission === false && (
        <div className="webcam-controls">
          <p className="permission-hint">
            Please allow camera access in your browser settings
          </p>
        </div>
      )}
    </div>
  );
};

export default Webcam;
